//! Explicitly opted-in engineering diagnostic. Never compiled into a product.
use super::*;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::os::windows::fs::OpenOptionsExt;

const CLIP_SHA256: &str = "b5327e7465ec92a4c93f3236a1ebab4556cdf508e24eafe6c593eac1e13afd49";
const CLIP_BYTES: u64 = 86_870_779;
static MUTED_DIAGNOSTIC: AtomicBool = AtomicBool::new(false);
static DIAGNOSTIC_STARTED: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

pub(super) fn actor_phase(stage: &str) {
    if MUTED_DIAGNOSTIC.load(Ordering::Acquire) {
        trace(stage, serde_json::json!({}));
    }
}

pub(super) fn mute_if_opted_in(play: &gst_play::Play) {
    if MUTED_DIAGNOSTIC.load(Ordering::Acquire) {
        play.set_mute(true);
        assert!(
            play.is_muted(),
            "diagnostic must not produce audible output"
        );
    }
}

fn trace(stage: &str, value: serde_json::Value) {
    println!(
        "NATIVE_DIAGNOSTIC {}",
        serde_json::json!({
            "schema": "affect-native-engineering-diagnostic-v1",
            "stage": stage, "value": value,
            "buildCommit": env!("AFFECT_TRACKER_BUILD_COMMIT"),
            "elapsedMs": DIAGNOSTIC_STARTED.get().map(|start| start.elapsed().as_millis()),
            "qualified": false, "installedQualification": false,
        })
    );
}

fn locked_fixture(path: &std::path::Path) -> Result<NativeMediaGrant, String> {
    let mut file = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(path)
        .map_err(|_| "fixture-open-failed")?;
    if file
        .metadata()
        .map_err(|_| "fixture-metadata-failed")?
        .len()
        != CLIP_BYTES
    {
        return Err("fixture-length-mismatch".into());
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65_536];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "fixture-read-failed")?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    if format!("{:x}", hasher.finalize()) != CLIP_SHA256 {
        return Err("fixture-hash-mismatch".into());
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| "fixture-rewind-failed")?;
    Ok(NativeMediaGrant {
        media_grant_id: uuid::Uuid::new_v4().to_string(),
        workspace_file_id: "diagnostic-exact-local-clip".into(),
        path: path.to_path_buf(),
        file,
        sha256: CLIP_SHA256.into(),
        mime_type: "video/mp4".into(),
        byte_length: CLIP_BYTES,
    })
}

fn observed(
    actor: &GstPlayActorHandle,
    state: NativeMediaStateV1,
) -> Result<NativeMediaStatusV1, String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        let status = actor.status().map_err(|e| e.message)?;
        if status.state == state {
            if status.reason_code.is_some() {
                trace(
                    "unexpected-state-error",
                    serde_json::to_value(&status).map_err(|_| "status-json")?,
                );
                return Err("observed-state-retained-error".into());
            }
            if matches!(
                state,
                NativeMediaStateV1::Paused | NativeMediaStateV1::Playing
            ) && !(status
                .duration_ms
                .is_some_and(|value| value.is_finite() && value > 0.0)
                && status.video_width.is_some_and(|value| value > 0)
                && status.video_height.is_some_and(|value| value > 0))
            {
                // GstPlay may report Paused before its complete MediaInfo.
                // Keep the existing bounded wait; never treat partial data as readiness.
                thread::sleep(Duration::from_millis(10));
                continue;
            }
            trace(
                "observed-state",
                serde_json::to_value(&status).map_err(|_| "status-json")?,
            );
            return Ok(status);
        }
        if status.state == NativeMediaStateV1::Failed {
            trace(
                "actor-failed",
                serde_json::to_value(&status).map_err(|_| "status-json")?,
            );
            return Err("actor-reported-failed".into());
        }
        thread::sleep(Duration::from_millis(10));
    }
    Err(format!("observed-state-timeout-{state:?}"))
}

fn observe_live_frame(
    actor: &GstPlayActorHandle,
    fence: &NativeMediaCommandFenceV1,
    state: NativeMediaStateV1,
) -> bool {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let started = Instant::now();
    let result = actor.snapshot_live_frame(fence.clone());
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    match result {
        Ok(frame) => {
            let bytes = (frame.jpeg_base64.len() <= 128 * 1024)
                .then(|| STANDARD.decode(&frame.jpeg_base64).ok())
                .flatten();
            let bounded = bytes.as_ref().is_some_and(|bytes| {
                !bytes.is_empty()
                    && bytes.len() <= 96 * 1024
                    && bytes.starts_with(&[0xff, 0xd8])
                    && bytes.ends_with(&[0xff, 0xd9])
            });
            let identity_matches = frame.session_id == fence.session_id
                && frame.generation == fence.generation.to_string();
            let success = bounded && identity_matches && frame.width == 640 && frame.height == 360;
            trace(
                "live-frame-capture",
                serde_json::json!({
                    "state": state, "success": success,
                    "width": frame.width, "height": frame.height,
                    "encodedBytes": bytes.as_ref().map(Vec::len),
                    "requestElapsedMs": elapsed_ms,
                    "latencyScope": "queue-capture-validation-base64-round-trip",
                    "identityMatches": identity_matches, "boundedJpeg": bounded,
                    "positionEstimateMs": frame.position_estimate_ms,
                }),
            );
            success
        }
        Err(error) => {
            trace(
                "live-frame-capture",
                serde_json::json!({
                    "state": state, "success": false, "errorCode": error.code,
                    "requestElapsedMs": elapsed_ms,
                    "latencyScope": "queue-capture-validation-base64-round-trip",
                }),
            );
            false
        }
    }
}

fn exercise(
    parent: tauri::WebviewWindow,
    runtime: PathBuf,
    state: PathBuf,
    clip: PathBuf,
) -> Result<(), String> {
    // This retained parent belongs only to this isolated diagnostic process.
    // Its event loop continues while the actor starts, operates, and shuts down.
    let grant = locked_fixture(&clip)?;
    trace(
        "fixture-verified",
        serde_json::json!({"sha256": CLIP_SHA256, "bytes": CLIP_BYTES}),
    );
    let handle = parent.hwnd().map_err(|_| "hidden-parent-hwnd")?.0 as isize;
    let actor = GstPlayActorHandle::spawn(GstActorConfig::new(runtime, state, handle))
        .map_err(|e| e.reason_code().to_owned())?;
    loop {
        match actor.startup_result() {
            Some(Ok(())) => break,
            Some(Err(error)) => {
                trace("failed", serde_json::json!({"reason": error.reason_code()}));
                actor.request_shutdown();
                // The startup admission failure is permanent. This separate
                // observation grace measures late teardown, never media readiness.
                let deadline = Instant::now() + Duration::from_secs(30);
                while !actor.is_stopped() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(10));
                }
                if actor.is_stopped() && actor.finish_shutdown().is_ok() {
                    trace(
                        "failed-start-actor-joined",
                        serde_json::json!({
                            "startupStillFailed": true, "observedBeforeParentExit": true
                        }),
                    );
                } else {
                    trace(
                        "failed-start-shutdown-unconfirmed",
                        serde_json::json!({
                            "startupStillFailed": true, "parentRetained": true
                        }),
                    );
                }
                // Only this explicitly opted-in disposable diagnostic process.
                // Do not drop the parent or call a blocking Drop on timeout.
                std::process::exit(2);
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    }
    trace(
        "actor-started",
        serde_json::json!({"parentHidden": !parent.is_visible().unwrap_or(true)}),
    );
    let viewport = NativeMediaViewportPxV1 {
        left_px: 0,
        top_px: 0,
        width_px: 320,
        height_px: 180,
        layout_revision: 1,
    };
    let receipt = actor.prepare(grant, viewport).map_err(|e| e.message)?;
    let fence = NativeMediaCommandFenceV1 {
        session_id: receipt.session_id,
        generation: receipt.generation,
    };
    observed(&actor, NativeMediaStateV1::Paused)?;
    let decode = actor.attest_decode(fence.clone()).map_err(|e| e.message)?;
    if decode.decoded_snapshot_count != 3 {
        return Err("expected-three-snapshots".into());
    }
    trace(
        "decode-observed",
        serde_json::to_value(decode).map_err(|_| "decode-json")?,
    );
    let paused_capture = observe_live_frame(&actor, &fence, NativeMediaStateV1::Paused);
    observed(&actor, NativeMediaStateV1::Paused)?;
    actor.play(fence.clone()).map_err(|e| e.message)?;
    observed(&actor, NativeMediaStateV1::Playing)?;
    let playing_capture = observe_live_frame(&actor, &fence, NativeMediaStateV1::Playing);
    observed(&actor, NativeMediaStateV1::Playing)?;
    actor.pause(fence.clone()).map_err(|e| e.message)?;
    observed(&actor, NativeMediaStateV1::Paused)?;
    actor.play(fence.clone()).map_err(|e| e.message)?;
    observed(&actor, NativeMediaStateV1::Playing)?;
    actor.stop(fence.clone()).map_err(|e| e.message)?;
    observed(&actor, NativeMediaStateV1::Idle)?;
    let next = actor
        .prepare(locked_fixture(&clip)?, viewport)
        .map_err(|e| e.message)?;
    if next.generation <= fence.generation {
        return Err("generation-not-advanced".into());
    }
    if actor.play(fence).is_ok() {
        return Err("stale-command-accepted".into());
    }
    trace(
        "stale-command-rejected",
        serde_json::json!({"generation": next.generation}),
    );
    observed(&actor, NativeMediaStateV1::Paused)?;
    actor
        .stop(NativeMediaCommandFenceV1 {
            session_id: next.session_id,
            generation: next.generation,
        })
        .map_err(|e| e.message)?;
    // Cancellation is independent of ordinary queue admission. Only actual
    // thread completion and the retained join below establish shutdown.
    actor.request_shutdown();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let finished = actor
            .join
            .lock()
            .map_err(|_| "join-lock")?
            .as_ref()
            .is_some_and(JoinHandle::is_finished);
        if finished {
            break;
        }
        if Instant::now() >= deadline {
            return Err("actor-thread-exit-timeout".into());
        }
        thread::sleep(Duration::from_millis(10));
    }
    trace(
        "actor-thread-exited",
        serde_json::json!({"observedBeforeParentExit": true}),
    );
    actor.finish_shutdown().map_err(|e| e.message)?;
    actor.finish_shutdown().map_err(|e| e.message)?;
    if actor.join.lock().map_err(|_| "join-lock")?.is_some() {
        return Err("actor-join-retained".into());
    }
    if actor.status_snapshot().state != NativeMediaStateV1::ShuttingDown {
        return Err("shutdown-not-observed".into());
    }
    if actor.status().is_ok() {
        return Err("command-after-shutdown-accepted".into());
    }
    if parent.is_visible().map_err(|_| "parent-visibility")? {
        return Err("diagnostic-parent-became-visible".into());
    }
    trace(
        "shutdown-returned",
        serde_json::json!({"repeated": true, "parentHidden": true}),
    );
    if !paused_capture || !playing_capture {
        return Err("live-frame-capture-check-failed-after-confirmed-shutdown".into());
    }
    Ok(())
}

#[test]
#[ignore = "explicit offscreen native diagnostic; run only via bounded dedicated process"]
fn offscreen_native_actor_lifecycle() -> Result<(), String> {
    if std::env::var("AFFECT_NATIVE_DIAGNOSTIC_OPT_IN").as_deref() != Ok("1") {
        return Err("explicit-diagnostic-opt-in-required".into());
    }
    let _ = DIAGNOSTIC_STARTED.set(Instant::now());
    let runtime = PathBuf::from(
        std::env::var_os("AFFECT_NATIVE_DIAGNOSTIC_RUNTIME").ok_or("runtime-required")?,
    );
    let clip =
        PathBuf::from(std::env::var_os("AFFECT_NATIVE_DIAGNOSTIC_CLIP").ok_or("clip-required")?);
    let state = PathBuf::from(
        std::env::var_os("AFFECT_NATIVE_DIAGNOSTIC_STATE").ok_or("new-state-directory-required")?,
    );
    if !runtime.is_absolute() || !clip.is_absolute() || !state.is_absolute() {
        return Err("absolute-paths-required".into());
    }
    crate::research_native_media::capability::runtime_manifest::verify_runtime_tree(&runtime)
        .map_err(|e| format!("runtime-rejected-{}", e.code.as_str()))?;
    fs::create_dir(&state).map_err(|_| "state-directory-must-be-new")?;
    trace(
        "runtime-verified",
        serde_json::json!({"manifestSha256": crate::research_native_media::capability::runtime_manifest::PINNED_RUNTIME_MANIFEST_SHA256}),
    );
    MUTED_DIAGNOSTIC.store(true, Ordering::Release);
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "io.github.affectresearch.native-diagnostic".into();
    let (sender, receiver) = mpsc::sync_channel(1);
    let app = tauri::Builder::default().any_thread().setup(move |app| {
        let parent = tauri::WebviewWindowBuilder::new(app, "native-diagnostic", tauri::WebviewUrl::External("about:blank".parse()?))
            .title("Offscreen native engineering diagnostic")
            .visible(false).focused(false).skip_taskbar(true).inner_size(320.0, 180.0)
            .data_directory(state.join("webview"))
            .build()?;
        trace("hidden-parent-created", serde_json::json!({}));
        let app_handle = app.handle().clone();
        thread::Builder::new().name("native-diagnostic-owner".into()).spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| exercise(parent, runtime, state.join("gstreamer"), clip)));
            match result {
                Ok(Ok(())) => {
                    trace("complete", serde_json::json!({"engineeringOnly": true}));
                    let _ = sender.send(());
                    app_handle.exit(0);
                }
                failure => {
                    trace("failed", serde_json::json!({"reason": match failure { Ok(Err(reason)) => reason, _ => "diagnostic-panicked".into() }}));
                    // Never unwind an uncertain actor lifetime into parent teardown.
                    // This executable is an explicitly isolated diagnostic process.
                    std::process::exit(2);
                }
            }
        })?;
        Ok(())
    }).build(context).map_err(|_| "hidden-test-app-build-failed")?;
    let exit = app.run_return(|_, event| {
        if matches!(event, tauri::RunEvent::Ready) {
            trace("event-loop-ready", serde_json::json!({}));
        }
    });
    if exit != 0 {
        return Err(format!("hidden-test-app-exit-{exit}"));
    }
    receiver
        .try_recv()
        .map_err(|_| "diagnostic-did-not-complete")?;
    Ok(())
}
