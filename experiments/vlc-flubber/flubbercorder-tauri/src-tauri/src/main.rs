#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use flubbercorder_native::{
    inspect_recipe, validate_variables, Phase, RecipeInfo, Session, Snapshot, Variable,
};
use labstream::Query;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tiny_http::{Header, Method, Request, Response, Server};

struct Phone {
    url: String,
    token: String,
    active: Arc<AtomicBool>,
}

#[derive(Default)]
struct Inner {
    recipe: Option<PathBuf>,
    info: Option<RecipeInfo>,
    session: Option<Session>,
    phase: String,
    error: Option<String>,
    bundled_demo: bool,
    phone: Option<Phone>,
    revision: u64,
    variables: Vec<Variable>,
}

#[derive(Clone)]
struct Authority {
    inner: Arc<Mutex<Inner>>,
    player_dir: PathBuf,
    recorder_dir: PathBuf,
    data_dir: PathBuf,
    web_dir: PathBuf,
}

fn phase_name(phase: Phase) -> &'static str {
    match phase {
        Phase::Armed => "armed",
        Phase::Running => "running",
        Phase::Paused => "paused",
        Phase::Complete => "complete",
    }
}

fn locked(inner: &Arc<Mutex<Inner>>) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
    inner
        .lock()
        .map_err(|_| "Recorder state is unavailable".to_owned())
}

fn lan_ip() -> Result<Ipv4Addr, String> {
    if let Some(value) = std::env::var_os("FLUBBERCORDER_PHONE_HOST") {
        let ip: Ipv4Addr = value
            .to_string_lossy()
            .parse()
            .map_err(|_| "FLUBBERCORDER_PHONE_HOST must be an IPv4 address")?;
        return (ip.is_private() || ip.is_loopback())
            .then_some(ip)
            .ok_or_else(|| "Phone control is limited to a private IPv4 address".into());
    }
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("1.1.1.1:80").map_err(|e| e.to_string())?;
    match socket.local_addr().map_err(|e| e.to_string())?.ip() {
        IpAddr::V4(ip) if ip.is_private() => Ok(ip),
        _ => Err("No private IPv4 route available; connect a trusted local network".into()),
    }
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn token_matches(expected: &str, supplied: &str) -> bool {
    let candidate = supplied.strip_prefix("Bearer ").unwrap_or("");
    if candidate.len() != expected.len() {
        return false;
    }
    candidate
        .bytes()
        .zip(expected.bytes())
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn reply(request: Request, code: u16, mime: &str, body: Vec<u8>) {
    let mut response = Response::from_data(body).with_status_code(code);
    for (name, value) in [
        ("Content-Type", mime),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
        ("Content-Security-Policy", "default-src 'self'; base-uri 'none'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; style-src 'self'; script-src 'self'"),
    ] {
        if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }
    let _ = request.respond(response);
}

fn apply_session_action(
    authority: &Authority,
    action: &str,
    value: Option<u32>,
    phone_token: Option<&str>,
) -> Result<u64, String> {
    let mut inner = locked(&authority.inner)?;
    if let Some(token) = phone_token {
        if !inner
            .phone
            .as_ref()
            .is_some_and(|phone| phone.active.load(Ordering::Acquire) && phone.token == token)
        {
            return Err("Phone control is revoked".into());
        }
    }
    let session = inner
        .session
        .as_mut()
        .ok_or("Prepare an experiment first")?;
    let result = match action {
        "start" => session.start(),
        "pause" => session.pause(),
        "resume" => session.resume(),
        "stop" => session.stop(),
        "volume" => session.set_volume(value.ok_or("Volume value is missing")?),
        _ => return Err("Unknown experiment command".into()),
    };
    if let Err(error) = result {
        inner.error = Some(error.to_string());
        inner.phase = "error".into();
        inner.revision += 1;
        return Err(error.to_string());
    }
    inner.phase = phase_name(session.snapshot().phase).into();
    inner.revision += 1;
    Ok(inner.revision)
}

fn serve_phone_request(
    mut request: Request,
    authority: &Authority,
    token: &str,
    seen: &mut HashMap<String, (String, Vec<u8>)>,
) {
    let path = request.url().to_owned();
    let method = request.method().clone();
    let assets = [
        ("/", "index.html", "text/html; charset=utf-8"),
        ("/app.js", "app.js", "text/javascript; charset=utf-8"),
        ("/app.css", "app.css", "text/css; charset=utf-8"),
        (
            "/vendor/pretext/layout.js",
            "vendor/pretext/layout.js",
            "text/javascript; charset=utf-8",
        ),
        (
            "/vendor/pretext/bidi.js",
            "vendor/pretext/bidi.js",
            "text/javascript; charset=utf-8",
        ),
        (
            "/vendor/pretext/analysis.js",
            "vendor/pretext/analysis.js",
            "text/javascript; charset=utf-8",
        ),
        (
            "/vendor/pretext/measurement.js",
            "vendor/pretext/measurement.js",
            "text/javascript; charset=utf-8",
        ),
        (
            "/vendor/pretext/line-break.js",
            "vendor/pretext/line-break.js",
            "text/javascript; charset=utf-8",
        ),
        (
            "/vendor/pretext/line-text.js",
            "vendor/pretext/line-text.js",
            "text/javascript; charset=utf-8",
        ),
        (
            "/vendor/pretext/generated/bidi-data.js",
            "vendor/pretext/generated/bidi-data.js",
            "text/javascript; charset=utf-8",
        ),
    ];
    if method == Method::Get {
        if let Some((_, file, mime)) = assets.iter().find(|(url, _, _)| *url == path) {
            match std::fs::read(authority.web_dir.join(file)) {
                Ok(body) => reply(request, 200, mime, body),
                Err(_) => reply(
                    request,
                    500,
                    "text/plain",
                    b"Phone page unavailable".to_vec(),
                ),
            }
            return;
        }
    }
    if (method != Method::Get || path != "/state") && (method != Method::Post || path != "/command")
    {
        reply(request, 404, "text/plain", b"Not found".to_vec());
        return;
    }
    let supplied = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))
        .map(|header| header.value.as_str())
        .unwrap_or("");
    if !token_matches(token, supplied) {
        reply(
            request,
            401,
            "application/json",
            br#"{"error":"Phone pairing failed"}"#.to_vec(),
        );
        return;
    }
    if method == Method::Get {
        match snapshot_value(authority) {
            Ok(mut state) => {
                if let Some(map) = state.as_object_mut() {
                    for key in [
                        "recipePath",
                        "csvPath",
                        "xdfPath",
                        "phoneUrl",
                        "playerPairUrl",
                    ] {
                        map.remove(key);
                    }
                }
                reply(
                    request,
                    200,
                    "application/json",
                    state.to_string().into_bytes(),
                );
            }
            Err(_) => reply(
                request,
                500,
                "application/json",
                br#"{"error":"State unavailable"}"#.to_vec(),
            ),
        }
        return;
    }
    if request.body_length().is_none_or(|length| length > 256) {
        reply(
            request,
            413,
            "application/json",
            br#"{"error":"Command too large"}"#.to_vec(),
        );
        return;
    }
    let mut body = Vec::new();
    if request
        .as_reader()
        .take(257)
        .read_to_end(&mut body)
        .is_err()
        || body.len() > 256
    {
        reply(
            request,
            400,
            "application/json",
            br#"{"error":"Invalid command"}"#.to_vec(),
        );
        return;
    }
    let parsed = serde_json::from_slice::<Value>(&body).ok();
    let fields = parsed.as_ref().and_then(Value::as_object);
    let id = fields
        .and_then(|v| v.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let action = fields
        .and_then(|v| v.get("action"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let value = fields.and_then(|v| v.get("value")).and_then(Value::as_u64);
    if fields.is_none_or(|v| v.len() != if action == "volume" { 3 } else { 2 })
        || id.len() != 36
        || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        || !matches!(action, "start" | "pause" | "resume" | "stop" | "volume")
        || (action == "volume" && value.is_none_or(|v| v > 100))
    {
        reply(
            request,
            400,
            "application/json",
            br#"{"error":"Invalid experiment action"}"#.to_vec(),
        );
        return;
    }
    let action_key = format!("{action}:{value:?}");
    if let Some((old_action, response)) = seen.get(id) {
        if old_action == &action_key {
            reply(request, 200, "application/json", response.clone());
        } else {
            reply(
                request,
                409,
                "application/json",
                br#"{"error":"Command ID reused"}"#.to_vec(),
            );
        }
        return;
    }
    if seen.len() >= 1024 {
        reply(
            request,
            429,
            "application/json",
            br#"{"error":"Phone session command limit reached; revoke and pair again"}"#.to_vec(),
        );
        return;
    }
    match apply_session_action(authority, action, value.map(|v| v as u32), Some(token)) {
        Ok(revision) => {
            let response = json!({"applied": true, "revision": revision})
                .to_string()
                .into_bytes();
            seen.insert(id.to_owned(), (action_key, response.clone()));
            reply(request, 200, "application/json", response);
        }
        Err(error) => reply(
            request,
            409,
            "application/json",
            json!({"error": error}).to_string().into_bytes(),
        ),
    }
}

fn give_phone(authority: &Authority) -> Result<(), String> {
    if locked(&authority.inner)?.phone.is_some() {
        return Ok(());
    }
    let ip = lan_ip()?;
    let server = Server::http((ip, 0)).map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("Phone listener has no TCP address")?
        .port();
    let token = random_token()?;
    let active = Arc::new(AtomicBool::new(true));
    {
        let mut inner = locked(&authority.inner)?;
        inner.phone = Some(Phone {
            url: format!("http://{ip}:{port}/#phone:{token}"),
            token: token.clone(),
            active: active.clone(),
        });
        inner.revision += 1;
    }
    let authority = authority.clone();
    thread::spawn(move || {
        let mut seen = HashMap::new();
        while active.load(Ordering::Acquire) {
            match server.recv_timeout(Duration::from_millis(200)) {
                Ok(Some(request)) => serve_phone_request(request, &authority, &token, &mut seen),
                Ok(None) => {}
                Err(_) => break,
            }
        }
        active.store(false, Ordering::Release);
        if let Ok(mut inner) = authority.inner.lock() {
            if inner
                .phone
                .as_ref()
                .is_some_and(|phone| phone.token == token)
            {
                inner.phone = None;
                inner.revision += 1;
            }
        }
    });
    Ok(())
}

#[tauri::command]
async fn dispatch(
    action: String,
    path: Option<String>,
    value: Option<u32>,
    variables: Option<Vec<Variable>>,
    state: tauri::State<'_, Authority>,
) -> Result<(), String> {
    let authority = (*state).clone();
    if action == "prepare" {
        let (recipe, variables) = {
            let mut inner = locked(&authority.inner)?;
            if inner.phase != "loaded" {
                return Err("Load an experiment first".into());
            }
            let recipe = inner.recipe.clone().ok_or("Recipe path is missing")?;
            inner.phase = "preparing".into();
            inner.error = None;
            (recipe, inner.variables.clone())
        };
        thread::spawn(move || {
            let result = Session::arm(
                &recipe,
                &authority.player_dir,
                &authority.recorder_dir,
                &authority.data_dir,
                false,
            )
            .and_then(|mut session| {
                session.set_variables(variables)?;
                Ok(session)
            });
            if let Ok(mut inner) = authority.inner.lock() {
                match result {
                    Ok(session) => {
                        inner.session = Some(session);
                        inner.phase = "armed".into();
                        inner.revision += 1;
                    }
                    Err(error) => {
                        inner.error = Some(error.to_string());
                        inner.phase = "error".into();
                        inner.revision += 1;
                    }
                }
            }
        });
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if action == "give_phone" {
            let result = give_phone(&authority);
            if let Ok(mut inner) = authority.inner.lock() {
                inner.error = result.as_ref().err().cloned();
            }
            return result;
        }
        if action == "revoke_phone" {
            let mut inner = locked(&authority.inner)?;
            if let Some(phone) = inner.phone.take() {
                phone.active.store(false, Ordering::Release);
                inner.revision += 1;
            }
            inner.error = None;
            return Ok(());
        }
        if action == "load" {
            let path = PathBuf::from(path.ok_or("Experiment JSON path is missing")?);
            let canonical = path.canonicalize().map_err(|error| error.to_string())?;
            let info = inspect_recipe(&canonical).map_err(|error| error.to_string())?;
            let mut inner = locked(&authority.inner)?;
            if matches!(
                inner.phase.as_str(),
                "preparing" | "armed" | "running" | "paused"
            ) {
                return Err("Stop the current experiment before loading another".into());
            }
            inner.session = None;
            inner.recipe = Some(canonical);
            inner.info = Some(info);
            inner.phase = "loaded".into();
            inner.error = None;
            inner.bundled_demo = false;
            inner.variables.clear();
            inner.revision += 1;
            return Ok(());
        }
        if action == "set_variables" {
            let variables = variables.ok_or("Custom variables are missing")?;
            validate_variables(&variables)?;
            let mut inner = locked(&authority.inner)?;
            if inner.phase != "loaded" {
                return Err("Set variables before preparing the player".into());
            }
            inner.variables = variables;
            inner.revision += 1;
            return Ok(());
        }
        apply_session_action(&authority, &action, value, None)?;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn snapshot(state: tauri::State<'_, Authority>) -> Result<Value, String> {
    let authority = (*state).clone();
    tauri::async_runtime::spawn_blocking(move || snapshot_value(&authority))
        .await
        .map_err(|error| error.to_string())?
}

fn snapshot_value(authority: &Authority) -> Result<Value, String> {
    let (
        phase,
        error,
        recipe,
        info,
        session,
        bundled_demo,
        phone_enabled,
        phone_url,
        revision,
        variables,
    ) = {
        let mut inner = locked(&authority.inner)?;
        let session = inner.session.as_mut().map(Session::snapshot);
        (
            inner.phase.clone(),
            inner.error.clone(),
            inner.recipe.clone(),
            inner.info.clone(),
            session,
            inner.bundled_demo,
            inner.phone.is_some(),
            inner.phone.as_ref().map(|phone| phone.url.clone()),
            inner.revision,
            inner.variables.clone(),
        )
    };
    Ok(render_state(
        phase,
        error,
        recipe,
        info,
        session,
        bundled_demo,
        (phone_enabled, phone_url, revision),
        variables,
    ))
}

fn poll_session(authority: &Authority) {
    let Ok(mut inner) = authority.inner.lock() else {
        return;
    };
    if !matches!(inner.phase.as_str(), "running" | "paused") {
        return;
    }
    if let Some(session) = inner.session.as_mut() {
        if let Err(error) = session.tick() {
            inner.error = Some(error.to_string());
            inner.phase = "error".into();
            inner.revision += 1;
        } else {
            let new_phase = phase_name(session.snapshot().phase);
            if inner.phase != new_phase {
                inner.phase = new_phase.into();
                inner.revision += 1;
            }
        }
    }
}

fn render_state(
    phase: String,
    error: Option<String>,
    recipe: Option<PathBuf>,
    info: Option<RecipeInfo>,
    session: Option<Snapshot>,
    bundled_demo: bool,
    phone: (bool, Option<String>, u64),
    variables: Vec<Variable>,
) -> Value {
    let video = info.as_ref().map(|info| info.video.clone());
    let panel = info.as_ref().map(|info| info.panel_percent);
    let required = info
        .as_ref()
        .map(|info| info.required_streams.clone())
        .unwrap_or_default();
    let source = session
        .as_ref()
        .map(|s| s.source_id.clone())
        .unwrap_or_default();
    let mut streams: HashMap<String, Vec<String>> = HashMap::new();
    let names = ["VLC_Flubber_Affect", "VLC_Flubber_Markers"];
    let found = if session.is_some() {
        labstream::resolve_all(&Query::all(), Duration::from_millis(50)).unwrap_or_default()
    } else {
        Vec::new()
    };
    for stream in found {
        if names.contains(&stream.name()) || required.iter().any(|n| n == stream.name()) {
            streams
                .entry(stream.name().to_owned())
                .or_default()
                .push(stream.source_id().to_owned());
        }
    }
    let ready = !source.is_empty()
        && streams
            .get("VLC_Flubber_Affect")
            .is_some_and(|ids| ids.contains(&format!("{source}-affect")))
        && streams
            .get("VLC_Flubber_Markers")
            .is_some_and(|ids| ids.contains(&format!("{source}-markers")))
        && required
            .iter()
            .all(|name| streams.get(name).is_some_and(|ids| ids.len() == 1));
    let latest = session.as_ref().and_then(|s| s.latest.clone());
    let history = session
        .as_ref()
        .map(|s| s.history.clone())
        .unwrap_or_default();
    let markers = session
        .as_ref()
        .map(|s| s.markers.clone())
        .unwrap_or_default();
    let recorder = session.as_ref().map(|s| {
        json!({
            "alive": s.recorder_alive,
            "subscribed": s.subscribed,
            "firstData": s.first_data
        })
    });
    json!({
        "mode": "combined",
        "revision": phone.2,
        "phase": if phase.is_empty() { "empty" } else { &phase },
        "error": error,
        "video": video,
        "panelPercent": panel,
        "requiredStreams": required,
        "sourceId": source,
        "lslReady": ready,
        "lsl": { "streams": streams, "value": latest, "history": history, "markers": markers },
        "recorder": recorder,
        "recipePath": recipe,
        "csvPath": session.as_ref().map(|s| s.csv_path.clone()),
        "xdfPath": session.as_ref().and_then(|s| s.xdf_path.clone()),
        "metadataPath": session.as_ref().map(|s| s.metadata_path.clone()),
        "customVariables": variables,
        "bundledDemo": bundled_demo,
        "phoneEnabled": phone.0,
        "phoneUrl": phone.1,
        "playerPairUrl": null
        ,"volumePercent": session.as_ref().map(|s| s.volume_percent).unwrap_or(100)
    })
}

fn main() {
    // WebView2 options used by older Flubbercorder builds can differ. A
    // separate profile lets the native player experiment run alongside them.
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            std::env::set_var(
                "WEBVIEW2_USER_DATA_FOLDER",
                PathBuf::from(local).join("io.github.georgefejer91.flubbercorder/webview2-libvlc"),
            );
        }
    }
    tauri::Builder::default()
        .setup(|app| {
            let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?;
            let bundled_player = app.path().resource_dir()?.join("resources/player");
            let player_dir = std::env::var_os("FLUBBERCORDER_PLAYER_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    if (bundled_player.join("vlc.exe").is_file()
                        && bundled_player.join("flubber_bridge.dll").is_file())
                        || bundled_player.join("FlubberVLC.exe").is_file()
                    {
                        bundled_player
                    } else if PathBuf::from(&local)
                        .join("Programs/VLCWithFlubber/vlc.exe")
                        .is_file()
                    {
                        PathBuf::from(local).join("Programs/VLCWithFlubber")
                    } else {
                        PathBuf::from(local).join("Programs/FlubberVLCPlayer")
                    }
                });
            let recorder_dir = std::env::var_os("FLUBBERCORDER_RECORDER_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().resource_dir()?.join("resources/recorder"));
            let data_dir = app.path().app_local_data_dir()?;
            let mut initial = Inner::default();
            let explicit = std::env::var_os("FLUBBERCORDER_DEFAULT_RECIPE").map(PathBuf::from);
            let demo_dir = app.path().resource_dir()?.join("resources/demo");
            let default = explicit.or_else(|| {
                demo_dir
                    .join("dictator-3-study.mp4")
                    .is_file()
                    .then(|| demo_dir.join("great-dictator.json"))
            });
            if let Some(path) = default {
                let path = path.canonicalize()?;
                initial.info = Some(inspect_recipe(&path)?);
                initial.bundled_demo = path.starts_with(&demo_dir);
                initial.recipe = Some(path);
                initial.phase = "loaded".into();
            }
            let authority = Authority {
                inner: Arc::new(Mutex::new(initial)),
                player_dir,
                recorder_dir,
                data_dir,
                web_dir: app.path().resource_dir()?.join("resources/web"),
            };
            let monitor = authority.clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(20));
                poll_session(&monitor);
            });
            app.manage(authority);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![dispatch, snapshot])
        .run(tauri::generate_context!())
        .expect("Flubbercorder could not start");
}
