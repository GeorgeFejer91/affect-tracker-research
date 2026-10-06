//! One explicit Planner-master video occurrence, without claiming a Runner session.
use super::{run_with_args, Args, Result};
use affect_research::research_runner_master::{
    MasterSelector, MasterStep, MasterStepKind, PreparedMaster,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::windows::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn selected_asset<'a>(steps: &'a [MasterStep], entry_id: &str) -> Result<&'a Value> {
    let matches: Vec<_> = steps
        .iter()
        .filter(|step| step.entry_id == entry_id && step.kind == MasterStepKind::Video)
        .collect();
    let [step] = matches.as_slice() else {
        return Err("Choose one exact saved video occurrence entry ID".into());
    };
    Ok(&step.payload["asset"])
}

fn asset_path(master: &Path, asset: &Value) -> Result<PathBuf> {
    let relative = asset["packageRelativePath"]
        .as_str()
        .ok_or("Selected video has no package-relative path")?;
    if !relative.starts_with("assets/stimuli/") {
        return Err("Selected video is outside the saved asset root".into());
    }
    let master = master.canonicalize()?;
    let root = master
        .parent()
        .ok_or("Master has no containing directory")?;
    let mut target = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(name) = component else {
            return Err("Selected video path is not portable".into());
        };
        target.push(name);
        if fs::symlink_metadata(&target)?.file_attributes() & 0x400 != 0 {
            return Err("Selected video path contains a link".into());
        }
    }
    let resolved = target.canonicalize()?;
    if !resolved.starts_with(root) || !resolved.is_file() {
        return Err("Selected video does not resolve to a saved asset file".into());
    }
    Ok(resolved)
}

fn copy_verified(
    source: &Path,
    destination: &Path,
    expected_bytes: u64,
    expected_sha: &str,
) -> Result<()> {
    let result = (|| {
        let mut input = File::open(source)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)?;
        let mut digest = Sha256::new();
        let mut total = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            total = total
                .checked_add(read as u64)
                .ok_or("Selected video is too large")?;
            if total > expected_bytes {
                return Err("Selected video byte length changed".into());
            }
            digest.update(&buffer[..read]);
            output.write_all(&buffer[..read])?;
        }
        output.sync_all()?;
        if total != expected_bytes || format!("{:x}", digest.finalize()) != expected_sha {
            return Err("Selected video bytes do not match the saved master".into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

fn file_sha256(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub(super) fn run(
    master: &Path,
    participant: &str,
    selector_json: &str,
    entry_id: &str,
    data_dir: Option<PathBuf>,
) -> Result<Value> {
    let selector: MasterSelector = serde_json::from_str(selector_json)?;
    let master_sha = file_sha256(master)?;
    let prepared = PreparedMaster::read_file(master, participant, selector)?;
    let asset = selected_asset(&prepared.plan.steps, entry_id)?;
    let expected_sha = asset["sha256"]
        .as_str()
        .ok_or("Selected video has no hash")?;
    let expected_bytes = asset["byteLength"]
        .as_u64()
        .ok_or("Selected video has no length")?;
    let duration_ms = asset["durationMs"]
        .as_u64()
        .ok_or("Selected video has no duration")?;
    let source = asset_path(master, asset)?;
    let root = match data_dir {
        Some(path) => path,
        None => PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
            .join("VLC_Flubber_Player"),
    };
    let runs = root.join("selected-master");
    fs::create_dir_all(&runs)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let run_dir = runs.join(format!("{}-{stamp}", std::process::id()));
    fs::create_dir(&run_dir)?;
    let run_dir = run_dir.canonicalize()?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 12
                && value.bytes().all(|b| b.is_ascii_alphanumeric())
        })
        .ok_or("Selected video has no usable extension")?;
    let copy = run_dir.join(format!("selected.{extension}"));
    copy_verified(&source, &copy, expected_bytes, expected_sha)?;
    if !matches!(asset_path(master, asset), Ok(current) if current == source)
        || !matches!(file_sha256(master), Ok(current) if current == master_sha)
    {
        let _ = fs::remove_file(&copy);
        return Err("Saved master or selected video changed during binding".into());
    }
    let playback = run_with_args(Args {
        video: Some(copy.clone()),
        data_dir: Some(run_dir.clone()),
        wait: true,
        selected_master_video: true,
        master_duration_ms: Some(duration_ms),
        ..Args::default()
    });
    let _ = fs::remove_file(copy);
    playback?;
    Ok(json!({
        "schema":"flubber-vlc-selected-video-status",
        "version":1,
        "status":"ended",
        "terminalObservation":"decoded-sentinel-video-complete",
        "recipeSourceByteSha256":prepared.plan.recipe_source_byte_sha256,
        "masterFileByteSha256":master_sha,
        "planIdentitySha256":prepared.plan.plan_identity_sha256,
        "participantId":prepared.plan.participant_id,
        "selector":prepared.plan.selector,
        "entryId":entry_id,
        "assetId":asset["assetId"],
        "assetSha256":expected_sha,
        "assetByteLength":expected_bytes,
        "evidenceDirectory":run_dir,
        "sharedRunnerRecordingQualified":false
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_occurrence_requires_exact_video_entry() {
        let steps = vec![MasterStep {
            position: 1,
            entry_id: "video-1".into(),
            kind: MasterStepKind::Video,
            source_code: None,
            duration_ms: Some(1000),
            payload: json!({"asset":{"sha256":"abc"}}),
        }];
        assert_eq!(selected_asset(&steps, "video-1").unwrap()["sha256"], "abc");
        assert!(selected_asset(&steps, "video-2").is_err());
    }

    #[test]
    fn copied_bytes_must_match_full_saved_identity() {
        let root = env::temp_dir().join(format!(
            "flubber-selected-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let source = root.join("source.mp4");
        let copy = root.join("copy.mp4");
        fs::write(&source, b"selected video").unwrap();
        let hash = format!("{:x}", Sha256::digest(b"selected video"));
        copy_verified(&source, &copy, 14, &hash).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), b"selected video");
        let changed = root.join("changed.mp4");
        assert!(copy_verified(&source, &changed, 14, &"0".repeat(64)).is_err());
        assert!(!changed.exists());
        let short = root.join("short.mp4");
        assert!(copy_verified(&source, &short, 13, &hash).is_err());
        assert!(!short.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn asset_path_rejects_traversal() {
        let root = env::temp_dir().join(format!(
            "flubber-path-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("assets/stimuli")).unwrap();
        let master = root.join("experiment.json");
        let file = root.join("assets/stimuli/video.mp4");
        fs::write(&master, b"{}").unwrap();
        fs::write(&file, b"video").unwrap();
        assert_eq!(
            asset_path(
                &master,
                &json!({"packageRelativePath":"assets/stimuli/video.mp4"})
            )
            .unwrap(),
            file.canonicalize().unwrap()
        );
        assert!(asset_path(
            &master,
            &json!({"packageRelativePath":"assets/stimuli/../video.mp4"})
        )
        .is_err());
        assert!(asset_path(&master, &json!({"packageRelativePath":"../video.mp4"})).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
