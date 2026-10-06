mod xdf;

use labstream::Query;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::error::Error;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
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
    prepared: PathBuf,
    csv: PathBuf,
}

fn line_value<'a>(lines: &'a [String], prefix: &str) -> Result<&'a str> {
    lines
        .iter()
        .find_map(|line| line.strip_prefix(prefix))
        .ok_or_else(|| format!("Player omitted {prefix}").into())
}

fn launch(recipe: &Recipe, player_dir: &Path, data_dir: &Path, headless: bool) -> Result<Launched> {
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
        .arg("--data-dir")
        .arg(data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if headless {
        command.arg("--headless");
    }
    let mut child = command.spawn()?;
    let mut reader = BufReader::new(child.stdout.take().ok_or("Player output unavailable")?);
    // The spawned VLC keeps a Windows pipe handle open; read the six known
    // receipt lines rather than waiting for stdout EOF.
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
    if !child.wait()?.success() {
        return Err("Player launcher failed".into());
    }
    let pid = line_value(&lines, "VLC PID: ")?.parse()?;
    let port = line_value(&lines, "VLC RC: 127.0.0.1:")?.parse()?;
    let prepared = PathBuf::from(line_value(&lines, "Prepared video: ")?);
    let csv = PathBuf::from(line_value(&lines, "Affect CSV: ")?);
    if !prepared.is_file() || !csv.starts_with(data_dir.join("recordings")) {
        return Err("Player returned invalid media or recording paths".into());
    }
    Ok(Launched {
        pid,
        port,
        prepared,
        csv,
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

fn rc_is_playing(port: u16) -> Result<Option<bool>> {
    let address: SocketAddr = format!("127.0.0.1:{port}").parse()?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(200))?;
    stream.set_read_timeout(Some(Duration::from_millis(100)))?;
    stream.write_all(b"is_playing\n")?;
    for line in BufReader::new(stream).lines().take(16) {
        match line {
            Ok(line) if line.trim() == "1" => return Ok(Some(true)),
            Ok(line) if line.trim() == "0" => return Ok(Some(false)),
            Ok(_) => {}
            Err(error)
                if error.kind() == std::io::ErrorKind::TimedOut
                    || error.kind() == std::io::ErrorKind::WouldBlock =>
            {
                return Ok(None)
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(None)
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
    playback_seen: bool,
    stopping: bool,
    last_rc_poll: Instant,
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
        let launched = launch(&recipe, player_dir, &data_dir, headless)?;
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
                playback_seen: false,
                stopping: false,
                last_rc_poll: Instant::now() - Duration::from_millis(250),
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
        let uri = url::Url::from_file_path(&self.launched.prepared)
            .map_err(|()| "Prepared video cannot be expressed as a file URI")?;
        rc(self.launched.port, "f on")?;
        rc(self.launched.port, &format!("add {uri}"))?;
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
        self.playback_seen = false;
        Ok(())
    }

    pub fn stop(&mut self) -> Result<()> {
        if !matches!(self.phase, Phase::Running | Phase::Paused) {
            return Err("No active experiment to stop".into());
        }
        rc(self.launched.port, "stop")?;
        self.stopping = true;
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
        let start = format!("{}_Start", self.recipe.filename);
        let stop = format!("{}_Stop", self.recipe.filename);
        while let Ok(line) = self.receipts.try_recv() {
            self.consume_receipt(&line, &start, &stop)?;
        }
        let playing = if (matches!(self.phase, Phase::Running) || self.stopping)
            && self.last_rc_poll.elapsed() >= Duration::from_millis(250)
        {
            self.last_rc_poll = Instant::now();
            rc_is_playing(self.launched.port)?
        } else {
            None
        };
        if playing == Some(true) {
            self.playback_seen = true;
        }
        if self.markers.last().is_some_and(|m| m.label == stop)
            || (playing == Some(false) && (self.stopping || self.playback_seen))
        {
            self.finish()?;
        }
        Ok(())
    }

    fn consume_receipt(&mut self, line: &str, start: &str, stop: &str) -> Result<()> {
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
            if !stamp.is_finite() || (label != start && label != stop) {
                return Err("Unexpected VLC marker".into());
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
        let start = format!("{}_Start", self.recipe.filename);
        let stop = format!("{}_Stop", self.recipe.filename);
        let receipts_deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < receipts_deadline {
            match self.receipts.recv_timeout(Duration::from_millis(50)) {
                Ok(line) => self.consume_receipt(&line, &start, &stop)?,
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
        let series = self.launched.csv.with_file_name(format!(
            "{}-timeseries.csv",
            self.launched
                .csv
                .file_stem()
                .ok_or("CSV path has no stem")?
                .to_string_lossy()
        ));
        let rows = fs::read_to_string(&series)?
            .lines()
            .count()
            .saturating_sub(1) as u64;
        if rows == 0 || rows != result.affect_samples {
            return Err("VLC CSV and XDF affect counts differ; partial XDF preserved".into());
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
        let _ = rc(self.launched.port, "quit");
        if self.recorder.try_wait().ok().flatten().is_none() {
            let _ = self.recorder.kill();
            let _ = self.recorder.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_variables, Variable};

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
}
