mod control;

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
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

#[derive(Default)]
struct Selection {
    master: Mutex<Option<PathBuf>>,
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
) -> Result<PathBuf, String> {
    let trusted = trusted_manifest_sha256
        .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("No trusted FlubberVLC Player package is configured for this Recorder build")?;
    let root = directory.canonicalize().map_err(|_| {
        "Install FlubberVLC Player separately, then select its installation folder".to_string()
    })?;
    let location = root.to_string_lossy();
    if location.starts_with("\\\\?\\UNC\\")
        || (location.starts_with("\\\\") && !location.starts_with("\\\\?\\"))
    {
        return Err("Player installation must be on this PC".into());
    }
    let manifest_path = root.join("manifest.json");
    if fs::symlink_metadata(&manifest_path)
        .map_err(|_| "Player manifest is missing".to_string())?
        .file_attributes()
        & FILE_ATTRIBUTE_REPARSE_POINT
        != 0
    {
        return Err("Player manifest cannot be a link".into());
    }
    let manifest_bytes =
        fs::read(manifest_path).map_err(|_| "Player manifest cannot be read".to_string())?;
    if format!("{:x}", Sha256::digest(&manifest_bytes)) != trusted.to_ascii_lowercase() {
        return Err("Installed player manifest does not match the trusted package".into());
    }
    let manifest: BTreeMap<String, String> = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "Player manifest is invalid".to_string())?;
    if manifest.len() != COMPONENTS.len()
        || COMPONENTS.iter().any(|name| !manifest.contains_key(*name))
    {
        return Err("Player manifest has an unexpected component list".into());
    }
    for name in COMPONENTS {
        let claimed = &manifest[name];
        if claimed.len() != 64 || !claimed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(format!("Invalid digest for {name}"));
        }
        let relative = Path::new(name);
        let mut current = root.clone();
        for part in relative.components() {
            current.push(part);
            if fs::symlink_metadata(&current)
                .map_err(|_| format!("Missing player component: {name}"))?
                .file_attributes()
                & FILE_ATTRIBUTE_REPARSE_POINT
                != 0
            {
                return Err(format!("Linked player component: {name}"));
            }
        }
        if !current.is_file()
            || !current
                .canonicalize()
                .map_err(|_| format!("Unreadable player component: {name}"))?
                .starts_with(&root)
        {
            return Err(format!("Invalid player component: {name}"));
        }
        let mut file =
            File::open(&current).map_err(|_| format!("Unreadable player component: {name}"))?;
        let mut digest = Sha256::new();
        let mut buffer = [0_u8; 65536];
        loop {
            let size = file
                .read(&mut buffer)
                .map_err(|_| format!("Unreadable player component: {name}"))?;
            if size == 0 {
                break;
            }
            digest.update(&buffer[..size]);
        }
        if format!("{:x}", digest.finalize()) != claimed.to_ascii_lowercase() {
            return Err(format!("Player component digest mismatch: {name}"));
        }
    }
    Ok(root.join("FlubberVLC.exe"))
}

#[tauri::command]
fn player_status(selection: State<'_, Selection>) -> PlayerStatus {
    match player_directory(&selection)
        .and_then(|directory| verify_player(&directory, TRUSTED_MANIFEST_SHA256))
    {
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
    verify_player(&directory, TRUSTED_MANIFEST_SHA256)?;
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
) -> Result<String, String> {
    let mut client = control
        .0
        .lock()
        .map_err(|_| "Player control is unavailable".to_string())?;
    if client.as_mut().is_some_and(control::ControlClient::alive) {
        return Ok("Player control is connected".into());
    }
    *client = None;
    let player = verify_player(&player_directory(&selection)?, TRUSTED_MANIFEST_SHA256)?;
    *client = Some(control::ControlClient::spawn(&player)?);
    Ok("Player control is connected".into())
}

#[tauri::command]
fn disconnect_player(control: State<'_, ControlState>) -> Result<String, String> {
    let previous = control
        .0
        .lock()
        .map_err(|_| "Player control is unavailable".to_string())?
        .take();
    if let Some(mut previous) = previous {
        previous.shutdown();
    }
    Ok("Player control is disconnected".into())
}

#[tauri::command]
fn control_status(control: State<'_, ControlState>) -> Result<bool, String> {
    let mut client = control
        .0
        .lock()
        .map_err(|_| "Player control is unavailable".to_string())?;
    let connected = client.as_mut().is_some_and(control::ControlClient::alive);
    if !connected {
        *client = None;
    }
    Ok(connected)
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
    let player = verify_player(&player_directory(&selection)?, TRUSTED_MANIFEST_SHA256)?;
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
            control_status
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
        root
    }

    fn manifest_pin(root: &Path) -> String {
        format!(
            "{:x}",
            Sha256::digest(fs::read(root.join("manifest.json")).unwrap())
        )
    }

    #[test]
    fn rejects_missing_or_invalid_package_pin() {
        let root = fixture();
        assert!(verify_player(&root, None)
            .unwrap_err()
            .contains("No trusted"));
        assert!(verify_player(&root, Some("bad"))
            .unwrap_err()
            .contains("No trusted"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_changed_manifest_even_when_component_hashes_still_match() {
        let root = fixture();
        let pin = manifest_pin(&root);
        let manifest_path = root.join("manifest.json");
        let mut bytes = fs::read(&manifest_path).unwrap();
        bytes.push(b' ');
        fs::write(manifest_path, bytes).unwrap();
        assert!(verify_player(&root, Some(&pin))
            .unwrap_err()
            .contains("does not match the trusted package"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn verifies_exact_player_components_and_rejects_tampering() {
        let root = fixture();
        let pin = manifest_pin(&root);
        assert_eq!(
            verify_player(&root, Some(&pin)).unwrap(),
            root.canonicalize().unwrap().join("FlubberVLC.exe")
        );
        fs::write(root.join("lsl.dll"), b"tampered").unwrap();
        assert!(verify_player(&root, Some(&pin))
            .unwrap_err()
            .contains("digest mismatch"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_missing_manifest_or_component() {
        let root = fixture();
        let pin = manifest_pin(&root);
        fs::remove_file(root.join("ffmpeg/ffprobe.exe")).unwrap();
        assert!(verify_player(&root, Some(&pin))
            .unwrap_err()
            .contains("Missing player component"));
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
        assert!(verify_player(&root, Some(&pin))
            .unwrap_err()
            .contains("unexpected component list"));
        fs::remove_dir_all(root).unwrap();
    }
}
