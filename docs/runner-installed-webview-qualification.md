# Installed WebView Runner evidence, one selected video

This is the R1 RR-04/RR-07/RR-08/RR-09 **Final Runtime Correspondence** source harness. It reads an actual Windows Experiment Runner validation attempt and its real XDF file. It does not launch a browser simulation or enable research Start.

## Predeclared local candidate trial

The earlier `0a17aab` and `1c74f56` package trials were superseded before any playback or XDF observation. The latter installer passed package checks, but its `--no-default-features` build omitted `lsl-streaming` and `native-acquisition-windows`. No recording or physical input result may be attributed to it. The replacement package run `37415641400` at source `d928dcc9cd9e541d02d0b37a61c140756a6dd5e9` requests `runner-desktop`, which resolves both required features. Its unsigned setup SHA-256 is `1d577f7b2cd9a806d3d5f5e1b6f363f834f81dad2b406ce763285ec7228392d4`; the installed `%LOCALAPPDATA%/Experiment Runner/affect-runner.exe` SHA-256 is `3d201966ca30996a14e5849a3f4873f41e618069601274e9bc0ffe229aac8856`. The package and local installed executable-set checks passed. Before observing this candidate, use the installed Planner CLI recipe documented in [planner-real-video-master.md](../scripts/qualification/planner-real-video-master.md): master5 SHA-256 `3406b8096e57975101b7aaca3b00a180b2e7f6a4bbcaafb4b7fbbb53471ade44`, `P001` / `en` / `variant-1`, video position **2**, declared video duration **15,033 ms**, and the exact CAAV asset SHA-256 `1719bd67d2ff0691bfc2da126ca539300650c36b003f1633cff288f4cd94356c`. Require at least **30 decoded frames** and no more than **1,000 ms** absolute difference for both observed media span and marker span. A failed bound remains a failed trial; a later trial needs a separately declared threshold and a new receipt. The configured input test, synthetic questionnaire response, and own-stream recording are part of this trial. Installation and launch do not establish playback or recording.

## Collect one candidate

1. Install the exact Runner installer being evaluated. Record the installer SHA-256, the installed executable SHA-256, and the full source commit from the build provenance. Use the installed executable, not a build-tree copy.
2. Before the run, declare the minimum decoded-frame count and maximum acceptable absolute difference between the video's declared duration and each observed media/marker span. In that installed Runner, load one saved Planner master3–5 JSON with a selected video. Enable recording of Runner's own LSL streams, test the configured input, acknowledge the **local unqualified validation** label, and complete the full attempt. Record the selected video's one-based plan position. Keep the participant output and XDF file unchanged.
3. Run the verifier on Windows with Node, Python, `pyxdf`, and `numpy` available. Use a new output path:

```powershell
node scripts/qualification/runner-installed-webview.mjs `
  --installer 'C:\Evidence\Experiment_Runner_setup.exe' `
  --installed-exe 'C:\Program Files\Experiment Runner\Experiment Runner.exe' `
  --source-commit '<40-hex build commit>' `
  --installer-sha256 '<64-hex hash from build provenance>' `
  --installed-exe-sha256 '<64-hex hash from install provenance>' `
  --session 'C:\Study\outputs\...\attempt-directory' `
  --xdf 'C:\Study\recording.xdf' `
  --video-position 2 `
  --min-decoded-frames '<predeclared integer of at least 2>' `
  --max-video-span-error-ms '<predeclared nonnegative integer>' `
  --out 'C:\Evidence\runner-installed-webview.json'
```

The verifier computes both artifact hashes, compares the attempt and XDF startup build commit, run/attempt IDs and recipe/plan identities, checks the selected video has a file/hash/generation-bound decoded Playing and End observation, checks native video markers and sample timing, and invokes the independent `pyxdf` reader plus the XDF-only information reconstruction. It requires the recorded state stream's exact run-specific source ID, compares every recorded eight-channel state timestamp and value with the native sample journal, and enforces the predeclared frame and video-span limits against the selected video's JSON duration. The receipt also reports missed slots and maximum scheduler lateness, without treating this one video as the separate 30-minute timing qualification. A missing prerequisite or failed read writes a failure receipt when the output path is available. The XDF reader is bounded to 512 MiB.

The result `source-evidence-pass-installed-review-required` means these file checks passed. The script reads evidence paths; it does not launch the installed executable or establish which process produced the files. Expected installer/executable hashes are supplied by the operator and need separately retained build/install provenance. An operator must still witness the actual installed program and video, verify physical input and video/ISI timing against the study's acceptance limits, test stalled/error/stop and recovery cases, and record installation, upgrade and uninstall evidence for the exact installer. Selected external LSL streams are outside this one-video own-stream check. The receipt does not turn a validation attempt into a qualified research run. Normal master Start now reports `webview-research-qualification-required` until the installed WebView, input, LSL and XDF gates pass. Already returned media response bytes cannot be recalled after a grant is revoked.
