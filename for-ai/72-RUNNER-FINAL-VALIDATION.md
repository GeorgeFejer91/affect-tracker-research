# Current primary goal and JSON authority — 2026-09-13

The latest user amendments govern this pass. Root is the sole implementation
and release owner: no delegation. Finish the installed Windows Runner, not just
its parsers or a simulated browser. Keep the full end-to-end goal active until
real execution and independently read XDF prove it.

## Authoritative experiment recipe

Planner writes one canonical, versioned master JSON. Every segment contributes
its complete experiment-defining metadata. Runner must interpret that contract
without consulting Planner memory or inventing settings from defaults.

| Owner | Required contribution and Runner use | Verified current wire surface |
| --- | --- | --- |
| P1 | Study identity; explicit video IDs and asset paths; file identity, duration and display geometry | `segments.P1.study`, `workspaceLayout`, `videoCatalogue.entries`: `annotationId`, `assetId`, `sourceRelativePath`, `packageRelativePath`, `sha256`, `byteLength`, `durationMs`, `geometry` |
| P2 | Full questionnaire/form definitions, item order, response choices/types, authored scoring, exact language routes and presentation | `segments.P2.questionnaires`, `languageSelection`, `presentation`; EN/DE demographics, 37-item MAIA-2 and 20-item TAS are embedded in the current mock |
| P3 | Named user-defined ISIs, version columns/chronology, repeating participant allocation, and marker identities | `segments.P3.isiDefinitions`, `variants`, `allocation`, `markerContract`, library identity |
| P4 | Screen units, viewport/calibration, reference-video fit and centre-relative video/Flubber geometry | `segments.P4.viewport`, `units`, `calibration`, `coordinateSystem`, `reference`, `fit`, `feedback` |
| P5 | Flubber appearance, neutral response, mapping, animation and input configuration | `segments.P5.visual`, `presentation`, `input`, `response`, `mappings` |
| P6 | Explicit optional XR inclusion and world-fixed layout when supported | `segments.P6.status`; current mock explicitly omits XR; do not imply desktop Runner supports XR |
| Shared policy | Participant count, sampling, playback/audio, output and authored LSL convention | Top-level `policy` and `integrity`; segment hashes and reproduction identity bind the complete source |

This inventory is source/recipe evidence, not proof that every consumer applies
every field correctly. Audit each owner and named consumer against this table;
do not add duplicate convenience copies of whole segment projections.

## Asset location contract

- A common default project folder is a convenience only, never a prerequisite
  for interpreting a recipe. The latest user explicitly rejects dependence on
  an unrelated default directory.
- `packageRelativePath` identifies runtime media beneath the experiment project
  root. `sourceRelativePath` is catalogue provenance, not an automatic fallback.
- Current implementation work makes successful Runner file loading establish
  the loaded JSON's parent directory as that project root, for both picker and
  previous-file loading. Native authority retains the absolute root; frontend
  receives a workspace receipt. Active-run guards remain in force.
- Example: `D:/Studies/Example/experiment.json` plus declared
  `assets/stimuli/clip.mp4` resolves to
  `D:/Studies/Example/assets/stimuli/clip.mp4`. Moving that directory together
  preserves the portable contract. Moving only the JSON does not move media.
- Verify every declared path, hash, length, duration and geometry; reject
  missing, changed, ambiguous or undeclared content. No silent directory search,
  ID reconstruction, substitution, or fallback to an ambient library.
- Arbitrary external absolute locations are not a field supported by master3.
  If required beyond portable relative paths, introduce an explicit versioned
  producer/consumer locator contract and migration tests; do not silently add
  unknown fields or weaken the existing readers.

## Keyboard and testing requirements

- The actual Runner must be fully operable with keyboard controls: setup,
  language/version/participant selection, dialogs, questionnaires, session
  controls and completion. Use Tab/Shift+Tab and native button/select behaviour.
- Questionnaire choices: arrows select; Home/End select first/last; Enter
  explicitly accepts the focused option and advances after native draft
  acknowledgement. Focusing a radio must not silently answer it.
- Text and age use ordinary typing, Enter advances, and Shift+Enter preserves
  multiline text. Last item focuses Submit; a further Enter submits through
  existing validation. Rejected/pending drafts must not advance focus.
- Preserve mouse operation, focus on fresh forms, reverse navigation, native
  form validation, and input isolation during questionnaires/ISIs.
- PyAutoGUI is exclusively an agent test utility under `for-ai/`. Never import
  it into the app, add it to app runtime dependencies, or package its sequence.
  It uses synthetic answers, target-window guards and real keypresses. Screen
  or readiness failure must stop the sequence, not continue typing blindly.
  The utility is [runner_keyboard_smoke.py](runner_keyboard_smoke.py). It uses
  PyAutoGUI for keys/screenshots and UI Automation only for target/focus/state
  checks. Start with `--phase inspect`; it requires explicit PID, recipe and a
  new output directory. `--phase all` is not proof of success unless its actual
  observations and independently inspected XDF confirm the full experiment.
  PyAutoGUI uses the foreground keyboard; it cannot run safely in the background
  while the researcher types in another application. The driver aborts on focus
  loss and never disables its fail-safe. Keep Runner foreground during a run.

## Completion checklist and current evidence

- [x] Exact mock JSON contains EN/DE demographics, MAIA-2, TAS-20 and six ordered
  steps: forms, 1750 ms named ISI, declared Dictator video, 3213 ms named ISI.
- [x] Installed pinned runtime reverified: 827 files / 340362958 bytes. Receipt:
  `D:/GitHub/.affect-checks/runner-installed-runtime-verification-01.log`.
- [x] Native control recovered after Codex restart; actual Runner launcher and
  loaded master observed. Physical Escape then stopped control; no full run.
- [x] Missing current-workspace video diagnosed; exact 86870779-byte asset copied
  and hash checked. Receipt: `runner-installed-video-01.json` in checks root.
- [x] Initial keyboard handler checks pass in EN and DE with production frontend
  and synthetic native responses (85 assertions each). This is not native-key
  or experiment execution evidence.
- [x] Native-enabled keyboard/recipe-root build compiled and replaced the current
  local executable. Three native bookmark/root tests passed. Actual loading of
  the portable Downloads copy updated the persisted previous-file bookmark.
- [ ] Verify all installed keyboard behaviours through the complete experiment.
- [ ] Complete PyAutoGUI sequence through the actual app and all questionnaires.
  Initial live attempts exposed a missing participant selection in the test
  sequence (corrected), then stopped on changed UI/foreground ownership. Retained
  receipts: `runner-keyboard-live-setup-01`, `runner-keyboard-live-setup-02`,
  `runner-keyboard-live-prepare-01` under `D:/GitHub/.affect-checks/`.
- [ ] Finish contract-to-consumer audit for every segment with explicit failures
  for missing or inconsistent metadata and deterministic native/JS agreement.
- [ ] Separate questionnaire presentation from video preparation where the
  versioned run/recording contract permits; currently global Start/preflight
  checks block the first form. Definitions are present; this is execution gating.
- [ ] Close native playback qualification. Existing production Start expressly
  requires qualified native media; false qualification flags cannot be flipped
  merely to make the test proceed.
- [ ] Run the full video and exact ordered ISIs with neutral Flubber, real LSL
  recording and independent XDF reconstruction; capture actual layout screenshots.
- [ ] Leave a current locally runnable companion build and retained evidence;
  compile success and a visible launcher are not final research qualification.

Current source work is in `D:/GitHub/affect-tracker-research-master-v3`, branch
`codex/final-release-validation`. See `docs/release-validation.md` for prior
artifact identities and gates. Keep pending work explicit after every pass.

## Participant layout amendment — 2026-09-13

R1 presentation scope: participants see the questionnaire title, authored instructions, questions and one Next/Weiter action. Use a centered 210 mm maximum-width reading column; short forms center vertically and long forms scroll. Keyboard assistance remains available to assistive technology, without visible control clutter. Researcher session controls remain accessible through Escape. Terminal participant language selection automatically performs the existing preparation/start checks; preview language selection never starts a session. Legacy external-demographics preparation retains its explicit action. No JSON, questionnaire wording, scoring or native qualification gate is changed.

Verified production frontend with synthetic native replies: centered German keyboard form 89 assertions, English complete flow 78 assertions, English keyboard form 86 assertions; screenshots inspected in D:/GitHub/.affect-checks/runner-centered-{en,de}-01. These are frontend evidence, not actual native playback or XDF qualification. Test-only PyAutoGUI sequence now relies on language auto-advance. Native full-run validation remains pending.
