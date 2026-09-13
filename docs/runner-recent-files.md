# Runner recent files and startup loading

Direct user amendment, 2026-09-13. R1 RR-01/RR-02 Backend Verification.

The launcher has one Load new experiment button and a native Previous files
select menu. Startup automatically loads the most recently accepted JSON once;
it does not enter fullscreen, start an experiment, or start recording. Existing
participant/version convenience selection follows the loaded file normally.
An active session/recording prevents file replacement and disables both controls.

Each recent option shows filename and parent-folder name, newest accepted first.
Selecting it rereads the current file through the complete native/JS readers,
sets its native project root to that JSON's parent, and only then confirms history.
Accepted repeats move to the top without duplication; cancelled or rejected
loads do not reorder it. Missing paths remain visible as unavailable. A missing
or invalid last file leaves the launcher usable with an error and other file
choices; it never silently loads a different experiment.

Native paths stay in app data. New research_runner_recent_experiments command
accepts action list (no entryId) or load (opaque entryId from that native list).
Unknown IDs/actions reject; no renderer-supplied absolute path is accepted.
The existing previous_experiment load/confirm/status command is retained.
Returned list schema affect-runner-recent-experiments v1 has entries with id,
basename, folderName and available (file existence, not JSON validity).

runner-previous-experiment.json now stores local history v2 {version:2,paths:[...]},
with v1 single bookmarks still readable and retained during the next accepted
save. Paths deduplicate using case-insensitive normalized path identity on the
active Windows target. Saving uses a fresh temporary file, sync and rename.
History keeps all accepted distinct paths up to explicit safety bounds of10000
entries/4 MiB; exceeding these rejects the update and preserves existing data,
never silently evicts old entries. Damaged history is reported; it is not erased.
No recipe, attempt, XDF or stream format changes in this pass.

Branch codex/segment-runner-recent-list starts at3e69d1e and stages the earlier
owned preselection commit as05c6307 (equivalentd3ae312), preserving root's
keyboard/project-root/form changes. Only append-only docs/CSS and explicit
participantManual/focus/destruction conflicts were reconciled for that dependency.

Evidence under D:/GitHub/.affect-runner-master-build/:
- recent-ui-01:52 production-app assertions across1280/520 widths; autoload,
  no picker, exact source/project root, list order/deduplication, cancellation,
  rejection, missing startup file, fallback selection and active-recording locks.
  Both screenshots inspected. Native file service is synthetic in this harness.
- recent-native-01:4 native persistence tests pass, including v1 migration,
  reload after restart, changed/deleted file, wrong confirmation, unknown IDs and
  multiple files with identical basenames. Artifact receipt identifies the
  existing copy-only CommonControls6 diagnostic setup.
- recent-version-ui-01:69 existing preselection/recording UI assertions pass.
- recent-keyboard-01:89 English keyboard/mandatory-form flow assertions pass.
- recent-node-01.log:5 pure recent-list/default logic checks pass.
- recent-native-build-01.log and recent-build-02.log: native library compilation
  and Runner build/boundary checks pass (11 files,67 dependency inputs); four
  existing optional native-media warnings remain.

This is source/component evidence. Root integration owns collecting these changes
and rebuilding the current installed Windows app. No foreground app was changed,
no SDK hold remains, and no playback/XDF/research qualification is claimed.
