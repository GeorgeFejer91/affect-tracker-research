# Hidden Runner abort shortcut

The researcher's 2026-09-13 request assigns **Alt+Esc** to abort the fullscreen
participant presentation without a confirmation dialog or visible shortcut hint.
This is R1/RR-01 with RR-07 native-input and RR-09 controlled-stop seams.

The Runner's existing listen-only `monio` hook observes the exact Alt+Esc chord
while its native window is focused and its fullscreen callback is armed. The
existing Runner-only fullscreen command carries a `Channel<()>`; no keystrokes,
answers or other input data are sent through it. The native hook is required
before entering fullscreen, and the callback is removed after successful exit
or input-service shutdown. Leaving fullscreen unsuccessfully keeps the callback
available for retry. Planner has no access to this command.

The frontend also handles Alt+Esc in capture phase, including open dialogs.
Both inputs use the same controlled `stopEarly` operation as the existing stop
control. They coalesce repeated activation, invalidate pending preparation and
discard queued participant actions. A Start already in flight is stopped after
its native acknowledgement. Existing native finalization retains partial attempt
records and recording; the app does not kill its process or label an abort as
successful experiment completion. Preparation without a started attempt exits
without creating one. Stop failures remain visible and recoverable. Plain Esc
keeps the existing session-menu/back behavior.

The hook remains listen-only: Windows may also switch windows, its documented
[Alt+Esc default](https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows).
It observes the chord before forwarding the event, avoiding reliance on WebView
delivery of a system shortcut. This does not introduce system-key suppression,
a second hook, a new dependency, unsafe code, recipe fields or recording schemas.
The bounded notification uses the existing pinned
[Tauri channel API](https://v2.tauri.app/develop/calling-frontend/#channels).

## Verification

Evidence is under `D:/GitHub/.affect-checks/`:

- `runner-alt-escape-native-test-01/tests.log`: 25 native input tests pass,
  including exact modifiers, focus/fullscreen scope, repeat/rearm handling,
  unavailable backend, shutdown and no rating-region requirement. The normal
  no-default-feature Cargo library test compiled, but Windows initially rejected
  its unmanifested test executable with `0xc0000139`. The repository's existing
  copy-only CommonControls6 test-manifest helper produced the passing artifact;
  `artifact-receipt.json` preserves both hashes. No product manifest was changed.
- `runner-alt-escape-node-01.log`: 18 existing package/master adapter checks pass.
- `runner-alt-escape-browser-v3-final/receipt.json` and
  `runner-alt-escape-browser-v4-final/receipt.json`: actual production app with
  synthetic native replies, eight English/German cases per version. Tests cover
  preparation, dialogs, ordinary Esc, wrong modifiers, repeats, pending Start,
  stop acknowledgement/failure, partial outcome and disposal.
- `runner-alt-escape-legacy-stop-02/receipt.json`: 26 legacy app assertions pass,
  including Alt+Esc through an open stop dialog. The earlier full historical
  harness lacked the recent-files reply; that fixture boundary was updated.
- SurveyJS generated-content checks and Runner production build/boundary pass.
- `runner-alt-escape-clippy-01.log`: no-default-feature library Clippy completes
  with 27 existing dead-code warnings outside the changed input/fullscreen code.

Native Windows key delivery, the current executable rebuild and a physical
participant/XDF run remain integration/qualification work. Browser events and
synthetic native replies are not that evidence.
