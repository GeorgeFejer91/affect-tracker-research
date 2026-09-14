# Authoritative local companion application build

The current Runner entrypoint is `D:/GitHub/.affect-checks/current-apps/Experiment Runner.exe`.
Read `current-build.json` beside it and compare the source commit and both binary
hashes before any actual-app validation. The adjacent engine is an implementation
binary of the same version, not a second application version. Do not launch it
without the verified launcher.

Use `scripts/qualification/current-app-build-audit.mjs --require-current`
before any current-app validation claim. It verifies the authoritative launcher
and engine hashes against `current-build.json` and `launcher-receipt.json`, then
compares the build receipt to the checked-out clean `HEAD`. A failing audit is
a stop for installed-app qualification, not a product runtime failure.

2026-09-14 audit work found that the current app receipt still binds
`1574ece7370e418c0b6110abd045cf1e4d4dd82c-dirty` from
`codex/segment-p4-adaptive-layout`. The launcher and engine still match their
adjacent receipts and report verified runtime, but this distribution is stale
relative to repository `main`; rebuild and replace it before using the installed
Runner for keyboard, playback, timing or XDF evidence.

Root consolidates accepted segment changes into this one distribution. Isolated
source worktrees and Cargo outputs are development artifacts, not alternative
user launch targets. Do not create additional desktop/download shortcuts or
leave old application builds running. Archive superseded distributions in a
non-launchable form while preserving hashes, evidence, experiments and outputs.
Push validated source milestones to `codex/final-release-validation`; do not
claim a pushed commit is installed until the build receipt matches it. Installer
qualification and publication follow functional pipeline completion.

The consolidated SurveyJS build at `dc7f18914bc4a9d31898bb576081e99ba92f4541`
launched successfully as the sole Runner process, PID 29412, and automatically
reopened the exact mock. Old PID 25120 closed gracefully after its blocked
preparation was observed; its executable and previous current-app binaries are
archived in non-launchable form. All source milestones through this build are
pushed. Subsequent replacements must refresh the adjacent build receipt.

Native keyboard setup reached the validation checkbox and input-test region,
but all four directions remained unregistered (`runner-real-survey-settings-03`).
No experiment or recording started. The next focused fix prevents arrow-key
scrolling from cancelling the input test and waits for the initial region scroll
before arming it; actual native verification is still required. Full experiment,
geometry, ISI and XDF validation remain open.

## Resumed native validation, 2026-09-13

The current distribution now identifies source `d9bf6be` in its adjacent
`current-build.json`. Native compilation passed in
`runner-input-focus-build-01.log`; the launcher was rebuilt and verified.
Source is pushed to `codex/final-release-validation`. The previous `ba9a1c3`
executables and receipts were archived under `current-apps/history/ba9a1c3`;
its idle process closed gracefully. Exactly one replacement engine was observed,
PID 27660. The mock autoloaded with zero XDF files and participant P01.

Actual PyAutoGUI evidence `runner-real-survey-settings-05` reached the validation
checkbox, input-test button and input-test region, but timed out waiting for
native direction confirmation. Its final screenshot shows black client content,
although Windows reports the process as responsive. This does not establish
whether the native focus reconciliation fixed any part of input handling.
No recorder was armed and no experiment started.

The C: drive reported zero free bytes and the computer-use tool could not start
because it could not write kernel assets. The test driver ran with temporary
files and screenshots on D:. Restore sufficient system-drive space before the
next actual-app qualification attempt; do not treat this failed run as evidence
of questionnaire, playback, geometry, timing or XDF correctness. Do not delete
unrelated user data to recover space.

## Questionnaire validation shortcuts, 2026-09-13

The Runner now contains hidden validation accelerators for actual-app survey
inspection. With the Runner window focused, `Ctrl+Alt+Shift+Q` loads the current
or recent master JSON, chooses participant `P001` if none is selected, follows
the first terminal language route, resolves the selected or first version, and
opens the first questionnaire through the production SurveyJS renderer.
`Ctrl+Alt+Shift+N` and `Ctrl+Alt+Shift+P` step between questionnaire occurrences.
`Ctrl+Alt+Shift+F` fills the visible SurveyJS page with synthetic validation
answers. These shortcuts do not start recording, emit LSL markers, or create
XDF output, and they must not be cited as evidence for full experiment execution.
They are only a fast way to verify participant-facing questionnaire layout and
keyboard behaviour before running the stricter native session path.

`Alt+N` and `Alt+B` are the newer researcher-only validation traversal hotkeys.
They are intentionally absent from the participant UI. From the launcher,
`Alt+N` loads the previous/current master JSON, uses the standard next
participant and selected/least-used version defaults, follows the first complete
language route when needed, enters the participant presentation, and opens the
first resolved protocol step. During validation traversal, `Alt+N` advances and
`Alt+B` goes back across questionnaires, ISIs and video steps. Questionnaire
pages are allowed to advance without satisfying required fields; visible fields
may be filled with synthetic validation answers when paging. These shortcuts do
not start a recorded attempt, emit LSL markers or create XDF output, and they
refuse to hijack an active recorded attempt.
