use std::{env, path::PathBuf, process};

#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
fn main() {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.len() != 2 {
        eprintln!("Usage: affect-runner-recording-diagnostic <output.xdf> <receipt.json>");
        process::exit(2);
    }
    if let Err(error) = affect_research::research_recorder_diagnostic::run(
        PathBuf::from(&args[0]),
        PathBuf::from(&args[1]),
    ) {
        eprintln!("{error}");
        process::exit(1);
    }
}

#[cfg(not(all(feature = "lsl-streaming", target_os = "windows")))]
fn main() {
    eprintln!("affect-runner-recording-diagnostic requires Windows with the lsl-streaming feature");
    process::exit(2);
}
