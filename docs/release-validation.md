# Final release validation — 2026-09-13

Root is the sole release owner. Delegation has stopped. Work continues on
`codex/final-release-validation` in the transferred `affect-tracker-research-master-v3`
worktree; canonical and the former integration worktree have not been promoted.

| Gate | Result |
| --- | --- |
| Production CLI authors the mock from an empty workspace | Pass: 55/55 steps, revision 0 → 40, process exit 0 |
| Timestamped save, reopen, edit and second save | Pass: both files validated; first file preserved |
| JSON content and compact serialization | Pass: 77,746 bytes, P1–P6, six unique questionnaire definitions, one video declaration |
| Runner native/browser interpretation of that exact JSON | Pass: both English and German selections agree |
| Reconstructed screen geometry and maximum Flubber fit | Pass in software; actual combined native screenshot remains open |
| Actual full Runner execution and XDF-only reconstruction | Not completed; qualified native Start remains disabled |
| Installed/research release | Not ready |

## Saved experiment

Local workspace: `D:/GitHub/.affect-checks/root-release-fullmock-workspace-06`.
The JSON refers to the accompanying `assets/stimuli` directory; video bytes are
not embedded. Questionnaire definitions are embedded once per language/version.
Keep these locally authorized questionnaire assets out of public distribution.

- Primary file: `mock-dictator-recipe_2026-09-12_22-24-47-638Z.json`.
  SHA256 `11fa8b348b6853c98a6d3ff1430ab991ac22fbd0ad64a6c007111dedac8cc451`.
- Edited copy: `mock-dictator-recipe_2026-09-12_22-25-09-511Z.json`.
  SHA256 `37039a708e17d7ad87c04e8c8be72d06116b6ebfd6ecf45a329b53d679ae316b`.
  Participant count changes from one to two; other authored content is preserved.
- Each selected route contains demographics, MAIA-2, TAS-20, ISI1 (1750 ms),
  `dictator-3-study.mp4` (native catalogue duration 254406 ms), ISI2 (3213 ms).
- At the saved 1920×1080 viewport, video bounds are (384,54), 1152×648.
  Flubber centre is (960,864), viewport side 77.76 px (12% of reference height).
  Its conservative maximum animated side is 283.6944 px; fitted minimum separation
  is 20.1528 px, exceeding the requested 19.44 px. Physical placement is unmeasured.

JSON segment value sizes: P1 1779, P2 70777, P3 1367, P4 607, P5 1767,
P6 21 bytes. The master contains authored settings and integrity data, without
serialized Runner selection/layout projections or embedded video data.

## Evidence

Production source: `a1d91106311060fdd371c0df31b1cc7e72aab82a`.
Frozen CLI SHA256 `881f4e680851a0760c134df52367ffb88ae059c5a79fdcd23e49299d9604ad21`.
It used its pinned bundled runtime bin on process PATH; that is not installed
loader qualification. The successful process completed native cleanup in 21 ms
after requesting shutdown. Earlier failures remain retained.

Under `D:/GitHub/.affect-checks/`:

- `root-release-fullmock-evidence-06/mock-authoring-review.json` binds actual
  commands, source assets, saves and final owner settings. Transcript SHA256
  `a8285c953acadc2be9bc71d5f68e0524c88781f23e65b9af08915c2d54d09a90`.
- `root-release-runner-intake-01/receipt.json` binds the production native reader
  and both browser/native selections. It proves content correspondence only.
- `root-release-json-content-review.json` checks exact source bytes, compactness,
  asset location/size, six-step route and reconstructed layout.

## Next gate: native Runner execution

Do not repeat the passed Planner scenario or broad suites without a relevant
change. Use this primary JSON for subsequent Runner work.

1. Resolve and verify pre-main DLL loading for an installed application. The
   executable currently fails to start without a prepared runtime search path.
2. Resolve the observed cold-start/shutdown failure, then complete native playback
   qualification. Increasing the startup sub-budget from 60 to 90 seconds within
   the unchanged 120-second command limit is not proof of lifecycle closure.
   `root-release-fullmock-evidence-05` preserves the timed-out, force-terminated case.
3. Execute the exact saved experiment, capture actual native video + Flubber,
   record real LSL/XDF and apply the independent XDF reader. Establish observed
   event timing and neutral-before-ISI evidence. Existing flags stay false until
   their stated gates are satisfied; no alternative production Start was added.

Source: `research_native_media/capability.rs` retains false qualification flags;
`research_runner_master/runtime.rs` requires qualified native playback before
starting. Redistribution/source closure and physical timing remain release gates.
FFmpeg sequence synthesis is still an assessed option, not an implemented feature.

## Runner previous-file shortcut — 2026-09-13

Implemented R1/RR-01 **Load previous experiment** beside the existing file picker.
A native Runner app-data bookmark survives restarts; it is committed only after
frontend acceptance of the exact native source hash. Reload reads current disk
contents, including edits, through existing validation. Cancelled/invalid new
loads preserve the bookmark. Missing files give a picker recovery message.
Controls lock while loading, running or recording; reload never starts execution.
The master JSON remains unchanged.

- Native library compiled; three real-file persistence tests passed. Diagnostic
  copy-only manifest receipt: `D:/GitHub/.affect-checks/runner-recent-tests-01/`.
- `scripts/qualification/runner-recent-ui.mjs`: 17 assertions at each of 1280px
  and 520px widths passed, using the production frontend with synthetic native
  transport. Both screenshots inspected: `runner-recent-ui-02/desktop.png` and
  `runner-recent-ui-02/narrow.png` under the same evidence root.
- `npm run runner:build` passed production bundling and Runner boundary checks.

This is component and frontend evidence. The installed desktop executable has
not been rebuilt/qualified for this shortcut; all preceding native execution,
packaging, physical timing and real XDF gates remain open.

## Native-enabled Runner build correction — 2026-09-13

The previously opened developer executable lacked native-gstreamer, causing
"Native video inspection is unavailable in this build". The Runner desktop
build script now accepts `--native-gstreamer`, matching the Planner CLI option.
Build with `AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME=1` and the pinned SDK;
default features also include LSL and Windows acquisition.

Built and opened the native-enabled dev executable with its pinned runtime at
`D:/GitHub/.affect-checks/runner-current-native-2026-09-13/`. Its build receipt
records SHA256 and scope; use **Launch Experiment Runner.cmd**, which scopes the
bundled DLL path to the launched process. Direct EXE loader/installed packaging
qualification remains open. This does not lift the qualified Start gate.

Nine focused Runner reader/master tests passed. All eight English/German
production-app questionnaire cases passed (350 assertions), using synthetic
native replies. Evidence: `runner-current-questionnaire-ui-01/receipt.json`
under the same checks root. Includes typed demographics, Likert presentation,
answer validation/drafts/submission, transitions and disposal; does not prove
actual video or real XDF execution. Current build includes the previous-file
button and questionnaire module.

## Runner readiness refresh — 2026-09-13

R1/RR-01/RR-02: Continue previously reused the launch-time native media
capability. Because native initialization is asynchronous, a pending snapshot
could falsely report that video support was absent indefinitely. Both master
and legacy checks now request current native capability after their media scan,
reject stale/disposed UI revisions, distinguish startup pending from failure,
and retain the native failure reason. No Start qualification gate was relaxed.

The production-app en-flow scenario passes 77 assertions with native capability
pending at boot and ready on the next request. Runner build/boundary checks pass.
Evidence: `D:/GitHub/.affect-checks/runner-readiness-refresh-ui-01/receipt.json`.
This fixes stale frontend state; actual native startup success remains a separate
claim and is not inferred from the synthetic transport test.

## Keyboard, recipe-root loading and current roadmap — 2026-09-13

Added production questionnaire keyboard handling: choices use arrows/Home/End,
Enter commits and advances after native acknowledgement, typed fields retain
normal typing and Shift+Enter newlines, and final Submit remains explicit.
EN/DE production-frontend scenarios each pass 85 assertions with synthetic native
transport; a retained mouse-flow regression also passes. Native-enabled Windows
build succeeds, as do three native bookmark/root tests. These are separate from
full installed keyboard and XDF qualification.

Picker/previous-file loading now selects the loaded JSON parent as the project
root under native idle authority and returns its workspace receipt. GUI default
projects share the Planner's root for convenience; exact JSON loading does not
depend on it. The portable copy in `D:/Downloads/Mock Dictator Experiment/` has
the unchanged JSON and exact declared video in `assets/stimuli/`.

The agent-only `for-ai/runner_keyboard_smoke.py` uses real PyAutoGUI keys and
read-only UI Automation checks; it is absent from app dependency/package inputs.
Live attempts proved loading/observability but stopped on a test participant
selection gap (corrected) and foreground changes. No complete questionnaire run,
actual playback or XDF claim. The active owner/metadata/checklist authority is
`for-ai/72-RUNNER-FINAL-VALIDATION.md`. Production Start qualification and the
requested separation of questionnaire presentation from video preparation are
still open. Do not label the current native-enabled development build a final
research-qualified release.
