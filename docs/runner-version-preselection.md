# Runner defaults from XDF filenames

Direct user amendments dated 2026-09-13 allocate R1 RR-03/08/09/10.
The user selected least-used across all participants, every existing XDF
(including stopped runs), and the same filename inventory for participant defaults.

## Behavior

- Master loading preselects the first unused canonical participant number,
  displayed P01, P02, etc., up to P100000. Gaps are reused. If all numbers appear
  in the inventory, leave it empty for explicit manual selection.
- Preselect the version with the lowest recording count across all participants;
  ties follow the saved P3 variants array order. Zero files selects the first.
- V1, V2, etc. are one-based ordinals in that immutable JSON's saved variant
  order, displayed alongside the authored title. Never derive numbers by parsing
  arbitrary variant IDs/titles. The complete selected variant ID still enters the
  existing native plan and run evidence.
- Both defaults can be overridden. Choosing a different participant resets the
  suggested version for that selection. A manual version stays selected while
  preparing that participant. Loading another experiment or finishing/stopping
  recording resets defaults from a fresh inventory. No allocation is reserved.
- Used participant highlighting and existing rerun-confirmation protections
  remain. New XDF participant names also appear as used even if attempt records
  are absent. A repeat stays possible through the existing confirmation flow.
- The dropdown lists recording count and distinct participant count for each
  version with proportional bars. Color moves from green at zero to red at the
  current largest count; numbers and selected/focused states remain independent
  of color. Arrow/Home/End/Enter/Escape/Tab and mouse selection work.
- Failed/unavailable inventory never becomes a zero-count claim or an automatic
  allocation. Manual selection remains available with an explicit status.

## Native filename and inventory contract

`research_recorder_start_v2` accepts `{workspaceId, request:{version:2,
participantId, variantId, recording:<unchanged RecordStartRequest>}}`.
Native validates the full source, canonical participant and exact declared
variant before generating `P01_V1_20260913T143052123000000Z.xdf` (UTC nanoseconds).
The existing writer reserves with create_new, so collisions never overwrite.
No arbitrary filename/path input is accepted. Existing recorder request/status,
sidecar structure, own/external stream handling and XDF samples remain unchanged.
The old command is retained for legacy package recordings and existing callers.

Files remain in `outputs/recipe-<full source SHA256>/recordings/`. The exact JSON
still has its dedicated output directory. Existing UUID-named recordings are not
renamed or assigned guessed versions. The status visibly counts unrecognized
XDF names separately. The inventory recognizes canonical P01 aliases, V1 ordinals
and valid UTC calendar timestamps with 3 or9 fractional digits; out-of-range
versions, sidecars and unknown names do not contribute. Repeated files for the
same participant count as multiple recordings and one distinct participant.
Empty/partial/stopped XDF files count too, by explicit user decision. This is
filename inventory, not evidence that XDF content or the experiment is complete.
Removing a matching file removes its contribution on the next refresh.

`research_runner_variant_usage` accepts the existing workspaceId/sourceText
pair and returns schema `affect-runner-variant-usage`, version1,
recipeSourceByteSha256, basis `xdf-file-names-v1`, ignoredXdfFiles,
usedParticipantIds, and ordered variants `{variantId,recordingCount,participantCount}`.
The native scan is bounded to200000 directory entries, checks the selected
output-directory identity and rejects nonordinary XDF entries. No plan/result
mutation or content reader is involved. JS validates source, ordered IDs, counts
and canonical participant IDs before choosing a default.

While a recorder is armed the two selectors lock. Native Master Start additionally
checks the selected participant/version against the active named filename;
legacy unnamed recordings retain their previous behavior. Recordings continue to
belong exclusively to Runner session policy, never Planner recipe policy.

## Evidence and handoff

Isolated branch codex/segment-runner-version-usage, base468de36. Integration owner
must collect this change alongside its current keyboard/recipe-root work; no
shared worktree was edited. New registered commands are included in the two small
lib.rs hunks. No publication or installed app qualification is claimed here.

Evidence under D:/GitHub/.affect-runner-master-build/:
- variant-ui-04/: 69 assertions across desktop/narrow/menu-closed production UI
  cases with synthetic native inventory/recorder; screenshots visually inspected.
- variant-forms-01/: all8 EN/DE production questionnaire cases,350 assertions,
  synthetic native replies; mandatory-answer and runtime transitions retained.
- variant-native-02/: copied diagnostic test artifact receipt, recorder and
  master test logs: 13 recorder tests pass (one explicit external-transport
  exercise remains ignored),27 master tests pass. Uses the existing CommonControls6 copy-only diagnostic script.
- variant-node-02.log, variant-native-build-02.log and variant-build-02.log:
  17 focused logic tests pass; native compilation passes with four existing optional
  media warnings; Runner production asset/boundary checks pass (11 files,65 inputs).

These are bounded component tests. Actual desktop recording, external LSL,
installed keyboard/accessibility and full experiment timing remain the root
integration/release gates. No new unsafe boundary, dependency or Planner field.
