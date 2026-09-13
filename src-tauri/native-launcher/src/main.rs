#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
#![forbid(unsafe_code)]

#[allow(dead_code)]
#[path = "../../native-media/runtime_manifest.rs"]
mod runtime_manifest;

use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

const ENGINE: &str = "affect-runner-engine.exe";
const ENGINE_HASH: &str = env!("AFFECT_RUNNER_ENGINE_SHA256");

fn regular(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "launcher-file-missing")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("launcher-reparse-file".into());
        }
    }
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("launcher-file-type".into());
    }
    Ok(())
}

fn verify_engine(path: &Path, expected: &str) -> Result<(), String> {
    regular(path)?;
    if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("launcher-build-identity-invalid".into());
    }
    let mut file = fs::File::open(path).map_err(|_| "launcher-engine-open")?;
    if file
        .metadata()
        .map_err(|_| "launcher-engine-metadata")?
        .len()
        > 512 * 1024 * 1024
    {
        return Err("launcher-engine-too-large".into());
    }
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|_| "launcher-engine-read")?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    if format!("{:x}", digest.finalize()) != expected {
        return Err("launcher-engine-hash-mismatch".into());
    }
    Ok(())
}

fn verify_application_directory(root: &Path) -> Result<(), String> {
    // Windows searches the executable directory before PATH. No application DLL
    // may override the verified private runtime or the system loader there.
    for (index, entry) in fs::read_dir(root)
        .map_err(|_| "launcher-directory-read")?
        .enumerate()
    {
        if index >= 1024 {
            return Err("launcher-directory-too-large".into());
        }
        let path = entry.map_err(|_| "launcher-directory-entry")?.path();
        if path
            .extension()
            .is_some_and(|v| v.eq_ignore_ascii_case("dll"))
        {
            return Err("launcher-unexpected-application-dll".into());
        }
    }
    Ok(())
}

fn prepare(root: &Path) -> Result<Command, String> {
    verify_application_directory(root)?;
    let engine = root.join(ENGINE);
    verify_engine(&engine, ENGINE_HASH)?;
    let runtime = root.join(runtime_manifest::RUNTIME_RELATIVE_ROOT);
    runtime_manifest::verify_runtime_tree(&runtime).map_err(|e| e.code.as_str().to_owned())?;
    let bin = runtime.join("bin");
    let mut command = Command::new(engine);
    // Exact executable, no shell, no forwarded arguments, no inherited PATH.
    // Setting cwd to the verified bin also excludes ambient working-directory DLLs.
    command
        .current_dir(&bin)
        .env("PATH", &bin)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    Ok(command)
}

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let verify_only = args == ["--verify-only"];
    if !args.is_empty() && !verify_only {
        return Err("launcher-arguments-not-supported".into());
    }
    let executable = std::env::current_exe().map_err(|_| "launcher-location")?;
    let root = executable.parent().ok_or("launcher-parent")?;
    let mut command = prepare(root)?;
    if verify_only {
        println!("runner-launcher-verified");
        return Ok(());
    }
    command
        .spawn()
        .map_err(|_| "launcher-engine-start-failed")?;
    Ok(())
}

fn main() {
    if let Err(reason) = run() {
        eprintln!("{reason}");
        // Fixed, bounded failure text only. No arbitrary paths or participant data.
        // Create a fresh local report and show it using the system text viewer.
        if std::env::args_os().len() == 1 {
            let report = std::env::temp_dir()
                .join(format!("affect-runner-launch-{}.txt", std::process::id()));
            if let Ok(mut file) = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&report)
            {
                let _ = writeln!(file, "Experiment Runner could not start.\nReason: {reason}\nRestore the complete matching application and runtime folder, then try again.");
                if let Some(windows) = std::env::var_os("SystemRoot") {
                    let _ = Command::new(PathBuf::from(windows).join("System32/notepad.exe"))
                        .arg(report)
                        .spawn();
                }
            }
        }
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wrong_engine_rejected_before_launch() {
        let path = std::env::temp_dir().join(format!("runner-launch-test-{}", std::process::id()));
        fs::write(&path, b"not the expected engine").unwrap();
        assert_eq!(
            verify_engine(&path, &"0".repeat(64)).unwrap_err(),
            "launcher-engine-hash-mismatch"
        );
        fs::remove_file(path).unwrap();
    }
}
