use super::*;
use std::process::{Command, Stdio};

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreparedFileReceipt {
    source_relative_path: String,
    source_sha256: String,
    source_byte_length: u64,
    playable_relative_path: String,
    playable_sha256: String,
    playable_byte_length: u64,
}

#[derive(Debug)]
struct MediaProbe {
    duration_seconds: f64,
    compatible: bool,
}

pub(super) fn prepare_sources(
    source_root: &Path,
    package_assets: &Path,
    staging_root: &Path,
) -> ResearchResult<()> {
    require_media_tools()?;
    let mut sources = collect_import_videos(vec![source_root.to_owned()])?;
    sources.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    for mut source in sources {
        source.relative_path = source
            .relative_path
            .strip_prefix("source-videos/")
            .ok_or_else(|| CommandError::forbidden("The source video escaped its library."))?
            .to_owned();
        prepare_one(&source, package_assets, staging_root)?;
    }
    Ok(())
}

/// A scan may expose only files with complete preparation receipts when those
/// files originated in the source library. This also rejects a crash between
/// target publication and receipt publication.
pub(super) fn validate_active_closure(
    source_root: &Path,
    scanned: &[ScannedStimulus],
) -> ResearchResult<()> {
    let mut source_paths = BTreeSet::new();
    let mut receipted_outputs = BTreeSet::new();
    let source_metadata = match fs::symlink_metadata(source_root) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(CommandError::io(error)),
    };
    if let Some(metadata) = source_metadata {
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(CommandError::forbidden(
                "The source video library is not an ordinary directory.",
            ));
        }
        for source in collect_import_videos(vec![source_root.to_owned()])? {
            let relative = source
                .relative_path
                .strip_prefix("source-videos/")
                .ok_or_else(|| CommandError::forbidden("The source video escaped its library."))?;
            source_paths.insert(relative.to_owned());
            let (sha256, byte_length) = hash_file(&source.source)?;
            let receipt_path = source
                .source
                .parent()
                .ok_or_else(|| CommandError::forbidden("The source video has no parent."))?
                .join(format!(
                    ".{}-{}.prepared.json",
                    &sha256[..32],
                    short_path_hash(relative)
                ));
            if !receipt_path.exists() {
                return Err(CommandError::forbidden(
                    "A source video still needs successful preparation.",
                ));
            }
            let receipt = read_receipt(&receipt_path)?;
            if receipt.source_relative_path != relative
                || receipt.source_sha256 != sha256
                || receipt.source_byte_length != byte_length
            {
                return Err(CommandError::forbidden(
                    "A prepared video receipt no longer matches its source.",
                ));
            }
            let logical = format!("stimuli/{}", receipt.playable_relative_path);
            if !scanned.iter().any(|entry| {
                entry.logical_relative_path == logical
                    && entry.sha256 == receipt.playable_sha256
                    && entry.byte_length == receipt.playable_byte_length
            }) {
                return Err(CommandError::forbidden(
                    "A prepared video receipt does not match the active file.",
                ));
            }
            receipted_outputs.insert(receipt.playable_relative_path);
        }
    }
    for entry in scanned {
        let relative = entry
            .logical_relative_path
            .strip_prefix("stimuli/")
            .unwrap_or_default();
        if (source_paths.contains(relative) || is_generated_ready_name(relative))
            && !receipted_outputs.contains(relative)
        {
            return Err(CommandError::forbidden(
                "An active video is missing a complete source preparation receipt. Remove the stale package copy after preserving its original.",
            ));
        }
    }
    Ok(())
}

fn is_generated_ready_name(relative: &str) -> bool {
    relative
        .rsplit('/')
        .next()
        .and_then(|name| name.rsplit_once(".ready-"))
        .and_then(|(_, suffix)| suffix.strip_suffix(".mp4"))
        .is_some_and(|digest| {
            digest.len() == 32 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

fn require_media_tools() -> ResearchResult<()> {
    let (ffprobe, ffmpeg) = media_tool_paths();
    for (program, name) in [(ffprobe, "FFprobe"), (ffmpeg, "FFmpeg")] {
        let status = Command::new(program).arg("-version")
            .stdout(Stdio::null()).stderr(Stdio::null()).status()
            .map_err(|_| CommandError::new("media_tool_unavailable",
                format!("{name} is unavailable. Install FFmpeg tools before confirming Segment One.")))?;
        if !status.success() {
            return Err(CommandError::new(
                "media_tool_unavailable",
                format!(
                    "{name} could not start. Install FFmpeg tools before confirming Segment One."
                ),
            ));
        }
    }
    Ok(())
}

fn prepare_one(
    source: &ImportedVideo,
    package_assets: &Path,
    staging_root: &Path,
) -> ResearchResult<()> {
    let (source_sha256, source_byte_length) = hash_file(&source.source)?;
    let probe = probe_media(&source.source)?;
    if !probe.compatible {
        let old_package_path = checked_playable_target(package_assets, &source.relative_path)?;
        if fs::symlink_metadata(old_package_path).is_ok() {
            return Err(CommandError::forbidden(
                "The old incompatible video still occupies assets/stimuli. Its original is preserved in source-videos; remove the old package copy before retrying.",
            ));
        }
    }
    let playable_relative_path = if probe.compatible {
        source.relative_path.clone()
    } else {
        let path = Path::new(&source.relative_path);
        let parent = path.parent().filter(|part| !part.as_os_str().is_empty());
        let stem = path
            .file_stem()
            .and_then(|part| part.to_str())
            .map(sanitize_file_stem)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "video".to_owned());
        let file = format!("{stem}.ready-{}.mp4", &source_sha256[..32]);
        parent.map_or(file.clone(), |part| {
            format!("{}/{}", part.to_string_lossy().replace('\\', "/"), file)
        })
    };
    let target = checked_playable_target(package_assets, &playable_relative_path)?;
    let source_parent = source
        .source
        .parent()
        .ok_or_else(|| CommandError::forbidden("The source video has no parent."))?;
    let receipt_path = source_parent.join(format!(
        ".{}-{}.prepared.json",
        &source_sha256[..32],
        short_path_hash(&source.relative_path)
    ));
    let expected = PreparedFileReceipt {
        source_relative_path: source.relative_path.clone(),
        source_sha256: source_sha256.clone(),
        source_byte_length,
        playable_relative_path: playable_relative_path.clone(),
        playable_sha256: String::new(),
        playable_byte_length: 0,
    };
    if target.exists() {
        let metadata = fs::symlink_metadata(&target).map_err(CommandError::io)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(CommandError::forbidden(
                "A prepared video target is not an ordinary file.",
            ));
        }
        let receipt = read_receipt(&receipt_path)?;
        if receipt.source_relative_path != expected.source_relative_path
            || receipt.source_sha256 != expected.source_sha256
            || receipt.source_byte_length != expected.source_byte_length
            || receipt.playable_relative_path != expected.playable_relative_path
            || hash_file(&target)? != (receipt.playable_sha256, receipt.playable_byte_length)
            || !probe_media(&target)?.compatible
        {
            return Err(CommandError::forbidden(
                "A prepared video conflicts with its source receipt.",
            ));
        }
        return Ok(());
    }
    if receipt_path.exists() {
        return Err(CommandError::forbidden(
            "A prepared video receipt has no matching playable file.",
        ));
    }
    // Recovery is outside both the source library and the package closure.
    let staging = staging_root.join(format!(".{}.mp4", Uuid::new_v4()));
    if probe.compatible {
        let mut input = File::open(&source.source).map_err(CommandError::io)?;
        let mut output = create_new(&staging)?;
        std::io::copy(&mut input, &mut output).map_err(CommandError::io)?;
        output.sync_all().map_err(CommandError::io)?;
    } else {
        let status = Command::new(media_tool_paths().1)
            .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-i"])
            .arg(&source.source)
            .args([
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "18",
                "-preset",
                "medium",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-sn",
                "-dn",
                "-movflags",
                "+faststart",
                "-f",
                "mp4",
            ])
            .arg(&staging)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|_| CommandError::forbidden("FFmpeg could not start video preparation."))?;
        if !status.success() {
            let _ = fs::remove_file(&staging);
            return Err(CommandError::forbidden(
                "FFmpeg could not prepare this video for HTML playback.",
            ));
        }
    }
    let result = (|| {
        let (after_sha256, after_bytes) = hash_file(&source.source)?;
        if after_sha256 != source_sha256 || after_bytes != source_byte_length {
            return Err(CommandError::forbidden(
                "The source video changed during preparation.",
            ));
        }
        let prepared_probe = probe_media(&staging)?;
        if !prepared_probe.compatible
            || (prepared_probe.duration_seconds - probe.duration_seconds).abs()
                > (probe.duration_seconds * 0.05).max(0.5)
        {
            return Err(CommandError::forbidden(
                "The prepared video does not match the source duration or HTML format.",
            ));
        }
        let (playable_sha256, playable_byte_length) = hash_file(&staging)?;
        let receipt = PreparedFileReceipt {
            playable_sha256,
            playable_byte_length,
            ..expected
        };
        // A hard link publishes create-new on the same workspace volume; a
        // pre-existing file can never be replaced by this process.
        fs::hard_link(&staging, &target).map_err(|_| {
            CommandError::forbidden(
                "A prepared video target already exists or cannot be published.",
            )
        })?;
        let receipt_bytes = serde_json::to_vec(&receipt).map_err(|_| {
            CommandError::invalid_contract("The prepared video receipt could not be encoded.")
        })?;
        let mut output = create_new(&receipt_path)?;
        output.write_all(&receipt_bytes).map_err(CommandError::io)?;
        output.sync_all().map_err(CommandError::io)?;
        Ok(())
    })();
    fs::remove_file(&staging).map_err(CommandError::io)?;
    result
}

fn checked_playable_target(root: &Path, relative: &str) -> ResearchResult<PathBuf> {
    let mut parts = relative.split('/').collect::<Vec<_>>();
    let filename = parts
        .pop()
        .ok_or_else(|| CommandError::forbidden("A prepared video path is empty."))?;
    let mut parent = root.to_owned();
    for part in parts {
        parent = ensure_exact_child_directory(&parent, part)?;
    }
    Ok(parent.join(filename))
}

fn read_receipt(path: &Path) -> ResearchResult<PreparedFileReceipt> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| CommandError::forbidden("A prepared video is missing its source receipt."))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4096 {
        return Err(CommandError::forbidden(
            "A prepared video receipt is invalid.",
        ));
    }
    serde_json::from_slice(&fs::read(path).map_err(CommandError::io)?)
        .map_err(|_| CommandError::forbidden("A prepared video receipt is invalid."))
}

fn short_path_hash(path: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(path.as_bytes());
    format!("{:x}", digest.finalize())[..16].to_owned()
}

fn probe_media(path: &Path) -> ResearchResult<MediaProbe> {
    let output = Command::new(media_tool_paths().0)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,pix_fmt,width,height",
            "-of",
            "json",
            "-i",
        ])
        .arg(path)
        .stderr(Stdio::null())
        .output()
        .map_err(|_| CommandError::forbidden("FFprobe could not start video inspection."))?;
    if !output.status.success() || output.stdout.len() > 64 * 1024 {
        return Err(CommandError::forbidden(
            "FFprobe could not inspect this video.",
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| CommandError::forbidden("FFprobe returned invalid video metadata."))?;
    let duration_seconds = value
        .pointer("/format/duration")
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && (0.01..=86_400.0).contains(value))
        .ok_or_else(|| CommandError::forbidden("The source video has no usable duration."))?;
    let streams = value
        .get("streams")
        .and_then(|value| value.as_array())
        .ok_or_else(|| CommandError::forbidden("The source video has no readable streams."))?;
    let video = streams
        .iter()
        .filter(|item| item["codec_type"] == "video")
        .collect::<Vec<_>>();
    if video.len() != 1
        || video[0]["width"]
            .as_u64()
            .filter(|n| (1..=32768).contains(n))
            .is_none()
        || video[0]["height"]
            .as_u64()
            .filter(|n| (1..=32768).contains(n))
            .is_none()
    {
        return Err(CommandError::forbidden(
            "The source requires exactly one valid video stream.",
        ));
    }
    let audio = streams
        .iter()
        .filter(|item| item["codec_type"] == "audio")
        .collect::<Vec<_>>();
    let compatible = path
        .extension()
        .and_then(|part| part.to_str())
        .is_some_and(|part| part.eq_ignore_ascii_case("mp4"))
        && video[0]["codec_name"] == "h264"
        && video[0]["pix_fmt"] == "yuv420p"
        && audio.len() <= 1
        && audio.iter().all(|item| item["codec_name"] == "aac");
    Ok(MediaProbe {
        duration_seconds,
        compatible,
    })
}

#[cfg(target_os = "windows")]
fn media_tool_paths() -> (PathBuf, PathBuf) {
    let bundled = std::env::current_exe().ok().and_then(|exe| {
        let root = exe.parent()?.join("ffmpeg");
        let bin = root.join("bin");
        if ![&root, &bin].iter().all(|path| {
            fs::symlink_metadata(path)
                .ok()
                .is_some_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
        }) {
            return None;
        }
        let ffprobe = bin.join("ffprobe.exe");
        let ffmpeg = bin.join("ffmpeg.exe");
        if [&ffprobe, &ffmpeg].iter().all(|path| {
            fs::symlink_metadata(path)
                .ok()
                .is_some_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        }) {
            Some((ffprobe, ffmpeg))
        } else {
            None
        }
    });
    bundled.unwrap_or_else(|| (PathBuf::from("ffprobe.exe"), PathBuf::from("ffmpeg.exe")))
}

#[cfg(not(target_os = "windows"))]
fn media_tool_paths() -> (PathBuf, PathBuf) {
    (PathBuf::from("ffprobe"), PathBuf::from("ffmpeg"))
}
