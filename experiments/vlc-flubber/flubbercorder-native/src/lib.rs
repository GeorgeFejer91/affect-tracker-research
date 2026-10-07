mod xdf;

use labstream::Query;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::error::Error;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn default_panel() -> u32 {
    25
}
fn default_step() -> u32 {
    10
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecipeFile {
    schema: String,
    video: PathBuf,
    #[serde(default = "default_panel")]
    panel_percent: u32,
    #[serde(default = "default_step")]
    step_percent: u32,
    #[serde(default)]
    required_streams: Vec<String>,
}

struct Recipe {
    video: PathBuf,
    panel_percent: u32,
    step_percent: u32,
    required_streams: Vec<String>,
    filename: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeInfo {
    pub video: String,
    pub panel_percent: u32,
    pub required_streams: Vec<String>,
}

pub fn inspect_recipe(path: &Path) -> std::result::Result<RecipeInfo, Box<dyn Error>> {
    let recipe = Recipe::read(path)?;
    Ok(RecipeInfo {
        video: recipe.filename,
        panel_percent: recipe.panel_percent,
        required_streams: recipe.required_streams,
    })
}

impl Recipe {
    fn read(path: &Path) -> Result<Self> {
        if fs::metadata(path)?.len() > 64 * 1024 {
            return Err("Experiment JSON exceeds 64 KiB".into());
        }
        let raw: RecipeFile = serde_json::from_slice(&fs::read(path)?)?;
        if raw.schema != "flubbercorder-experiment/v1"
            || !(10..=100).contains(&raw.panel_percent)
            || !(1..=100).contains(&raw.step_percent)
            || raw.required_streams.len() > 16
        {
            return Err("Unsupported experiment schema or setting".into());
        }
        let mut unique = std::collections::HashSet::new();
        for name in &raw.required_streams {
            if name.is_empty()
                || name.len() > 128
                || !name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
                || !unique.insert(name)
                || matches!(name.as_str(), "VLC_Flubber_Affect" | "VLC_Flubber_Markers")
            {
                return Err("Required LSL names must be unique ASCII names".into());
            }
        }
        let parent = path
            .canonicalize()?
            .parent()
            .ok_or("Recipe has no parent")?
            .to_path_buf();
        let video = parent.join(raw.video).canonicalize()?;
        if !video.is_file() {
            return Err("Recipe video is not a file".into());
        }
        let filename = video
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Video filename is unavailable")?
            .to_owned();
        if filename.len() > 900 {
            return Err("Video filename is too long for VLC markers".into());
        }
        Ok(Self {
            video,
            panel_percent: raw.panel_percent,
            step_percent: raw.step_percent,
            required_streams: raw.required_streams,
            filename,
        })
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectPoint {
    pub lsl_time: f64,
    pub valence: f32,
    pub arousal: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub lsl_time: f64,
    pub label: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Variable {
    pub label: String,
    pub value: String,
}

pub fn validate_variables(variables: &[Variable]) -> std::result::Result<(), String> {
    if variables.len() > 6 {
        return Err("At most six custom variables are supported".into());
    }
    let mut labels = HashSet::new();
    for variable in variables {
        let label = variable.label.trim();
        if label.is_empty()
            || label.chars().count() > 128
            || variable.value.chars().count() > 128
            || !labels.insert(label.to_lowercase())
        {
            return Err("Variable labels must be unique and at most 128 characters; values are at most 128 characters".into());
        }
    }
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub xdf: PathBuf,
    pub csv: PathBuf,
    pub affect_samples: u64,
    pub markers: Vec<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Armed,
    Running,
    Paused,
    Complete,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub phase: Phase,
    pub video: String,
    pub panel_percent: u32,
    pub source_id: String,
    pub required_streams: Vec<String>,
    pub csv_path: PathBuf,
    pub xdf_path: Option<PathBuf>,
    pub latest: Option<AffectPoint>,
    pub history: Vec<AffectPoint>,
    pub markers: Vec<Marker>,
    pub subscribed: HashMap<String, String>,
    pub first_data: Vec<String>,
    pub recorder_alive: bool,
    pub volume_percent: u32,
    pub metadata_path: PathBuf,
}

struct Launched {
    pid: u32,
    port: u16,
    csv: PathBuf,
    stock_vlc: bool,
    child: Child,
    _output: Option<thread::JoinHandle<()>>,
    _errors: Option<thread::JoinHandle<()>>,
}

impl Drop for Launched {
    fn drop(&mut self) {
        let _ = rc(self.port, "quit");
        let deadline = Instant::now() + Duration::from_secs(3);
        while self.child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn line_value<'a>(lines: &'a [String], prefix: &str) -> Result<&'a str> {
    lines
        .iter()
        .find_map(|line| line.strip_prefix(prefix))
        .ok_or_else(|| format!("Player omitted {prefix}").into())
}

fn launch(recipe: &Recipe, player_dir: &Path, headless: bool) -> Result<Launched> {
    if player_dir.join("vlc.exe").is_file() && player_dir.join("flubber_bridge.dll").is_file() {
        return launch_stock_vlc(recipe, player_dir, headless);
    }
    launch_legacy_player(recipe, player_dir, headless)
}

fn launch_stock_vlc(recipe: &Recipe, player_dir: &Path, headless: bool) -> Result<Launched> {
    let parent = recipe.video.parent().ok_or("Video has no parent")?;
    let stem = recipe.video.file_stem().and_then(|s| s.to_str()).ok_or("Video stem is unavailable")?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let csv = (0..100_u32)
        .map(|retry| parent.join(format!("{stem}-flubbercorder-{stamp}-{}-{retry}.csv", std::process::id())))
        .find(|path| !path.exists())
        .ok_or("No unique affect CSV name available")?;
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    let mut command = Command::new(player_dir.join("vlc.exe"));
    command
        .arg("--no-one-instance")
        .arg("--no-qt-privacy-ask")
        .arg("--intf=qt")
        .arg("--extraintf=rc")
        .arg(format!("--rc-host=127.0.0.1:{port}"))
        .arg("--rc-quiet")
        .env("VLC_FLUBBER_CSV_PATH", &csv)
        .env("VLC_FLUBBER_PANEL_PERCENT", recipe.panel_percent.to_string())
        .env("VLC_FLUBBER_STEP_PERCENT", recipe.step_percent.to_string())
        .current_dir(player_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if headless {
        command.arg("--qt-start-minimized");
    }
    let mut child = command.spawn()?;
    let address: SocketAddr = format!("127.0.0.1:{port}").parse()?;
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if let Some(status) = child.try_wait()? {
            return Err(format!("Stock VLC exited before RC readiness: {status}").into());
        }
        if stock_rc_ready(address) {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Stock VLC did not open its local RC port".into());
        }
        thread::sleep(Duration::from_millis(50));
    }
    Ok(Launched {
        pid: child.id(),
        port,
        csv,
        stock_vlc: true,
        child,
        _output: None,
        _errors: None,
    })
}

fn stock_rc_ready(address: SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(100)) else {
        return false;
    };
    if stream.set_read_timeout(Some(Duration::from_millis(250))).is_err()
        || stream.write_all(b"is_playing\n").is_err()
    {
        return false;
    }
    let mut reader = BufReader::new(stream);
    for _ in 0..4 {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.is_empty() {
            return false;
        }
        if line.trim() == "0" {
            return true;
        }
    }
    false
}

fn launch_legacy_player(recipe: &Recipe, player_dir: &Path, headless: bool) -> Result<Launched> {
    let exe = player_dir.join("FlubberVLC.exe");
    if !exe.is_file() {
        return Err(format!("Missing installed player: {}", exe.display()).into());
    }
    let mut command = Command::new(exe);
    command
        .arg(&recipe.video)
        .arg("--arm")
        .arg("--panel-percent")
        .arg(recipe.panel_percent.to_string())
        .arg("--step-percent")
        .arg(recipe.step_percent.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if headless {
        command.arg("--headless");
    }
    let mut child = command.spawn()?;
    let mut reader = BufReader::new(child.stdout.take().ok_or("Player output unavailable")?);
    // Read the six readiness lines, then keep draining the long-lived player.
    let mut lines = Vec::with_capacity(6);
    for _ in 0..6 {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            let mut detail = String::new();
            if let Some(stderr) = child.stderr.take() {
                BufReader::new(stderr).read_to_string(&mut detail)?;
            }
            let _ = child.wait();
            return Err(format!(
                "Player exited before readiness: {}",
                detail
                    .trim()
                    .lines()
                    .last()
                    .unwrap_or("no diagnostic available")
            )
            .into());
        }
        lines.push(line.trim_end().to_owned());
    }
    let pid = line_value(&lines, "VLC PID: ")?.parse()?;
    let port = line_value(&lines, "VLC RC: 127.0.0.1:")?.parse()?;
    let source = PathBuf::from(line_value(&lines, "Source video: ")?);
    let csv = PathBuf::from(line_value(&lines, "Affect CSV: ")?);
    if pid != child.id()
        || source.canonicalize()? != recipe.video
        || csv.extension().is_none_or(|value| value != "csv")
        || csv
            .parent()
            .ok_or("Player CSV has no parent")?
            .canonicalize()?
            != recipe.video.parent().ok_or("Video has no parent")?
    {
        return Err("Player returned invalid media or recording paths".into());
    }
    let output = thread::spawn(move || {
        let _ = std::io::copy(&mut reader, &mut std::io::sink());
    });
    let mut stderr = child
        .stderr
        .take()
        .ok_or("Player diagnostics unavailable")?;
    let errors = thread::spawn(move || {
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
    });
    Ok(Launched {
        pid,
        port,
        csv,
        stock_vlc: false,
        child,
        _output: Some(output),
        _errors: Some(errors),
    })
}

fn rc(port: u16, command: &str) -> Result<()> {
    let address: SocketAddr = format!("127.0.0.1:{port}").parse()?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(500))?;
    stream.set_write_timeout(Some(Duration::from_millis(500)))?;
    stream.write_all(command.as_bytes())?;
    stream.write_all(b"\n")?;
    Ok(())
}

fn vlc_rc_path(path: &Path) -> Result<String> {
    let text = path.to_str().ok_or("Video path is not UTF-8")?;
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        Ok(format!(r"\\{rest}"))
    } else {
        Ok(text.strip_prefix(r"\\?\").unwrap_or(text).to_owned())
    }
}

fn hex(value: &str) -> String {
    value.bytes().map(|b| format!("{b:02x}")).collect()
}

fn unhex(value: &str) -> Result<String> {
    if value.len() % 2 != 0 {
        return Err("Invalid recorder marker encoding".into());
    }
    let bytes = value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| Ok(u8::from_str_radix(std::str::from_utf8(pair)?, 16)?))
        .collect::<Result<Vec<_>>>()?;
    Ok(String::from_utf8(bytes)?)
}

fn marker_suffix<'a>(label: &'a str, filename: &str) -> Option<&'a str> {
    label
        .strip_prefix(&format!("{filename}_"))
        .filter(|suffix| {
            matches!(
                *suffix,
                "Start"
                    | "Stop"
                    | "Pause"
                    | "Resume"
                    | "Interrupt"
                    | "BufferingStart"
                    | "BufferingEnd"
                    | "End"
                    | "Error"
            )
        })
}

pub(crate) fn valid_marker_sequence(labels: &[String], filename: &str) -> bool {
    if labels.len() < 2 {
        return false;
    }
    labels.iter().enumerate().all(|(index, label)| {
        let suffix = marker_suffix(label, filename);
        if index == 0 {
            suffix == Some("Start")
        } else if index + 1 == labels.len() {
            suffix == Some("Stop")
        } else {
            matches!(
                suffix,
                Some("Pause" | "Resume" | "Interrupt" | "BufferingStart" | "BufferingEnd")
            ) || (index + 2 == labels.len() && matches!(suffix, Some("End" | "Error")))
        }
    })
}

pub struct Session {
    recipe: Recipe,
    launched: Launched,
    source: String,
    expected: HashMap<String, String>,
    recorder: Child,
    receipts: Receiver<String>,
    partial: PathBuf,
    final_xdf: PathBuf,
    phase: Phase,
    history: VecDeque<AffectPoint>,
    markers: Vec<Marker>,
    first_data: HashSet<String>,
    summary: Option<Summary>,
    volume_percent: u32,
    variables: Vec<Variable>,
    metadata_path: PathBuf,
}

impl Session {
    pub fn arm(
        recipe_path: &Path,
        player_dir: &Path,
        recorder_dir: &Path,
        data_dir: &Path,
        headless: bool,
    ) -> Result<Self> {
        let recipe = Recipe::read(recipe_path)?;
        fs::create_dir_all(data_dir)?;
        let data_dir = data_dir.canonicalize()?;
        let launched = launch(&recipe, player_dir, headless)?;
        let result = Self::arm_launched(recipe, launched, recorder_dir, &data_dir);
        if let Err((port, _)) = &result {
            let _ = rc(*port, "quit");
        }
        result.map_err(|(_, error)| error)
    }

    fn arm_launched(
        recipe: Recipe,
        launched: Launched,
        recorder_dir: &Path,
        data_dir: &Path,
    ) -> std::result::Result<Self, (u16, Box<dyn Error>)> {
        let port = launched.port;
        let result = (|| -> Result<Self> {
            let source = format!("vlc-flubber-{}", launched.pid);
            let affect_id = format!("{source}-affect");
            let marker_id = format!("{source}-markers");
            let deadline = Instant::now() + Duration::from_secs(8);
            let expected = loop {
                let found = labstream::resolve_all(&Query::all(), Duration::from_millis(250))?;
                let affect = found
                    .iter()
                    .find(|s| s.source_id() == affect_id && s.name() == "VLC_Flubber_Affect");
                let markers = found
                    .iter()
                    .find(|s| s.source_id() == marker_id && s.name() == "VLC_Flubber_Markers");
                let mut expected = HashMap::from([
                    (affect_id.clone(), "VLC_Flubber_Affect".to_owned()),
                    (marker_id.clone(), "VLC_Flubber_Markers".to_owned()),
                ]);
                let mut all_external = true;
                for name in &recipe.required_streams {
                    let matches: Vec<_> = found.iter().filter(|s| s.name() == name).collect();
                    if matches.len() > 1 {
                        return Err(format!("Multiple LSL sources named {name}").into());
                    }
                    if let Some(info) = matches.first() {
                        if info.source_id().is_empty() {
                            return Err(format!("LSL source {name} lacks an ID").into());
                        }
                        expected.insert(info.source_id().to_owned(), name.clone());
                    } else {
                        all_external = false;
                    }
                }
                if affect.is_some() && markers.is_some() && all_external {
                    break expected;
                }
                if Instant::now() >= deadline {
                    return Err("Required LSL streams are not discoverable".into());
                }
                thread::sleep(Duration::from_millis(100));
            };
            let recordings = data_dir.join("recordings");
            fs::create_dir_all(&recordings)?;
            let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
            let basename = format!("flubbercorder-{stamp}-{}", std::process::id());
            let partial = recordings.join(format!("{basename}.xdf.partial"));
            let final_xdf = recordings.join(format!("{basename}.xdf"));
            let metadata_path = recordings.join(format!("{basename}.session.json"));
            if partial.exists() || final_xdf.exists() || metadata_path.exists() {
                return Err("XDF destination already exists".into());
            }
            let executable = recorder_dir.join("respyrecorder.exe");
            if !executable.is_file() {
                return Err("Native XDF recorder is missing".into());
            }
            let query = format!(
                "source_id='{affect_id}' or source_id='{marker_id}'{}",
                recipe
                    .required_streams
                    .iter()
                    .map(|n| format!(" or name='{n}'"))
                    .collect::<String>()
            );
            let mut recorder = Command::new(executable)
                .arg(&partial)
                .arg(query)
                .current_dir(recorder_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()?;
            let stderr = recorder
                .stderr
                .take()
                .ok_or("Recorder receipts unavailable")?;
            let (sender, receipts) = mpsc::channel();
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines() {
                    match line {
                        Ok(line) => {
                            if sender.send(line).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
            let mut pending = expected.clone();
            let deadline = Instant::now() + Duration::from_secs(60);
            while !pending.is_empty() {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match receipts.recv_timeout(remaining) {
                    Ok(line) if line.starts_with("RESPYRA_RECORDER/1 ") => {
                        let parts: Vec<_> = line.split_whitespace().collect();
                        if parts.len() != 3 {
                            break;
                        }
                        pending.retain(|source, name| {
                            !(parts[1].eq_ignore_ascii_case(&hex(source))
                                && parts[2].eq_ignore_ascii_case(&hex(name)))
                        });
                    }
                    Ok(line) if line.contains("RESPYRA_RECORDER_ERROR") => break,
                    Ok(_) => {}
                    Err(_) => break,
                }
                if recorder.try_wait()?.is_some() {
                    break;
                }
            }
            if !pending.is_empty() {
                let _ = recorder.kill();
                let _ = recorder.wait();
                return Err(format!("Recorder did not subscribe to {pending:?}").into());
            }
            Ok(Self {
                recipe,
                launched,
                source,
                expected,
                recorder,
                receipts,
                partial,
                final_xdf,
                phase: Phase::Armed,
                history: VecDeque::new(),
                markers: Vec::new(),
                first_data: HashSet::new(),
                summary: None,
                volume_percent: 100,
                variables: Vec::new(),
                metadata_path,
            })
        })();
        result.map_err(|error| (port, error))
    }

    pub fn vlc_pid(&self) -> u32 {
        self.launched.pid
    }
    pub fn is_complete(&self) -> bool {
        self.phase == Phase::Complete
    }
    pub fn summary(&self) -> Option<&Summary> {
        self.summary.as_ref()
    }

    pub fn snapshot(&mut self) -> Snapshot {
        Snapshot {
            phase: self.phase,
            video: self.recipe.filename.clone(),
            panel_percent: self.recipe.panel_percent,
            source_id: self.source.clone(),
            required_streams: self.recipe.required_streams.clone(),
            csv_path: self.launched.csv.clone(),
            xdf_path: self.summary.as_ref().map(|s| s.xdf.clone()),
            latest: self.history.back().cloned(),
            history: self.history.iter().cloned().collect(),
            markers: self.markers.clone(),
            subscribed: self.expected.clone(),
            first_data: self.first_data.iter().cloned().collect(),
            recorder_alive: self.recorder.try_wait().ok().flatten().is_none(),
            volume_percent: self.volume_percent,
            metadata_path: self.metadata_path.clone(),
        }
    }

    pub fn start(&mut self) -> Result<()> {
        if self.phase != Phase::Armed {
            return Err("Experiment is not armed".into());
        }
        if self.recorder.try_wait()?.is_some() {
            return Err("Recorder exited before playback".into());
        }
        let metadata = serde_json::json!({
            "schema": "flubbercorder-session/v1",
            "video": self.recipe.filename,
            "panelPercent": self.recipe.panel_percent,
            "stepPercent": self.recipe.step_percent,
            "sourceId": self.source,
            "xdf": self.final_xdf.file_name().ok_or("XDF filename is unavailable")?.to_string_lossy(),
            "customVariables": self.variables,
        });
        let mut metadata_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&self.metadata_path)?;
        serde_json::to_writer_pretty(&mut metadata_file, &metadata)?;
        metadata_file.write_all(b"\n")?;
        metadata_file.sync_all()?;
        if self.launched.stock_vlc {
            let video = vlc_rc_path(&self.recipe.video)?;
            rc(self.launched.port, &format!("add {video} :fullscreen"))?;
            rc(self.launched.port, "f on")?;
            let start = format!("{}_Start", self.recipe.filename);
            let deadline = Instant::now() + Duration::from_secs(8);
            while !self.markers.iter().any(|marker| marker.label == start) {
                if self.launched.child.try_wait()?.is_some() {
                    return Err("Stock VLC exited before the video Start marker".into());
                }
                if self.recorder.try_wait()?.is_some() {
                    return Err("XDF recorder exited before the video Start marker".into());
                }
                if Instant::now() >= deadline {
                    return Err("Stock VLC did not start the selected video".into());
                }
                match self.receipts.recv_timeout(Duration::from_millis(50)) {
                    Ok(line) => self.consume_receipt(&line)?,
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        return Err("XDF recorder receipts closed before the video Start marker".into());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
            }
        } else {
            rc(self.launched.port, "f on")?;
            rc(self.launched.port, "play")?;
        }
        self.phase = Phase::Running;
        Ok(())
    }

    pub fn set_variables(&mut self, variables: Vec<Variable>) -> Result<()> {
        if self.phase != Phase::Armed {
            return Err("Custom variables must be set before Start".into());
        }
        validate_variables(&variables)?;
        self.variables = variables;
        Ok(())
    }

    pub fn pause(&mut self) -> Result<()> {
        if self.phase != Phase::Running {
            return Err("Experiment is not running".into());
        }
        rc(self.launched.port, "pause")?;
        self.phase = Phase::Paused;
        Ok(())
    }

    pub fn resume(&mut self) -> Result<()> {
        if self.phase != Phase::Paused {
            return Err("Experiment is not paused".into());
        }
        rc(self.launched.port, "pause")?;
        self.phase = Phase::Running;
        Ok(())
    }

    pub fn stop(&mut self) -> Result<()> {
        if !matches!(self.phase, Phase::Running | Phase::Paused) {
            return Err("No active experiment to stop".into());
        }
        rc(self.launched.port, "stop")?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while !self.is_complete() && Instant::now() < deadline {
            self.tick()?;
            thread::sleep(Duration::from_millis(20));
        }
        if !self.is_complete() {
            return Err("VLC did not emit a Stop marker".into());
        }
        Ok(())
    }

    pub fn set_volume(&mut self, percent: u32) -> Result<()> {
        if percent > 100 || !matches!(self.phase, Phase::Armed | Phase::Running | Phase::Paused) {
            return Err("Volume must be 0–100 during an active player session".into());
        }
        rc(
            self.launched.port,
            &format!("volume {}", (percent * 256 + 50) / 100),
        )?;
        self.volume_percent = percent;
        Ok(())
    }

    pub fn tick(&mut self) -> Result<()> {
        if self.phase == Phase::Complete {
            return Ok(());
        }
        if self.recorder.try_wait()?.is_some() {
            return Err("XDF recorder exited during experiment".into());
        }
        let stop = format!("{}_Stop", self.recipe.filename);
        while let Ok(line) = self.receipts.try_recv() {
            self.consume_receipt(&line)?;
        }
        if self.markers.last().is_some_and(|m| m.label == stop) {
            self.finish()?;
        } else if self.launched.child.try_wait()?.is_some() {
            return Err("VLC exited without a recorded Stop marker".into());
        }
        Ok(())
    }

    fn consume_receipt(&mut self, line: &str) -> Result<()> {
        if line.contains("RESPYRA_RECORDER_ERROR") {
            return Err("XDF recorder reported an error".into());
        }
        if let Some(encoded) = line.strip_prefix("RESPYRA_RECORDER_DATA/1 ") {
            for source in self.expected.keys() {
                if encoded.trim().eq_ignore_ascii_case(&hex(source)) {
                    self.first_data.insert(source.clone());
                }
            }
        }
        if let Some(data) = line.strip_prefix("RESPYRA_RECORDER_AFFECT/1 ") {
            let parts: Vec<_> = data.split_whitespace().collect();
            if parts.len() != 4
                || !parts[0].eq_ignore_ascii_case(&hex(&format!("{}-affect", self.source)))
            {
                return Err("Invalid recorder affect receipt".into());
            }
            let stamp: f64 = parts[1].parse()?;
            let valence: f32 = parts[2].parse()?;
            let arousal: f32 = parts[3].parse()?;
            if !stamp.is_finite()
                || !(-1.0..=1.0).contains(&valence)
                || !(-1.0..=1.0).contains(&arousal)
            {
                return Err("Invalid VLC affect sample".into());
            }
            self.history.push_back(AffectPoint {
                lsl_time: stamp,
                valence,
                arousal,
            });
            while self.history.len() > 600 {
                self.history.pop_front();
            }
        }
        if let Some(data) = line.strip_prefix("RESPYRA_RECORDER_MARKER/1 ") {
            let parts: Vec<_> = data.split_whitespace().collect();
            if parts.len() != 3
                || !parts[0].eq_ignore_ascii_case(&hex(&format!("{}-markers", self.source)))
            {
                return Err("Invalid recorder marker receipt".into());
            }
            let stamp: f64 = parts[1].parse()?;
            let label = unhex(parts[2])?;
            let suffix = marker_suffix(&label, &self.recipe.filename);
            if !stamp.is_finite() || suffix.is_none() {
                return Err("Unexpected VLC marker".into());
            }
            match suffix {
                Some("Pause") if self.phase == Phase::Running => self.phase = Phase::Paused,
                Some("Resume") if self.phase == Phase::Paused => self.phase = Phase::Running,
                _ => {}
            }
            self.markers.push(Marker {
                lsl_time: stamp,
                label,
            });
        }
        Ok(())
    }

    fn finish(&mut self) -> Result<()> {
        rc(self.launched.port, "stop")?;
        thread::sleep(Duration::from_millis(600));
        let mut input = self
            .recorder
            .stdin
            .take()
            .ok_or("Recorder input unavailable")?;
        input.write_all(b"\n")?;
        drop(input);
        let deadline = Instant::now() + Duration::from_secs(12);
        let status = loop {
            if let Some(status) = self.recorder.try_wait()? {
                break status;
            }
            if Instant::now() >= deadline {
                let _ = self.recorder.kill();
                let _ = self.recorder.wait();
                return Err("XDF recorder did not close; partial file preserved".into());
            }
            thread::sleep(Duration::from_millis(50));
        };
        if !status.success() {
            return Err("XDF recorder failed; partial file preserved".into());
        }
        let receipts_deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < receipts_deadline {
            match self.receipts.recv_timeout(Duration::from_millis(50)) {
                Ok(line) => self.consume_receipt(&line)?,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
        let result = xdf::inspect(
            &self.partial,
            &self.source,
            &self.recipe.filename,
            &self.expected,
        )?;
        let series = self.launched.csv.clone();
        let rows = fs::read_to_string(&series)?
            .lines()
            .count()
            .saturating_sub(1) as u64;
        if rows == 0 || result.affect_samples < rows {
            return Err(
                "XDF has fewer affect samples than the video CSV; partial XDF preserved".into(),
            );
        }
        if self.final_xdf.exists() {
            return Err("Final XDF destination already exists".into());
        }
        fs::rename(&self.partial, &self.final_xdf)?;
        self.summary = Some(Summary {
            xdf: self.final_xdf.clone(),
            csv: series,
            affect_samples: result.affect_samples,
            markers: result.markers,
        });
        self.phase = Phase::Complete;
        Ok(())
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if self.recorder.try_wait().ok().flatten().is_none() {
            let _ = self.recorder.kill();
            let _ = self.recorder.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn vlc_rc_path_removes_windows_verbatim_prefix() {
        use std::path::Path;
        assert_eq!(super::vlc_rc_path(Path::new(r"\\?\C:\video.mp4")).unwrap(), r"C:\video.mp4");
        assert_eq!(super::vlc_rc_path(Path::new(r"\\?\UNC\server\share\video.mp4")).unwrap(), r"\\server\share\video.mp4");
    }
    use super::{valid_marker_sequence, validate_variables, Variable};

    #[test]
    fn variable_labels_are_unique_before_recording() {
        let rows = [
            Variable {
                label: "Age".into(),
                value: "31".into(),
            },
            Variable {
                label: " age ".into(),
                value: "32".into(),
            },
        ];
        assert!(validate_variables(&rows).is_err());
        assert!(validate_variables(&rows[..1]).is_ok());
    }

    #[test]
    fn xdf_marker_contract_accepts_control_events_between_bookends() {
        let filename = "clip.mp4";
        let labels = [
            "clip.mp4_Start",
            "clip.mp4_Interrupt",
            "clip.mp4_Pause",
            "clip.mp4_Resume",
            "clip.mp4_BufferingStart",
            "clip.mp4_BufferingEnd",
            "clip.mp4_End",
            "clip.mp4_Stop",
        ]
        .map(str::to_owned);
        assert!(valid_marker_sequence(&labels, filename));
        assert!(valid_marker_sequence(
            &["clip.mp4_Start".into(), "clip.mp4_Stop".into()],
            filename
        ));
        let duplicate_start = [
            "clip.mp4_Start".into(),
            "clip.mp4_Start".into(),
            "clip.mp4_Stop".into(),
        ];
        assert!(!valid_marker_sequence(&duplicate_start, filename));
        let wrong_video = ["other.mp4_Start".into(), "clip.mp4_Stop".into()];
        assert!(!valid_marker_sequence(&wrong_video, filename));
        let terminal_before_pause = [
            "clip.mp4_Start".into(),
            "clip.mp4_End".into(),
            "clip.mp4_Pause".into(),
            "clip.mp4_Stop".into(),
        ];
        assert!(!valid_marker_sequence(&terminal_before_pause, filename));
    }
}
