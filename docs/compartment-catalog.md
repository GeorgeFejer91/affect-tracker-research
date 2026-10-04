# Planner, display and Runner compartment catalog

Source snapshot: `7088860` on 2026-10-04. This is a function and handoff index for the current Windows source, not a second schema or a qualification receipt. Update the affected row whenever a control, native consumer, or saved setting changes. Capability status remains in [`for-ai/60-SEGMENT-CATALOGUE.md`](../for-ai/60-SEGMENT-CATALOGUE.md) and [`for-ai/65-RUNNER-SEGMENTS.md`](../for-ai/65-RUNNER-SEGMENTS.md); exact fields are defined by the linked wire contracts and strict readers.

## Program and file boundary

| Compartment | Role | Authoritative data |
| --- | --- | --- |
| Experiment Planner ledger | Collects and validates P1–P4 and P6, then P7 saves the accepted design | `affect-research-planner-recipe` master JSON, `segments.P1`–`P6`, top-level policy and integrity |
| Persistent Flubber & Controls window | P5 edits the selected Flubber, 2D Grid or procedural Face and the response/input behavior; the live x/y test position is temporary | `segments.P5`; `presentation.renderer` is the saved three-way choice |
| Experiment Runner | Reads exact saved recipe bytes, binds files, selects a participant, route and variant, executes the protocol, and records evidence | Immutable recipe copy, attempt/selection receipts, response and rating rows, lifecycle events and Runner-owned XDF |

Fresh Planner saves currently use **master version 5**. Its JSON contains the six named segment contributions and a hash-bound questionnaire asset registry. The SurveyJS questionnaire bodies are separate declared files under `assets/questionnaires/`. Video bytes are separate under `assets/stimuli/`. Thus the current output is one authoritative JSON **manifest plus referenced assets**, rather than a single self-contained JSON file. Moving the project requires moving the JSON and all referenced assets together. [Questionnaire asset contract](planner-questionnaire-assets.md) and [compatibility map](../for-ai/66-PLANNER-RUNNER-COMPATIBILITY.md) define this existing boundary. Making questionnaire content self-contained in one JSON would require a versioned P2/P7/Runner contract change.

The current Planner's left ledger has Workspace & Libraries, Languages & Study Assets, Stimulus Presentation Order, Screen & Layout, VR screen layout, and Review & Export. Flubber & Controls stays in the right window rather than closing with the ledger accordions. `SETUP_SECTIONS` still contains its historical `review` label **Review & Start**; the desktop entry renders **Review & Export** and has no participant Start authority. [UI section list](../site/src/research/ui-contracts.js) and [desktop boundary](../for-ai/16-COMPANION-APP-BOUNDARY.md) are the source of this distinction.

## Planner ledger

| Owner and visible functions | User input / previous inputs | Validated output in master JSON | Backend and next consumer |
| --- | --- | --- | --- |
| **P1 Workspace & Libraries:** choose study/work directory; import or rescan complete videos; show the catalogue and exact file identity; reopen a project against freshly authorized files | Directory choice, study ID/title, video files; target FFprobe inspection after Segment 1 confirmation and FFmpeg conversion when needed | `segments.P1.study`, `workspaceLayout`, `videoCatalogue.entries` with reversible path annotation, content ID, safe relative playable path, SHA-256, byte length, duration and geometry; incompatible originals stay in a separate source folder outside `assets/stimuli` | [Browser workspace](../site/src/research/workspace.js), native `research_workspace`; P3 selects video IDs, P4/P6 read geometry, Runner re-verifies prepared media; conversion is not yet implemented |
| **P2 Languages & Study Assets:** choose language routes; create/import MAIA-2, locally supplied TAS, demographics or custom SurveyJS; edit items/options and order; preview participant forms; check per-language coverage | Language tree, exact wording, option labels/codes, required flags, SurveyJS JSON or table paste, source/provenance and module placement; P1 questionnaire storage | `segments.P2.languageSelection`, `questionnaires` asset registry/modules, and `presentation` definition hashes; master5 `contentIntegrity` binds external form bytes | [P2 authoring](../site/src/research/questionnaire-authoring.js), [SurveyJS contract](surveyjs-questionnaires.md), native questionnaire asset reader; Runner presents the chosen route and validates submitted answers |
| **P3 Stimulus Presentation Order:** maintain a named millisecond ISI dictionary; edit version columns and chronological video/ISI rows; paste a spreadsheet rectangle; preview and export the order | P1 video identities/durations, optional P2 form placements, researcher-entered ISI durations and exact row order | `segments.P3.isiDefinitions`, ordered `variants.entries`, `allocation:{kind:"runnerAssigned"}`, marker contract and integrity | [Variant model](../site/src/research/variant-design.js) and native mirror; Runner selects a saved variant and executes each occurrence without reordering |
| **P4 Screen & Layout:** select target viewport and reference-video method; set video and feedback size/centre, fit, relative or calibrated physical units; inspect clipping and mixed-video layout | P1 oriented video geometry and P5 painted feedback envelope; viewport, calibration and geometric placement | `segments.P4.viewport`, `units`, `calibration`, `coordinateSystem`, `reference`, `fit`, `feedback` | [P4 contract](planner-p4-layout-contract.md) and native geometry mirror; Runner uses exact geometry on a matching viewport or reports a defined fallback |
| **P6 VR screen layout:** explicitly exclude XR or author a world-fixed spatial profile and rotate its preview | P1 media geometry, P5 feedback envelope, spatial dimensions, distance and initial head-forward anchor | `segments.P6` as explicit `excluded` or `included` profile | [P6 contract](../for-ai/63-P6-XR-LAYOUT.md); desktop Runner rejects an XR target rather than pretending to execute it |
| **P7 Review & Export:** show owner readiness, target and run policy; confirm sections; name/save, open and reproduce the recipe | Accepted current P1–P6 contributions; participant-count metadata, sampling rate, CSV/TSV, playback/audio and authored outbound LSL settings | Root `schema`, `version`, `recipeId`, `presentationTarget`, `policy`, `segments`, `integrity`, and for master5 `contentIntegrity` | [Recipe compiler](../site/src/research/planner-recipe.js), native strict reader/writer and [master contract](planner-master-recipe-v1.md); Runner reads exact bytes and never repairs unsupported content |

Confirmation and open/closed accordion state are editor state. They do not create another JSON segment. P7 serializes accepted values, and current edits invalidate affected acceptance. Asset paths in JSON identify files; they do not grant filesystem permission.

## Persistent feedback window (P5)

The right window stays visible while a ledger segment changes. Its controls have one saved owner, `segments.P5` (`affect-research-feedback` version 2); the pointer/key test position, animation phase, temporary held input, focus and scroll are excluded from the recipe. [P5 field contract](planner-p5-feedback-v2.md), [saved validator](../site/src/research/feedback-settings.js), [editor](../site/src/research/planner-authoring-p5-controls.js) and [shared renderer](../site/src/research/preview.js) define the current implementation.

| Function group | Researcher input / prior state | Saved output and Runner use |
| --- | --- | --- |
| Three-way display | Flubber, 2D Grid or Face button; one shared live valence/arousal test point | `presentation.renderer` = `flubber`, `grid` or `procedural-face`; Runner projects that choice, not the temporary test coordinates |
| Appearance | Visibility, opacity, outline, halo width/falloff, grid lines/cursor, eight colors, axes/corners and display labels | `visual` and `presentation` specify painted feedback; literal recolor results persist, random seed does not |
| Response behavior | Continuous/stepwise choice, odd grid dimensions, full-span duration and hold/repeat rule | `response` defines native and browser coordinate updates during an active video |
| Input | Preset or custom physical directions; inert setup test | `input` is the saved binding; Runner retests its actual device and has a separate session override boundary |
| Advanced mapping | Six min/max, driver and reverse choices | `mappings` derive oscillation frequency, edge smoothness, projection amplitude, pulse synchrony, wave-size variation and saturation from one x/y snapshot |

For a master recipe, [Runner's projection](../runner/src/recipe.js) maps `presentation.renderer` to the participant surface. [Runner app](../runner/src/app.js) replaces its initial legacy preview with a three-mode surface after a master is loaded. The current focused software suite includes an authored Grid case; full Flubber/Grid/Face installed visual correspondence is still a verification task. Legacy package-v1 feedback retains its separate Grid/Flubber semantics.

## Runner execution and evidence

| RR function | Inputs from JSON and session | Runtime output / authority |
| --- | --- | --- |
| RR-01/02 Launch and intake | User-selected exact master JSON plus hash-bound questionnaire assets; native/browser capability | Independent Runner program, strict schema/version rejection, immutable parsed recipe and source hash |
| RR-03 Selection | Explicit participant, language-tree path, saved variant and new-attempt decision | Frozen selected plan and output identity; defaults from XDF history are advisory and manually overridable |
| RR-04 Protocol/media | P1 verified video files, P3 ordered occurrences/ISIs, P2 modules and saved playback policy | Video/form/ISI transitions and observed events; HTML/WebView is the current playback path, while qualified native Start remains closed |
| RR-05 Feedback/layout | P4 viewport profile; P5 renderer, colors, mapping and response rules | Adjacent participant feedback from acquired x/y; actual video/layout/paint correspondence still needs installed evidence |
| RR-06 Questionnaires | Exact selected language definitions and ordered form steps | Drafts, mandatory answer validation and durable submitted responses; names in demographics follow the versioned form contract |
| RR-07 Input, sampling, outbound LSL | Saved binding, frequency and stream metadata; Runner session override if validated | Native input state, timestamped affect samples and semantic markers; changed controller drafts cannot silently execute |
| RR-08 XDF recording | Runner-selected own/external streams and destination | One create-new XDF plus stream identity, clock and incomplete/final receipts; stream selection is absent from Planner JSON |
| RR-09 Storage and recovery | Frozen recipe/selection/attempt and accepted records | No-overwrite output folder, source copy, journal, CSV/TSV, result/partial receipt; master resume remains unavailable |
| RR-10 Correspondence | Exact saved recipe and each actual observed protocol step | Independent reconstruction and qualification evidence; parser tests, synthetic runs and opened windows cannot establish a complete research run |

Current Runner video presentation uses HTML video, while [native capability](../src-tauri/src/research_native_media/capability.rs) still reports `qualified_start_available:false`. The P1 FFprobe/FFmpeg preparation target, exact playable-file binding and installed actual video/questionnaire/input/LSL/XDF workflow remain open under the [release gates](../for-ai/30-TESTING-AND-RELEASE.md) and [Runner validation ledger](../for-ai/72-RUNNER-FINAL-VALIDATION.md). A two-app installer by itself cannot close these gates.

## Update rule

For each affected row, check the visible control, input validation, saved JSON location, strict JS/Rust reader, Runner consumer, and a rendered or installed observation. Mark missing evidence in the owning ledger. Preserve historical master1–4 and package-v1 readers when changing the current saved generation.
