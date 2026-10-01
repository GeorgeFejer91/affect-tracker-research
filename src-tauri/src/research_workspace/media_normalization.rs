use super::*;
use std::process::Command;

const PREPARED_DIR: &str = ".prepared";
const DURATION_TOLERANCE_MS: u64 = 250;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerMediaNormalizationRequest {
    pub workspace_id: String,
    pub entries: Vec<PlannerMediaNormalizationEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerMediaNormalizationEntry {
    pub source_relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedMediaUrlRequest {
    pub workspace_id: String,
    pub package_relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerMediaNormalizationReceipt {
    pub workspace_id: String,
    pub entries: Vec<PreparedPlannerMediaEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedPlannerMediaEntry {
    pub source_relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub prepared_playback: PreparedPlaybackReceipt,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedPlaybackReceipt {
    pub strategy: &'static str,
    pub package_relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub duration_ms: u64,
    pub container: &'static str,
    pub video_codec: &'static str,
    pub audio_codec: String,
    pub pixel_format: &'static str,
    pub fast_start: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedMediaUrlReceipt {
    pub media_grant_id: String,
    pub media_url: String,
    pub package_relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub duration_ms: u64,
    pub mime_type: &'static str,
}

#[derive(Debug, Clone)]
struct ProbeInfo {
    duration_ms: u64,
    video_codec: String,
    pixel_format: String,
    audio_codecs: Vec<String>,
}

impl WorkspaceService {
    pub fn prepare_planner_media(
        &self,
        request: PlannerMediaNormalizationRequest,
    ) -> ResearchResult<PlannerMediaNormalizationReceipt> {
        if request.entries.is_empty() || request.entries.len() > MAX_SCAN_FILES {
            return Err(CommandError::invalid_contract(
                "Prepared media requires one bounded video catalogue.",
            ));
        }
        let (workspace_id, package_assets) = {
            let guard = self.lock_selected();
            let workspace = selected_ref(&guard, &request.workspace_id)?;
            let libraries = validate_selected_workspace(workspace)?;
            (workspace.id.clone(), libraries.package_assets.clone())
        };
        let prepared_dir = ensure_exact_child_directory(&package_assets, PREPARED_DIR)?;
        let mut entries = Vec::with_capacity(request.entries.len());
        for entry in &request.entries {
            entries.push(prepare_one(&package_assets, &prepared_dir, entry)?);
        }
        Ok(PlannerMediaNormalizationReceipt {
            workspace_id,
            entries,
        })
    }

    pub fn issue_prepared_media_url(
        &self,
        request: PreparedMediaUrlRequest,
    ) -> ResearchResult<PreparedMediaUrlReceipt> {
        validate_prepared_url_request(&request)?;
        let mut guard = self.lock_selected();
        let workspace = selected_mut(&mut guard, &request.workspace_id)?;
        let libraries = validate_selected_workspace(workspace)?;
        let path =
            resolve_prepared_playback(&libraries.package_assets, &request.package_relative_path)?;
        let mut locked_file = open_read_locked(&path)?;
        let (observed_hash, observed_bytes) = hash_open_file(&mut locked_file)?;
        if observed_hash != request.sha256 || observed_bytes != request.byte_length {
            return Err(CommandError::forbidden(
                "A prepared playback file changed after Planner finalization.",
            ));
        }
        let token = Uuid::new_v4().simple().to_string();
        workspace.media_grants.insert(
            token.clone(),
            MediaGrant {
                file: Arc::new(Mutex::new(locked_file)),
                workspace_file_id: request.package_relative_path.clone(),
                sha256: request.sha256.clone(),
                mime_type: "video/mp4".to_owned(),
                byte_length: request.byte_length,
            },
        );
        let media_url = if cfg!(any(target_os = "windows", target_os = "android")) {
            format!("http://research-media.localhost/{token}")
        } else {
            format!("research-media://localhost/{token}")
        };
        Ok(PreparedMediaUrlReceipt {
            media_grant_id: token,
            media_url,
            package_relative_path: request.package_relative_path,
            sha256: request.sha256,
            byte_length: request.byte_length,
            duration_ms: request.duration_ms,
            mime_type: "video/mp4",
        })
    }
}

fn validate_prepared_url_request(request: &PreparedMediaUrlRequest) -> ResearchResult<()> {
    if request.sha256.len() != 64
        || !request
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || request.byte_length == 0
        || request.duration_ms == 0
        || request.byte_length > crate::research_contracts::MAX_SAFE_INTEGER
        || request.duration_ms > crate::research_contracts::MAX_SAFE_INTEGER
    {
        return Err(CommandError::invalid_contract(
            "Prepared playback URL requests require exact bounded MP4 metadata.",
        ));
    }
    Ok(())
}

fn prepare_one(
    package_assets: &Path,
    prepared_dir: &Path,
    entry: &PlannerMediaNormalizationEntry,
) -> ResearchResult<PreparedPlannerMediaEntry> {
    validate_declared_entry(entry)?;
    let source = resolve_source(package_assets, &entry.source_relative_path)?;
    let (observed_sha, observed_bytes) = hash_file(&source)?;
    if observed_sha != entry.sha256 || observed_bytes != entry.byte_length {
        return Err(CommandError::forbidden(
            "A Planner video changed before FFmpeg preparation.",
        ));
    }
    let target_name = prepared_name(entry);
    let target = prepared_dir.join(&target_name);
    let package_relative_path = format!("assets/stimuli/{PREPARED_DIR}/{target_name}");
    if target.exists() {
        if let Ok(prepared) = validate_prepared(&target, &package_relative_path, entry.duration_ms)
        {
            return Ok(PreparedPlannerMediaEntry {
                source_relative_path: entry.source_relative_path.clone(),
                sha256: entry.sha256.clone(),
                byte_length: entry.byte_length,
                prepared_playback: prepared,
            });
        }
    }
    let source_probe = probe(&source)?;
    let staging = prepared_dir.join(format!(".{}.ffmpeg.mp4", Uuid::new_v4()));
    let result = convert(&source, &staging, &source_probe);
    if let Err(error) = result {
        let _ = fs::remove_file(&staging);
        return Err(error);
    }
    replace_with_staging(&staging, &target)?;
    let prepared = validate_prepared(&target, &package_relative_path, entry.duration_ms)?;
    Ok(PreparedPlannerMediaEntry {
        source_relative_path: entry.source_relative_path.clone(),
        sha256: entry.sha256.clone(),
        byte_length: entry.byte_length,
        prepared_playback: prepared,
    })
}

fn validate_declared_entry(entry: &PlannerMediaNormalizationEntry) -> ResearchResult<()> {
    if entry.sha256.len() != 64
        || !entry
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || entry.byte_length == 0
        || entry.duration_ms == 0
        || entry.byte_length > crate::research_contracts::MAX_SAFE_INTEGER
        || entry.duration_ms > crate::research_contracts::MAX_SAFE_INTEGER
    {
        return Err(CommandError::invalid_contract(
            "A Planner media entry has invalid identity metadata.",
        ));
    }
    let relative = entry
        .source_relative_path
        .strip_prefix("stimuli/")
        .ok_or_else(|| CommandError::invalid_contract("Prepared media must come from stimuli/."))?;
    if relative == PREPARED_DIR
        || relative.starts_with(&format!("{PREPARED_DIR}/"))
        || portable_import_relative_path(Path::new(relative))? != relative
        || !is_video(Path::new(relative))
    {
        return Err(CommandError::invalid_contract(
            "Prepared media must come from a supported Planner video path.",
        ));
    }
    Ok(())
}

fn resolve_source(package_assets: &Path, source_relative_path: &str) -> ResearchResult<PathBuf> {
    let relative = source_relative_path
        .strip_prefix("stimuli/")
        .ok_or_else(|| CommandError::invalid_contract("Prepared media must come from stimuli/."))?;
    let mut parts = relative.split('/').collect::<Vec<_>>();
    let file_name = parts
        .pop()
        .ok_or_else(|| CommandError::invalid_contract("Prepared media source is empty."))?;
    let mut parent = package_assets.to_owned();
    for part in parts {
        parent = validate_exact_child_directory(&parent, part)?.0;
    }
    let file = parent.join(file_name);
    let metadata = fs::symlink_metadata(&file).map_err(CommandError::io)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || file.canonicalize().map_err(CommandError::io)? != file
    {
        return Err(CommandError::forbidden(
            "Prepared media sources must be ordinary files inside assets/stimuli/.",
        ));
    }
    Ok(file)
}

fn resolve_prepared_playback(
    package_assets: &Path,
    package_relative_path: &str,
) -> ResearchResult<PathBuf> {
    let relative = package_relative_path
        .strip_prefix("assets/stimuli/")
        .ok_or_else(|| {
            CommandError::invalid_contract("Prepared playback must live under assets/stimuli/.")
        })?;
    let file_name = relative
        .strip_prefix(&format!("{PREPARED_DIR}/"))
        .ok_or_else(|| {
            CommandError::invalid_contract(
                "Prepared playback must come from assets/stimuli/.prepared/.",
            )
        })?;
    if file_name.contains('/')
        || !file_name.to_ascii_lowercase().ends_with(".mp4")
        || portable_import_relative_path(Path::new(relative))? != relative
    {
        return Err(CommandError::invalid_contract(
            "Prepared playback must name one portable MP4 in assets/stimuli/.prepared/.",
        ));
    }
    let prepared_dir = validate_exact_child_directory(package_assets, PREPARED_DIR)?.0;
    let file = prepared_dir.join(file_name);
    let metadata = fs::symlink_metadata(&file).map_err(CommandError::io)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || file.canonicalize().map_err(CommandError::io)? != file
    {
        return Err(CommandError::forbidden(
            "Prepared playback must be an ordinary MP4 file inside assets/stimuli/.prepared/.",
        ));
    }
    Ok(file)
}

fn prepared_name(entry: &PlannerMediaNormalizationEntry) -> String {
    format!("{}.mp4", &entry.sha256)
}

fn ffprobe_path() -> PathBuf {
    std::env::var_os("AFFECT_FFPROBE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("ffprobe"))
}

fn ffmpeg_path() -> PathBuf {
    std::env::var_os("AFFECT_FFMPEG_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("ffmpeg"))
}

fn probe(path: &Path) -> ResearchResult<ProbeInfo> {
    let output = Command::new(ffprobe_path())
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .map_err(|_| {
            CommandError::forbidden(
                "FFprobe is unavailable. Install FFmpeg or set AFFECT_FFPROBE_PATH.",
            )
        })?;
    if !output.status.success() {
        return Err(CommandError::forbidden(
            "FFprobe could not inspect a Planner video.",
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| CommandError::invalid_contract("FFprobe returned malformed JSON."))?;
    let streams = value["streams"]
        .as_array()
        .ok_or_else(|| CommandError::invalid_contract("FFprobe returned no stream list."))?;
    let video = streams
        .iter()
        .find(|stream| stream["codec_type"] == "video")
        .ok_or_else(|| CommandError::forbidden("A Planner video has no video stream."))?;
    let duration = video["duration"]
        .as_str()
        .or_else(|| value["format"]["duration"].as_str())
        .and_then(|raw| raw.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| CommandError::forbidden("A Planner video has no bounded duration."))?;
    let duration_ms = (duration * 1000.0).round();
    if duration_ms < 1.0 || duration_ms > crate::research_contracts::MAX_SAFE_INTEGER as f64 {
        return Err(CommandError::forbidden(
            "A Planner video duration exceeds supported bounds.",
        ));
    }
    Ok(ProbeInfo {
        duration_ms: duration_ms as u64,
        video_codec: video["codec_name"]
            .as_str()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        pixel_format: video["pix_fmt"]
            .as_str()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        audio_codecs: streams
            .iter()
            .filter(|stream| stream["codec_type"] == "audio")
            .map(|stream| {
                stream["codec_name"]
                    .as_str()
                    .unwrap_or_default()
                    .to_ascii_lowercase()
            })
            .collect(),
    })
}

fn convert(source: &Path, staging: &Path, probe: &ProbeInfo) -> ResearchResult<()> {
    let video_safe = probe.video_codec == "h264" && probe.pixel_format == "yuv420p";
    let audio_safe = probe.audio_codecs.iter().all(|codec| codec == "aac");
    let mut command = Command::new(ffmpeg_path());
    command
        .args(["-hide_banner", "-y", "-i"])
        .arg(source)
        .args(["-map", "0:v:0", "-map", "0:a:0?"]);
    if video_safe {
        command.args(["-c:v", "copy"]);
    } else {
        command.args([
            "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
        ]);
    }
    if !probe.audio_codecs.is_empty() {
        if audio_safe {
            command.args(["-c:a", "copy"]);
        } else {
            command.args(["-c:a", "aac", "-b:a", "320k"]);
        }
    }
    command
        .args(["-movflags", "+faststart", "-sn", "-dn"])
        .arg(staging);
    let output = command.output().map_err(|_| {
        CommandError::forbidden("FFmpeg is unavailable. Install FFmpeg or set AFFECT_FFMPEG_PATH.")
    })?;
    if !output.status.success() {
        return Err(CommandError::forbidden(
            "FFmpeg could not prepare a browser-safe Planner video.",
        ));
    }
    Ok(())
}

fn validate_prepared(
    path: &Path,
    package_relative_path: &str,
    source_duration_ms: u64,
) -> ResearchResult<PreparedPlaybackReceipt> {
    let probe = probe(path)?;
    let duration_delta = probe.duration_ms.abs_diff(source_duration_ms);
    if duration_delta > DURATION_TOLERANCE_MS
        || probe.video_codec != "h264"
        || probe.pixel_format != "yuv420p"
        || !probe.audio_codecs.iter().all(|codec| codec == "aac")
        || !fast_start(path)?
    {
        return Err(CommandError::forbidden(
            "Prepared playback does not match the browser-safe MP4 contract.",
        ));
    }
    let (sha256, byte_length) = hash_file(path)?;
    Ok(PreparedPlaybackReceipt {
        strategy: crate::research_workspace_contribution::v3::VIDEO_PREPARED_PLAYBACK_STRATEGY_V1,
        package_relative_path: package_relative_path.to_owned(),
        sha256,
        byte_length,
        duration_ms: probe.duration_ms,
        container: "mp4",
        video_codec: "h264",
        audio_codec: if probe.audio_codecs.is_empty() {
            "none".to_owned()
        } else {
            "aac".to_owned()
        },
        pixel_format: "yuv420p",
        fast_start: true,
    })
}

fn fast_start(path: &Path) -> ResearchResult<bool> {
    let mut file = File::open(path).map_err(CommandError::io)?;
    let mut bytes = vec![0u8; 2 * 1024 * 1024];
    let count = file.read(&mut bytes).map_err(CommandError::io)?;
    bytes.truncate(count);
    let moov = find_atom(&bytes, b"moov");
    let mdat = find_atom(&bytes, b"mdat");
    Ok(matches!((moov, mdat), (Some(moov), Some(mdat)) if moov < mdat))
}

fn find_atom(haystack: &[u8], needle: &[u8; 4]) -> Option<usize> {
    haystack.windows(4).position(|window| window == needle)
}
