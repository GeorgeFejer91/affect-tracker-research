mod control;

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs::{self, File};
use std::io::Read;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

const COMPONENTS: [&str; 7] = [
    "FlubberVLC.exe",
    "vlc/vlc.exe",
    "ffmpeg/ffmpeg.exe",
    "ffmpeg/ffprobe.exe",
    "plugins/video_filter/libflubber_plugin.dll",
    "svg/flubber_svg.dll",
    "lsl.dll",
];
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const TRUSTED_MANIFEST_SHA256: Option<&str> = option_env!("FLUBBERVLC_MANIFEST_SHA256");
const TRUSTED_PAYLOAD_MANIFEST_SHA256: Option<&str> =
    option_env!("FLUBBERVLC_PAYLOAD_MANIFEST_SHA256");

#[derive(Default)]
struct Selection {
    master: Mutex<Option<PathBuf>>,
    video: Mutex<Option<PathBuf>>,
    player_directory: Mutex<Option<PathBuf>>,
}

#[derive(Default)]
struct ControlState(Mutex<Option<control::ControlClient>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerStatus {
    ready: bool,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlView {
    connected: bool,
    phase: control::Phase,
    generation: u64,
}

fn control_view(client: Option<&control::ControlClient>) -> ControlView {
    let (phase, generation) = client
        .map(control::ControlClient::snapshot)
        .unwrap_or((control::Phase::Idle, 0));
    ControlView {
        connected: client.is_some(),
        phase,
        generation,
    }
}

fn default_player_directory() -> Result<PathBuf, String> {
    let local = env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?;
    Ok(PathBuf::from(local)
        .join("Programs")
        .join("FlubberVLCPlayer"))
}

fn player_directory(selection: &Selection) -> Result<PathBuf, String> {
    selection
        .player_directory
        .lock()
        .map_err(|_| "Player selection is unavailable".to_string())?
        .clone()
        .map(Ok)
        .unwrap_or_else(default_player_directory)
}

fn verify_player(
    directory: &Path,
    trusted_manifest_sha256: Option<&str>,
    trusted_payload_manifest_sha256: Option<&str>,
) -> Result<PathBuf, String> {
    fn pin(value: Option<&str>) -> Result<String, String> {
        value
            .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .map(str::to_ascii_lowercase)
            .ok_or(
                "No trusted FlubberVLC Player package is configured for this Recorder build".into(),
            )
    }
    let trusted = pin(trusted_manifest_sha256)?;
    let trusted_payload = pin(trusted_payload_manifest_sha256)?;
    let root = directory.canonicalize().map_err(|_| {
        "Install FlubberVLC Player separately, then select its installation folder".to_string()
    })?;
    if fs::symlink_metadata(directory)
        .map_err(|_| "Player installation folder cannot be inspected".to_string())?
        .file_attributes()
        & FILE_ATTRIBUTE_REPARSE_POINT
        != 0
    {
        return Err("Player installation folder cannot be a link".into());
    }
    let location = root.to_string_lossy();
    if location.starts_with("\\\\?\\UNC\\")
        || (location.starts_with("\\\\") && !location.starts_with("\\\\?\\"))
    {
        return Err("Player installation must be on this PC".into());
    }
    let manifest_bytes = read_pinned_manifest(&root, "manifest.json", &trusted)?;
    let payload_bytes = read_pinned_manifest(&root, "payload-manifest.json", &trusted_payload)?;
    let manifest: BTreeMap<String, String> = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "Player manifest is invalid".to_string())?;
    let payload: BTreeMap<String, String> = serde_json::from_slice(&payload_bytes)
        .map_err(|_| "Player payload manifest is invalid".to_string())?;
    if manifest.len() != COMPONENTS.len()
        || COMPONENTS.iter().any(|name| !manifest.contains_key(*name))
    {
        return Err("Player manifest has an unexpected component list".into());
    }
    if payload.is_empty()
        || !payload.contains_key("manifest.json")
        || payload.contains_key("payload-manifest.json")
    {
        return Err("Player payload manifest has an invalid file list".into());
    }
    for (name, claimed) in &payload {
        if name.starts_with('/')
            || name.contains('\\')
            || name.contains(':')
            || name
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || claimed.len() != 64
            || !claimed.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(format!("Invalid player payload entry: {name}"));
        }
    }
    for name in COMPONENTS {
        let claimed = &manifest[name];
        if claimed.len() != 64 || !claimed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(format!("Invalid digest for {name}"));
        }
        if payload.get(name).map(String::as_str) != Some(claimed.as_str()) {
            return Err(format!(
                "Player component differs from payload inventory: {name}"
            ));
        }
    }
    if payload["manifest.json"] != format!("{:x}", Sha256::digest(&manifest_bytes)) {
        return Err("Player component manifest differs from payload inventory".into());
    }
    let mut found = BTreeSet::new();
    verify_payload_tree(&root, &root, "", &payload, &mut found)?;
    if found != payload.keys().cloned().collect() {
        return Err("Player payload is missing an inventoried file".into());
    }
    Ok(root.join("FlubberVLC.exe"))
}

fn read_pinned_manifest(root: &Path, name: &str, trusted: &str) -> Result<Vec<u8>, String> {
    let path = root.join(name);
    let metadata = fs::symlink_metadata(&path).map_err(|_| format!("Player {name} is missing"))?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(format!("Player {name} cannot be a link"));
    }
    let bytes = fs::read(path).map_err(|_| format!("Player {name} cannot be read"))?;
    if format!("{:x}", Sha256::digest(&bytes)) != trusted {
        return Err(format!(
            "Installed player {name} does not match the trusted package"
        ));
    }
    Ok(bytes)
}

fn verify_payload_tree(
    root: &Path,
    directory: &Path,
    prefix: &str,
    payload: &BTreeMap<String, String>,
    found: &mut BTreeSet<String>,
) -> Result<(), String> {
    for entry in
        fs::read_dir(directory).map_err(|_| "Player payload cannot be listed".to_string())?
    {
        let entry = entry.map_err(|_| "Player payload cannot be listed".to_string())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Player payload has an invalid filename".to_string())?;
        let relative = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| format!("Unreadable player payload: {relative}"))?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(format!("Linked player payload: {relative}"));
        }
        if metadata.is_dir() {
            // Inno Setup creates its own uninstall files after staging the pinned payload.
            if prefix.is_empty() && relative == "uninst" {
                continue;
            }
            verify_payload_tree(root, &path, &relative, payload, found)?;
        } else if metadata.is_file() {
            if relative == "payload-manifest.json" && directory == root {
                continue;
            }
            let claimed = payload
                .get(&relative)
                .ok_or_else(|| format!("Unexpected player payload: {relative}"))?;
            let mut file =
                File::open(&path).map_err(|_| format!("Unreadable player payload: {relative}"))?;
            let mut digest = Sha256::new();
            let mut buffer = [0_u8; 65536];
            loop {
                let size = file
                    .read(&mut buffer)
                    .map_err(|_| format!("Unreadable player payload: {relative}"))?;
                if size == 0 {
                    break;
                }
                digest.update(&buffer[..size]);
            }
            if format!("{:x}", digest.finalize()) != *claimed {
                return Err(format!("Player payload digest mismatch: {relative}"));
            }
            found.insert(relative);
        } else {
            return Err(format!("Invalid player payload: {relative}"));
        }
    }
    Ok(())
}

#[tauri::command]
fn player_status(selection: State<'_, Selection>) -> PlayerStatus {
    match player_directory(&selection).and_then(|directory| {
        verify_player(
            &directory,
            TRUSTED_MANIFEST_SHA256,
            TRUSTED_PAYLOAD_MANIFEST_SHA256,
        )
    }) {
        Ok(_) => PlayerStatus {
            ready: true,
            detail: "Installed player components verified".into(),
        },
        Err(detail) => PlayerStatus {
            ready: false,
            detail,
        },
    }
}

#[tauri::command]
async fn choose_player(
    app: tauri::AppHandle,
    selection: State<'_, Selection>,
    control: State<'_, ControlState>,
) -> Result<Option<String>, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let directory = folder
        .into_path()
        .map_err(|_| "Select a local installation folder".to_string())?;
    verify_player(
        &directory,
        TRUSTED_MANIFEST_SHA256,
        TRUSTED_PAYLOAD_MANIFEST_SHA256,
    )?;
    let previous = control
        .0
        .lock()
        .map_err(|_| "Player control is unavailable".to_string())?
        .take();
    if let Some(mut previous) = previous {
        previous.shutdown();
    }
    *selection
        .player_directory
        .lock()
        .map_err(|_| "Player selection is unavailable".to_string())? = Some(directory.clone());
    Ok(Some(directory.display().to_string()))
}

#[tauri::command]
fn connect_player(
    selection: State<'_, Selection>,
    control: State<'_, ControlState>,
) -> Result<ControlView, String> {
    let mut client = control
        .0
        .lock()
        .map_err(|_| "Player control is unavailable".to_string())?;
    if client.as_mut().is_some_and(control::ControlClient::alive) {
        return Ok(control_view(client.as_ref()));
    }
    *client = None;
    let player = verify_player(
        &player_directory(&selection)?,
        TRUSTED_MANIFEST_SHA256,
        TRUSTED_PAYLOAD_MANIFEST_SHA256,
    )?;
    *client = Some(control::ControlClient::spawn(&player)?);
    Ok(control_view(client.as_ref()))
}

#[tauri::command]
fn disconnect_player(control: State<'_, ControlState>) -> Result<ControlView, String> {
    let previous = control
        .0
        .lock()
        .map_err(|_| "Player control is unavailable".to_string())?
        .take();
    if let Some(mut previous) = previous {
        previous.shutdown();
    }
    Ok(control_view(None))
}

#[tauri::command]
fn control_status(control: State<'_, ControlState>) -> Result<ControlView, String> {
    let mut client = control
        .0
        .lock()
        .map_err(|_| "Player control is unavailable".to_string())?;
    let connected = client.as_mut().is_some_and(control::ControlClient::alive);
    if !connected {
        *client = None;
    }
    Ok(control_view(client.as_ref()))
}

#[tauri::command]
async fn choose_video(
    app: tauri::AppHandle,
    selection: State<'_, Selection>,
) -> Result<Option<String>, String> {
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("Video", &["mp4", "mkv", "mov", "avi", "webm"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| "Select a local video file".to_string())?;
    if !path.is_file()
        || !path.extension().is_some_and(|extension| {
            ["mp4", "mkv", "mov", "avi", "webm"]
                .iter()
                .any(|allowed| extension.to_string_lossy().eq_ignore_ascii_case(allowed))
        })
    {
        return Err("Select a supported local video file".into());
    }
    let label = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or("Invalid video filename")?;
    *selection
        .video
        .lock()
        .map_err(|_| "Video selection is unavailable".to_string())? = Some(path);
    Ok(Some(label))
}

#[tauri::command]
fn control_video(
    action: String,
    selection: State<'_, Selection>,
    control: State<'_, ControlState>,
) -> Result<ControlView, String> {
    let action = match action.as_str() {
        "arm" => control::Action::Arm,
        "play" => control::Action::Start,
        "pause" => control::Action::Pause,
        "resume" => control::Action::Resume,
        "stop" => control::Action::Stop,
        _ => return Err("Unsupported player action".into()),
    };
    let video = if action == control::Action::Arm {
        Some(
            selection
                .video
                .lock()
                .map_err(|_| "Video selection is unavailable".to_string())?
                .clone()
                .ok_or("Select a local video before Arm")?,
        )
    } else {
        None
    };
    let mut current = control
        .0
        .lock()
        .map_err(|_| "Player control is unavailable".to_string())?;
    let client = current.as_mut().ok_or("Connect the local player first")?;
    if !client.alive() {
        *current = None;
        return Err("Player connection ended".into());
    }
    if let Err(error) = client.send(action, video.as_deref()) {
        if !client.alive() {
            *current = None;
        }
        return Err(error);
    }
    Ok(control_view(current.as_ref()))
}

#[tauri::command]
async fn choose_master(
    app: tauri::AppHandle,
    selection: State<'_, Selection>,
) -> Result<Option<String>, String> {
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("Planner master", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| "Select a local Planner master file".to_string())?;
    if !path.is_file()
        || !path
            .extension()
            .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("json"))
    {
        return Err("Select a Planner master JSON file".into());
    }
    let label = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or("Invalid master filename")?;
    *selection
        .master
        .lock()
        .map_err(|_| "Master selection is unavailable".to_string())? = Some(path);
    Ok(Some(label))
}

#[tauri::command]
fn inspect_master(
    selection: State<'_, Selection>,
    participant: String,
    selector_json: String,
) -> Result<serde_json::Value, String> {
    let master = selection
        .master
        .lock()
        .map_err(|_| "Master selection is unavailable".to_string())?
        .clone()
        .ok_or("Select a Planner master")?;
    if participant.len() > 16 || selector_json.len() > 4096 {
        return Err("Participant or selector is too long".into());
    }
    let _: serde_json::Value =
        serde_json::from_str(&selector_json).map_err(|_| "Invalid selector JSON".to_string())?;
    let player = verify_player(
        &player_directory(&selection)?,
        TRUSTED_MANIFEST_SHA256,
        TRUSTED_PAYLOAD_MANIFEST_SHA256,
    )?;
    let output = Command::new(player)
        .arg("--inspect-master")
        .arg(master)
        .arg("--participant")
        .arg(participant)
        .arg("--selector-json")
        .arg(selector_json)
        .output()
        .map_err(|_| "Installed player could not inspect the master".to_string())?;
    if !output.status.success() {
        return Err("Player rejected the Planner master or selected route".into());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| "Player returned an invalid plan".to_string())
}

fn main() {
    if env::args_os().skip(1).collect::<Vec<_>>() == [std::ffi::OsString::from("--verify-player")] {
        if let Err(error) = default_player_directory().and_then(|directory| {
            verify_player(
                &directory,
                TRUSTED_MANIFEST_SHA256,
                TRUSTED_PAYLOAD_MANIFEST_SHA256,
            )
            .map(|_| ())
        }) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Selection::default())
        .manage(ControlState::default())
        .invoke_handler(tauri::generate_handler![
            player_status,
            choose_player,
            choose_master,
            inspect_master,
            connect_player,
            disconnect_player,
            control_status,
            choose_video,
            control_video
        ])
        .run(tauri::generate_context!())
        .expect("FlubberRecorder could not start");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("flubber-recorder-test-{suffix}"));
        let mut manifest = BTreeMap::new();
        for name in COMPONENTS {
            let file = root.join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(&file, name.as_bytes()).unwrap();
            manifest.insert(name, format!("{:x}", Sha256::digest(name.as_bytes())));
        }
        fs::write(
            root.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let extra = root.join("vlc/plugins/codec.dll");
        fs::create_dir_all(extra.parent().unwrap()).unwrap();
        fs::write(&extra, b"extra player payload").unwrap();
        let mut payload = manifest;
        payload.insert(
            "vlc/plugins/codec.dll",
            format!("{:x}", Sha256::digest(b"extra player payload")),
        );
        payload.insert("manifest.json", manifest_pin(&root));
        fs::write(
            root.join("payload-manifest.json"),
            serde_json::to_vec(&payload).unwrap(),
        )
        .unwrap();
        root
    }

    fn manifest_pin(root: &Path) -> String {
        format!(
            "{:x}",
            Sha256::digest(fs::read(root.join("manifest.json")).unwrap())
        )
    }

    fn payload_pin(root: &Path) -> String {
        format!(
            "{:x}",
            Sha256::digest(fs::read(root.join("payload-manifest.json")).unwrap())
        )
    }

    #[test]
    fn rejects_missing_or_invalid_package_pin() {
        let root = fixture();
        let payload = payload_pin(&root);
        let manifest = manifest_pin(&root);
        assert!(verify_player(&root, None, Some(&payload))
            .unwrap_err()
            .contains("No trusted"));
        assert!(verify_player(&root, Some("bad"), Some(&payload))
            .unwrap_err()
            .contains("No trusted"));
        assert!(verify_player(&root, Some(&manifest), None)
            .unwrap_err()
            .contains("No trusted"));
        assert!(verify_player(&root, Some(&manifest), Some("bad"))
            .unwrap_err()
            .contains("No trusted"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_changed_manifest_even_when_component_hashes_still_match() {
        let root = fixture();
        let pin = manifest_pin(&root);
        let payload = payload_pin(&root);
        let manifest_path = root.join("manifest.json");
        let mut bytes = fs::read(&manifest_path).unwrap();
        bytes.push(b' ');
        fs::write(manifest_path, bytes).unwrap();
        assert!(verify_player(&root, Some(&pin), Some(&payload))
            .unwrap_err()
            .contains("does not match the trusted package"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn verifies_exact_player_components_and_rejects_tampering() {
        let root = fixture();
        let pin = manifest_pin(&root);
        let payload = payload_pin(&root);
        assert_eq!(
            verify_player(&root, Some(&pin), Some(&payload)).unwrap(),
            root.canonicalize().unwrap().join("FlubberVLC.exe")
        );
        fs::write(root.join("lsl.dll"), b"tampered").unwrap();
        assert!(verify_player(&root, Some(&pin), Some(&payload))
            .unwrap_err()
            .contains("digest mismatch"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_missing_manifest_or_component() {
        let root = fixture();
        let pin = manifest_pin(&root);
        let payload = payload_pin(&root);
        fs::remove_file(root.join("ffmpeg/ffprobe.exe")).unwrap();
        assert!(verify_player(&root, Some(&pin), Some(&payload))
            .unwrap_err()
            .contains("missing an inventoried file"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unexpected_manifest_component() {
        let root = fixture();
        let manifest_path = root.join("manifest.json");
        let mut manifest: BTreeMap<String, String> =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest.insert("../escape.exe".into(), "0".repeat(64));
        fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let pin = manifest_pin(&root);
        let payload = payload_pin(&root);
        assert!(verify_player(&root, Some(&pin), Some(&payload))
            .unwrap_err()
            .contains("unexpected component list"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_changed_payload_manifest_and_noncritical_file() {
        let root = fixture();
        let manifest = manifest_pin(&root);
        let payload = payload_pin(&root);
        fs::write(root.join("vlc/plugins/codec.dll"), b"tampered").unwrap();
        assert!(verify_player(&root, Some(&manifest), Some(&payload))
            .unwrap_err()
            .contains("payload digest mismatch"));
        fs::write(root.join("payload-manifest.json"), b"{}").unwrap();
        assert!(verify_player(&root, Some(&manifest), Some(&payload))
            .unwrap_err()
            .contains("does not match the trusted package"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_missing_and_extra_payload_files() {
        let root = fixture();
        let manifest = manifest_pin(&root);
        let payload = payload_pin(&root);
        fs::remove_file(root.join("vlc/plugins/codec.dll")).unwrap();
        assert!(verify_player(&root, Some(&manifest), Some(&payload))
            .unwrap_err()
            .contains("missing an inventoried file"));
        fs::write(root.join("vlc/plugins/codec.dll"), b"extra player payload").unwrap();
        fs::write(root.join("unexpected.exe"), b"surprise").unwrap();
        assert!(verify_player(&root, Some(&manifest), Some(&payload))
            .unwrap_err()
            .contains("Unexpected player payload"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn accepts_only_the_real_top_level_installer_uninstall_directory() {
        let root = fixture();
        let manifest = manifest_pin(&root);
        let payload = payload_pin(&root);
        let uninst = root.join("uninst");
        fs::create_dir(&uninst).unwrap();
        fs::write(uninst.join("unins000.exe"), b"installer-owned").unwrap();
        fs::write(uninst.join("unins000.dat"), b"installer-owned").unwrap();
        assert!(verify_player(&root, Some(&manifest), Some(&payload)).is_ok());

        let nested = root.join("vlc/uninst");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("unexpected.exe"), b"not installer-owned").unwrap();
        assert!(verify_player(&root, Some(&manifest), Some(&payload))
            .unwrap_err()
            .contains("Unexpected player payload: vlc/uninst/unexpected.exe"));
        fs::remove_dir_all(nested).unwrap();

        fs::remove_dir_all(&uninst).unwrap();
        fs::write(&uninst, b"not a directory").unwrap();
        assert!(verify_player(&root, Some(&manifest), Some(&payload))
            .unwrap_err()
            .contains("Unexpected player payload: uninst"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn verifies_hidden_files_in_the_payload_inventory() {
        let root = fixture();
        let hidden = root.join("vlc/hidden.dll");
        fs::write(&hidden, b"hidden player payload").unwrap();
        let status = Command::new("attrib")
            .arg("+H")
            .arg(&hidden)
            .status()
            .unwrap();
        assert!(status.success());
        let path = root.join("payload-manifest.json");
        let mut payload: BTreeMap<String, String> =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        payload.insert(
            "vlc/hidden.dll".into(),
            format!("{:x}", Sha256::digest(b"hidden player payload")),
        );
        fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
        let manifest_pin = manifest_pin(&root);
        let payload_pin = payload_pin(&root);
        assert!(verify_player(&root, Some(&manifest_pin), Some(&payload_pin)).is_ok());
        fs::write(&hidden, b"tampered").unwrap();
        assert!(
            verify_player(&root, Some(&manifest_pin), Some(&payload_pin))
                .unwrap_err()
                .contains("payload digest mismatch: vlc/hidden.dll")
        );
        Command::new("attrib")
            .arg("-H")
            .arg(&hidden)
            .status()
            .unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_payload_inventory_directory_traversal_even_with_matching_pin() {
        let root = fixture();
        let manifest = manifest_pin(&root);
        let path = root.join("payload-manifest.json");
        let mut payload: BTreeMap<String, String> =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        payload.insert("../outside.exe".into(), "0".repeat(64));
        fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
        let pin = payload_pin(&root);
        assert!(verify_player(&root, Some(&manifest), Some(&pin))
            .unwrap_err()
            .contains("Invalid player payload entry"));
        fs::remove_dir_all(root).unwrap();
    }
}
