# Real video master for local Runner validation

P7-09 / R1 RR-10, Final Runtime Correspondence. The driver
`planner-real-video-master.mjs` starts the installed production Planner CLI,
selects a new empty workspace, imports one checked-in CAAV MP4, saves one
project-authored English demographics form, authors one desktop variant with
one video occurrence, and calls the production `saveRecipe`. It then checks
the saved bytes and all declared assets with the current strict Runner JS
reader and resolves `P001` / `en` / `variant-1`. No JSON or media receipt is
hand-written.

Run from the repository root in PowerShell, replacing the proof directory with
a **new** path each time. Supply the actual fullscreen CSS viewport; the
1920 × 1080 values below are the authored values for this local receipt, not
an installed Runner viewport measurement.

```powershell
$proof = 'C:\Users\gfeje\Documents\GitHub\.affect-checks\real-master-2026-10-06-07'
New-Item -ItemType Directory -Path (Join-Path $proof 'workspace') | Out-Null
node scripts/qualification/planner-real-video-master.mjs `
  "$env:LOCALAPPDATA\Experiment Planner\affect-planner-cli.exe" `
  (Join-Path $proof 'workspace') (Join-Path $proof 'evidence') `
  (Resolve-Path site\assets\research-stimuli\caav\v1\media\caav__1-f-001__h264-1080p.mp4) `
  1920 1080
```

Observed 2026-10-06 production CLI candidate `f19b12d178130b43bf42cdbf9de942aaefdf614e`:

| Item | Exact observed value |
| --- | --- |
| Installed CLI | SHA-256 `de1bead208c84c1ab75e51a2d73ce688d6d4626b1edd97b2ec3e138a2614b875`, 13,366,784 bytes |
| Checked-in CAAV MP4 | `site/assets/research-stimuli/caav/v1/media/caav__1-f-001__h264-1080p.mp4`, SHA-256 `1719bd67d2ff0691bfc2da126ca539300650c36b003f1633cff288f4cd94356c`, 3,980,535 bytes; `metadata/primary-source-manifest.json` and `catalog.json` pin this derivative |
| Imported workspace MP4 | `assets/stimuli/caav__1-f-001__h264-1080p.mp4`, same SHA-256; CLI catalogue reports `browser-decoder` verified geometry 1920 × 1080 and duration 15,033 ms |
| Saved SurveyJS asset | `assets/questionnaires/demographics-en/en/dd8560ca008de5f670eca72fda40fae42eb11a62ca0be6f11f7a04f11b5288ee.survey.json`, SHA-256 `dd8560ca008de5f670eca72fda40fae42eb11a62ca0be6f11f7a04f11b5288ee`, 2,381 bytes |
| Master5 | `real-video-validation-recipe_2026-10-06_03-40-09-674Z.json`, SHA-256 `3406b8096e57975101b7aaca3b00a180b2e7f6a4bbcaafb4b7fbbb53471ade44`, 8,853 bytes |
| CLI transcript | 25/25 steps, SHA-256 `f8b7156e9e7202782b88297c8c8c325bf30482a76bfa4e0c4acf103002725663` |
| Strict JS Runner selection | Plan SHA-256 `e952206f1054e5f75644e3a4a50970e3b760983cdc983707407a704d21306a54`; position 1 demographics, position 2 video |

The exact workspace and evidence files are under the proof directory above.
`evidence/transcript.jsonl` holds each production CLI request and response;
`receipt.json`, `master-review.json`, and `strict-runner-read.json` hold the
transport, source/asset, and selected-plan checks. The source paths and fields
match current P1–P7 registration: `site/src/research/planner-authoring-p4.js`
uses `P4.feedback.centreX/Y`; `runner/src/recipe.js` and
`site/src/research/planner-recipe-assets.js` own strict master5 interpretation.

This proves only Planner save and source-level Runner interpretation. Installed
Runner playback, synthetic demographics answers, observed decoded frames,
LSL/XDF, actual fullscreen viewport, and research qualification are separate
Runner gates. The existing `planner-mock-experiment.mjs` uses stale native Gst
assertions and unavailable questionnaire sources and is not this fixture driver.
