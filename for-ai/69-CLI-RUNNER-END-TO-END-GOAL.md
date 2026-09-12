# CLI → Planner JSON → Runner validation goal

### Current reconstruction prerequisite receipt

Root independently read the earlier Runner synthetic lifecycle XDF with pyxdf
1.17.0, without a recipe sidecar. Its SHA-256 is
`92fffaf48cfbd49f4190224e9addc52d71aca8fc78f8452f216f5074d643a0fa`.
Two streams contain 23 marker messages (one verified profile plus 22 contiguous
observations), ten matching occurrence start/end pairs and matching footer count;
the affect stream has zero samples. The actual LSL span is about 0.00624 seconds,
while test-injected monotonic event positions span about 51 seconds. This is
deliberately synthetic event sequencing, not actual experiment timing.
`D:/GitHub/.affect-runner-master-build/root-independent-synthetic-xdf-review.json`
and its Python script retain the independent checks. Complete source bytes,
participant answers and demographics are absent from that older profile; the
new information protocol below is still necessary.

## User amendment: complete Runner smoke and XDF reconstruction — 2026-09-12

The user explicitly requires the actual Runner to read the exact Planner JSON,
present the participant's questionnaires, play the actual video, preserve its
leading/trailing ISIs and save an XDF from which the whole experiment can be
reconstructed. The primary LSL information/marker stream must retain participant
metadata, complete questionnaire definitions and answers, and observed temporal
events with unique video, named-ISI and occurrence identities. Separate attempt
files or the original Planner JSON must not be necessary to interpret the XDF.
This extends the existing goal; it does not replace the original mock or permit
fixture-only, parser-only or unqualified native playback claims.

The user's demographic answer activates a **shipped EN/DE demographics asset**:
full name (text), age (number), gender (male, female, other, prefer not to say),
and handedness. The stated implementation uses whole years and handedness options
right-handed, left-handed, ambidextrous and prefer not to say. Put demographics
first in the mock, followed by MAIA-2 and TAS-20, then named ISI 1750 ms, the exact
Great Dictator clip, and named ISI 3213 ms. Both complete language routes remain
available for participant selection. This is a project-authored standard form,
not a claim of psychometric validation. Smoke responses must be explicitly
synthetic; no real participant is enrolled by this test.

S2 owns the bilingual asset and explicit typed text/integer/single-choice form
proposal. Main owns shared master/native reader integration; Runner owns the
participant controls, typed answers and recording. Preserve existing Likert and
old master contracts through explicit versioned dispatch. Never encode arbitrary
names or ages as fabricated Likert options, invent scoring or impose an unasked
adult-only eligibility rule. CLI and UI must expose the same new form capability,
and the maintained [CLI library](71-CLI-LIBRARY.md) must describe it after its
contract is frozen and implementation is verified.

Runner's approved bounded protocol direction uses its existing single marker
outlet with a new versioned, sequenced information envelope. A startup header,
indexed chunks and verified commit carry exact canonical Planner bytes, immutable
selection, the complete execution dictionary, effective output settings and
participant metadata. Each wire chunk is at most 128 KiB and the startup bundle
at most 64 MiB; assembled memory and startup duration must also be bounded.
Attach the recorder before the first envelope and begin acquisition only after
the committed startup bundle. Later records carry typed draft/submitted answers,
observed lifecycle transitions and explicit final or interrupted outcome.
The Runner owner freezes the exact schema and implementation; this paragraph is
the authorized seam, not a second schema definition or completion receipt.

Preserve actual LSL timestamps and native observation times separately from
planned offsets. Emit distinct start/end events for every video and named ISI,
including repeated IDs, consecutive ISIs and zero-duration intervals. Pause,
resume, errors, cancellation and incomplete recording must remain distinguishable.
The stream binds recipe, run, attempt, participant, variant, language path,
definition/item/option IDs and occurrence/execution IDs as appropriate.

Independent verification must begin with **only the saved XDF**. Reconstruct its
canonical recipe/selection, demographics, exact shown questionnaire definitions,
typed answers and ordered observed timeline; then compare these reconstructed
values with the original exported recipe and separately recorded UI/native
observations. Reject or explicitly report missing profile/chunks/events, duplicate
or reordered sequences, bad hashes, invalid typed answers and clock reversal.
Do not repair gaps by inferring events from planned durations. XDF retains media
identities, locations, hashes and metadata; replaying video pixels still requires
the matching video asset, not a covert copy of video bytes in LSL markers.

Acceptance includes real participant-panel rendering for both languages, real
full-clip playback, measured leading/trailing intervals, saved Flubber/input/layout
behavior, actual LSL capture and independent XDF reconstruction. Synthetic
transport tests are useful prerequisites with their own receipts. They cannot
close the actual smoke test. Existing installed/native timing, lifecycle, source
closure and capability gates remain in force.

## Explicit allocation — 2026-09-12

The researcher requested an active goal to perform a full test run: create the
JSON from scratch through CLI inputs, establish that the CLI settings are also
operable in the UI, load the resulting file into Experiment Runner, and verify
that Runner performs the actions authored in Planner. The goal was created in
Chat Orchestrator. This explicitly allocates the previously deferred RR-02/RR-10
correspondence stage for this desktop experiment. Earlier deferral text is
historical for this scope; it still explains why baseline Planner completion in
[67](67-PLANNER-COMPLETION-GOAL.md) did not require Runner completion.

Stage: Backend Verification. Deliverable: production CLI commands, one real
timestamped master JSON and its media library, a CLI/UI setting trace, and exact
Runner interpretation/execution evidence. Main integrates; segment owners fix
their own gaps and named seams. Chat Orchestrator owns this plan and independent
evidence review. No publication, network controller, new unsafe boundary or
qualification bypass is implied. Capability checkboxes remain in [60](60-SEGMENT-CATALOGUE.md).

## Test progression

| Step | Action | Evidence needed before claiming it passed |
| --- | --- | --- |
| 1. Freeze candidate | Integrate tested CLI owner adapters and supported Runner consumers in isolated agreed candidate | Exact commits, clean/intentional diff, build identities; preserve legacy readers |
| 2. Prove setting parity | Map each authored CLI field/list operation to its actual UI owner/control and saved contribution | CLI set/readback, UI edit/readback, equal normalized value and JSON outcome; derived/transient fields explicitly classified |
| 3. Author from scratch | Start a fresh production CLI session, select workspace, import actual media/questionnaire sources and author every required contribution | Bounded command transcript, owner revisions, real P1 media verification, no imported master or fixture as starting authority |
| 4. Export and reopen | Save timestamped JSON, reopen through strict readers, edit a setting and save another version | Exact bytes/hashes, collision/no-replacement proof, unchanged first file, independent JS/Rust reproduction of both language routes |
| 5. Bind Runner | Load the exact original exported file, authorize real media, choose test participant/language/variant | Source-byte hash equality, immutable selection receipt, full capability validation; no lossy conversion or ambient defaults |
| 6. Run both routes | Execute English and German in separate test attempts | Actual presented questionnaires/order/codes, observed video/ISI transitions, input/Flubber/layout evidence, completion or explicit failure |
| 7. Compare outcomes | Match observed results against authored recipe and expected ordered events | Per-setting trace, timing deviations and existing acceptance criteria, actual requested output/marker evidence, exact output-folder/attempt identities |

A query listing is not UI parity. A rendered control alone is not proof that it
updates the same setting. Convenience transport commands such as help, snapshot
and cancellation need not become UI controls; every experiment-authoring action
must have the corresponding user operation. Include ordered edits, imports,
unit conversion, invalid drafts, stale requests and edit/revert cases. One simple
mock cannot exercise every alternative: use focused additional CLI/UI cases for
settings and modes outside the mock, with their evidence kept separate.

## Requested experiment

Use the sources and sequence in [68](68-PLANNER-CLI.md): participant explicitly
chooses English or Deutsch; MAIA-2 precedes TAS-20 before the timed sequence;
named ISI 1750 ms, confirmed Great Dictator study clip, named ISI 3213 ms. P4
desktop layout, full P5 Flubber/input settings and P7 policy are explicit; P6 is
excluded for this desktop example. The actual clip duration is media-derived.
There is one authored variant; explicitly selecting it for the test does not
invent or approve a general participant allocation algorithm.

Runner test responses are synthetic test data and must be identified as such;
they are not participant research data or instrument-scoring validation. Do not
alter questionnaire content, supplied codes, event order or intervals to make
the run pass. Exercise the real participant presentation and protocol transition
paths; a test-only time jump, fabricated decode receipt or substituted scheduler
does not establish actual execution.

Runner owns participant attempts, actual timing, output isolation, actual LSL
and any selected recording. Preserve the separate-app boundary. If the recipe
enables LSL, capture and independently compare actual marker/sample evidence;
never record unrelated discovered streams implicitly. Record intended versus
observed interval duration using existing timing criteria, not exact wall-clock
equality invented for this test. Unsupported targets/settings must reject visibly.

Run an isolated identified candidate with a dedicated test workspace and output
directory. Prefer background verification and preserve existing user windows,
focus and experiments. Any behavior unavailable in that mode remains explicit;
do not call hidden renderer or parser evidence physical/installed qualification.

## Current blockers and evidence ledger

At goal creation the canonical baseline is `460f516`; CLI adapters and file
writer are in owner worktrees, not yet an integrated end-to-end CLI. Root's
extension roadmap checkpoint is `80b5afa`. Exact implementation receipts belong
to the subsequent candidate, not the baseline.

The researcher has now explicitly authorized the retained English TAS-20 for
the local mock and requested an online German source. Root located and visually
checked all 20 items and five anchors in Handrack's 2016 dissertation, appendix
A8, PDF page 142. The university-hosted source is
[Handrack dissertation](https://jlupub.ub.uni-giessen.de/bitstreams/0b9557df-78c8-4bab-96e5-d84f3b94f9a5/download).
Its methods cite Bach et al. (1996); this identifies the appendix source, not
independent verification against the original translation master. A
[meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC9597132/) reports several
German translations, so preserve the exact source wording and provenance rather
than mixing versions. The downloaded PDF SHA-256 is
`d982b1953026f3f6246efc9a75fb97fc02abfbe3a7fe0f0b1ad2390fccc7cf3c`.
Source and inspected rendering are in
`D:/GitHub/.affect-checks/tas20-german-source-20260912/`.
S2 prepared `tas-20-de-handrack-2016-local.csv` in that evidence directory:
124978 bytes, SHA-256
`7b32c878cf83d2b0348498355402f1a8d1db5853aeffeaf2f74863ea701eef92`.
All 20 items and five anchors were independently compared with the original
page. Root reproduced production CSV import using `sourceKind:researcherCsv`
and the exact logical filename, giving definition SHA-256
`c8a6c8c8609caa590124144ce03dd9fb12570edcd15fb556a4b4c32dbb3eb60d`.
The external `tas20-de-import-receipt.json` and `root-import-review.json` retain
input options and evidence limits. All four questionnaire inputs are now
available for the local mock; production CLI import remains pending.
Retain raw supplied response codes;
instrument-scoring validation and public redistribution are not inferred from
the researcher's local-use authorization. A second Greifswald download returned
bot-challenge HTML, not a usable PDF, and must not become an input.
No fabricated translation or blank template may stand in for the instrument.

The researcher subsequently requested German TAS as a preconfigured Planner
asset in the integration task. The dated amendment in
[70](70-RESEARCH-PROVENANCE.md) allocates a local researcher-installed preset
to S2/main without granting public reusable-preload eligibility. This added
convenience does not replace the required production CLI authoring transcript
or change the requested experiment. Local source preparation remains complete.

Runner current-master runtime consumption and native execution gates require
fresh inspection by the Runner owner. Previous strict reader or legacy-package
tests do not prove this master can run. Add precise gaps and actual receipts as
they are established. The active goal is not complete until the requested
artifact and applicable execution comparisons pass; remaining input or platform
limits must be reported truthfully rather than silently reducing the objective.

### First setting-parity audit — 2026-09-12

Canonical remains `460f516`. Main's isolated CLI candidate is `178d453`, including
shared foundation `2310efc`; root independently ran its 13 focused session tests
successfully. They cover policy read/edit, invalid/stale/cancellation/lifetime
cases and truthful postcommit failure reporting. They do not establish native
CLI operation or all-segment UI parity. Owner worktrees remain in progress.

The audit changed these implementation actions:

- P2: typed graph/terminal-route ordering and before/after-session module edits
  lack direct current UI controls. S2 now owns a bounded UI follow-up using the
  existing questionnaire/language owners; main retains shared composition.
  A raw JSON import is not a substitute for these user-facing controls.
- P3: stable-ID row, variant and ISI reordering requires matching local table
  actions. S3 is implementing both through the same pure operation path.
  Exact internal draft/allocator/occurrence replacement is not a user setting:
  expose its snapshot read-only in the CLI, retaining strict internal Open and
  recovery restoration without a new raw-identity editor.
- P5: disabled legacy geometry/digital-step values are retained compatibility
  data under V2, not active controls. Their CLI writability must match the UI:
  read-only under V2, with exact round-trip preservation. P4/P6 geometry and V2
  response remain authoritative. Do not add a redundant compatibility editor.

All other active authoring fields still require both-way CLI/UI coverage. These
decisions do not permit removing an active capability merely to avoid a missing
UI implementation. Registry metadata, tests of pure adapters, native operations
and actual UI behavior remain distinct evidence layers.

### File-writer review and execution gate — 2026-09-12

S7 handed off `f5c0547deaf76d7d0178cb3677b6f8a8d4c29d69` from its clean isolated
worktree. Root independently reran the nine focused filename/file JS checks:
all passed. Four inspected disk-backed browser-fixture exports share SHA-256
`09dfedfee8309e4813fb3383bbdc7f6326d1be30bee55f2bd14fef89f1a0d948`.
Chrome and Edge receipts each contain 65 passed checks; all 196 recorded source
hash comparisons match the frozen S7 worktree. Receipts are under
`D:/GitHub/.affect-checks/p7-cli-file-versions-{chrome,edge}/`.
Their explicit synthetic-media/disk-picker limitation remains: these files are
not the requested CLI-created experiment or evidence of native execution.
The new native writer requires hard-link support; browser preflight prevents
ordinary nonempty replacement but does not prove atomic multi-writer exclusion.

Runner's isolated master-consumer baseline is `3301440`. Root confirmed the
reported current blocker in `research_native_media/capability.rs`: qualified
Start, format-matrix and redistribution readiness are false, and actor readiness
does not enable Start. The corresponding missing installed/bootstrap, source/
redistribution closure, format and lifecycle evidence is recorded in30/40.
The Live Preview task now owns a read-only qualification-gap audit; Runner keeps
implementing complete master consumers. No flag change, weaker playback path or
mock is authorized as a substitute for passing the existing execution gates.

### Independent production CLI driver

Root owns `scripts/qualification/planner-cli-driver.mjs`, separate from main's
first-slice `planner-cli-smoke.mjs`. It launches only the explicit CLI executable
with `jsonl`, captures its hidden-process ready receipt, supplies fresh request
IDs and current revisions, sends actions sequentially, checks matching responses,
and drains EOF. It records the executable hash, synced command/response transcript,
bounded stderr, exit outcome and a receipt in a newly created evidence directory.
Unexpected identity, duplicate output, malformed output, command rejection or
timeout stops the driver without retrying writes. It has no editor imports or
recipe compiler and cannot claim UI/Runner behavior from transport success.

Usage: `node scripts/qualification/planner-cli-driver.mjs <CLI.exe> <actions.json> <new-evidence-directory>`.
The action file contains an array of `{action, expectStatus?, mutation?}` steps;
the production CLI validates each unchanged action. Known query kinds use null
revision; edits use the latest returned revision. Expected rejection cases can
be explicit. Six isolated synthetic subprocess checks passed for transcript/CAS/
EOF, wrong session, duplicate output, rejection, invalid UTF-8 and timeout.
Those tests validate the driver itself, not a production Planner run. The initial
5-second fixture startup allowance expired under concurrent build load; the
successful checks use 30 seconds and assert each distinct expected failure.

### First independently verified production CLI milestone

Main's clean source `680842aee1e01e0c75500c64250dba10130e0663` produced CLI
executable SHA-256
`0150d36d0c5bbdc91439e15ad29c78c0553bfbb1fd9be3564d3cc5b336672e8c`.
Root's external driver launched it, verified the exact clean ready identity,
ran eight commands and exited successfully. The batch set nine P7 policy fields;
root independently compared every readback value, confirmed unchanged read-only
playback, and checked that invalid numeric text and read-only edits rejected
without advancing revision. Final authored revision was1; owned PID26704 exited.
Evidence: `D:/GitHub/.affect-checks/root-cli-policy-680842a/` contains the driver
receipt, synced transcript and independent `readback-review.json`. Transcript
SHA-256:
`2b3f0ff9ccac74c6582a1c97fc91c72bae63b1ee0a655b8dc67b2e01c564f72a`.

Main separately verified empty EOF, malformed-input recovery and fatal oversized
frame exit2 after fixing a Windows/Tauri error-exit bug. Its receipts are under
`D:/GitHub/.affect-preview-checks/planner-cli-{680842a,lifecycle-680842a}/`.
This establishes actual native hidden Planner policy command execution. It does
not establish all-segment integration, real media import, final recipe export,
visible UI parity or Runner execution. Main may now rebuild the candidate to
integrate the ready owner handoffs and consequential file/media operations.

### All seven owners through the actual native CLI

Clean source `23e8f3a3671f87e7e73dbfd422847479fd5e5fa7` produced executable
SHA-256 `0e10f50d8f364e7e00a9f22f928b4064247d31ffb373fcbea4cd4774d60d138d`.
Root's production-process driver captured 155 settings and 32 owner operations,
queried all seven real app owners, applied a seven-owner draft batch and verified
readback. P2 deliberately retained the actual selected language list; P3 added a
1750 ms named interval. P1/P4/P5/P6/P7 values were read back from the same session.
Invalid numeric/read-only commands rejected without changing revision. Eight
commands completed, revision 0 → 1, owned PID 16768 exited 0.

Evidence: `D:/GitHub/.affect-checks/root-cli-all-owner-23e8f3a/` contains the
exact `catalogue.json`, initial snapshot, driver receipt, transcript and root
readback review. Transcript SHA-256:
`a8e6cb03403a7c3241a964e4a2452bec0dde3136a02982124e2492a1af82db39`.
The external action script is retained alongside that directory. This proves
actual registered native command/readback behavior; it imports no media or
questionnaire files, exports no master and observes no participant execution.
The public About catalogue can use this exact captured descriptor set as a
verification reference. Explicit presentation-target authoring was found missing
from this catalogue and is allocated to S7 before final export integration.

### Actual native clip diagnostic and corrected next action

Live Preview's isolated diagnostic checkpoint is `dffe166`; its first completed
real-runtime attempt used a test-only copied executable with the required
Common Controls manifest. The prepared artifact SHA-256 is
`6a6ec53bf5da70aba680bef7736fc54d0efd9cf3754d20af90a4217ec1f14904`.
Root independently verified that artifact and inspected
`D:/GitHub/.affect-native-diagnostic-build/attempt-02/` receipts and stdout.
The exact Great Dictator clip decoded three sampled positions, reported
1920×1080 and 254406 ms, and exercised Play/Pause/Resume/Stop/new generation and
actor-thread exit before parent exit. This native duration differs by1ms from
the preliminary ffprobe description; the final recipe must use its actual P1
import receipt, not a hard-coded preliminary duration.

Although the test process exited successfully, all five inspected Paused/Playing
snapshots retained `gstreamer-media-info-incomplete`. Root classified this as a
defect-reproducing engineering diagnostic, not clean playback or qualification;
see its `root-review.json`. Incomplete initial MediaInfo had become Failed,
then subsequent backend states overwrote that failure. S1's initial terminal
latch `9a68e7c` would expose this startup failure, so main must wait for its
corrective follow-up. S1 owns partial metadata readiness versus genuine terminal
failure in `state.rs`; Live Preview owns the actual combined-candidate rerun.
Installed bootstrap, source closure, lifecycle and physical acceptance gates
remain distinct. No Start capability flag has been enabled by this diagnostic.

Root also validated the four real questionnaire source files together through
the production importer and contribution validator. Both language routes cover
MAIA-2 then TAS-20, 37+20 items, beforeSession. The external
`root-bilingual-source-preflight.json` in the TAS source evidence directory
records the import identities and explicit source-only limitation; no master
JSON or production CLI session was created by that preflight.

### Later integration prerequisites and independent review — 2026-09-12

Root's consequential coordinator is clean `e511931`, parent `23e8f3a`; Main
collected it as `5039344`. It adds guarded prepare/dispatch/adopt, late-effect
receipts, separate public descriptors and exact retry bounds. The final root
all-owner gate passed 152 tests, including 30 new cases. S4 reproduced an
owner-only drift omission in the dispatch-facing guard; the fix and regression
are included. Main owns real operation registration and request/grant binding.
These tests create no experiment file. See `docs/planner-authoring-consequences.md`
after integration for the complete owner protocol.

Main's corrected embedded CLI `e439018b81a5eea26b72551d651eadc7669471cd`,
executable SHA `eb8f896d08bbd76f723437a05d76b976ac3a7aec99b2fb186cf62c9f43517b6b`,
passed two fresh-profile local-preset readback sessions. The second captured
156 settings/32 internal operations, read the actual installed German TAS
through native IPC/production importer, rejected a read-only write and preserved
revision zero before exit zero. Root inspected the receipt's exact source/
definition hashes and owned WebView parent/profile. Evidence directory:
`D:/GitHub/.affect-checks/local-preset-main-20260912/native-readback-e439018-second-session/`;
transcript SHA `4191f1550bd277f0627d337c1ef18ded59f4f64de20853b1694952914adb0ea4`.
This proves installed-source reading, not study-source saving or mock export.

Failed intervening `6098972`/`827ad87` attempts exposed profile-construction and
embedded-build gaps. The corrected builder explicitly sets its owned WebView
profile and the CLI rejects development mode; `tauri/custom-protocol` is required.
Earlier `680842a`/`23e8f3a` transcripts retain their observed command exchanges,
but retrospective embedded-asset/profile-isolation claims require their actual
build/launch evidence. A ready commit string alone does not establish them.
Do not infer that older binaries share the newer missing-feature defect without
that audit. Final catalogue/mock verification must use the corrected workflow.

The actual clip diagnostic now passes at `c87bd95`, prepared executable SHA
`c9c7d7c71413e3ed81e13916ba434c9b6ce65925975d0bf6db476460f030b5c4`.
Root read all attempt06 stdout and its process receipt: three decoded positions,
254406 ms/1920×1080 metadata, all five Paused/Playing snapshots with null reason,
stop/new generation/stale rejection, and actual actor exit/join before hidden
parent exit. Earlier failed receipts remain. This closes that partial-metadata
diagnostic; complete playback, installed/runtime and composed Start gates remain.

Runner checkpoint `388399e` now records exact recipe, definitions and answers in
the primary information stream. Root independently read XDF02 using pyxdf 1.17.0
and separate Python, with no production reconstruction/compiler imports or
producer JSON. Verified: 78 frames/26 transfers, chunk/base64/length/order/hash,
exact embedded source, P1–P6/policy, both definitions and complete answer records,
all ten ordered occurrence pairs, raw clocks and both XDF footers. XDF SHA:
`9f545514672115d0ac50a82946d31b1123f8a0268b1d8b6fdc4c26a45910d865`.
Independent script/report in `D:/GitHub/.affect-runner-master-build/`:
`root-review-information-xdf-02.py`, `root-independent-information-xdf-02-review.json`.

This remains synthetic: 0.0118323 seconds of actual LSL time carries 51158 ms of
synthetic observations, legacy coded demographics and a dirty development build.
It is not the requested mock, new typed demographics, actual timing or full
Runner qualification. S3 owns typed authoring/assets, S4 its Rust validator,
Main master composition, and Runner typed answers/panels. All E2E rows remain open.

### Production-only mock driver prepared

`scripts/qualification/planner-mock-experiment.mjs` now expresses the requested
complete authoring flow using only production CLI commands. It verifies source
and executable hashes; uses actual returned video/ISI/occurrence/module IDs;
adds shipped demographics before MAIA-2/TAS-20 in each language; authors
1750 ms → clip → 3213 ms; confirms P1/P2/P3/P4/P6; lets final Save capture P5;
then saves, reopens, edits participant count to two and saves another version.
It compares exact files against native receipts and all authored semantics,
allowing only the intended count edit and named derived integrity/revision
changes between versions. It imports no editor/compiler and writes no master.

S5's read-only review found missing full semantic comparisons and missing final
executable-hash comparison; both are fixed. Ten focused transport/comparison
checks passed, including thirteen corruption/reordering counterexamples.
Syntax and diff checks passed. These checks do not author a real recipe. The
script awaits the combined native core9/typed-P2/master-v2 executable; all
actual CLI import/export, editable reopen and Runner/XDF goal gates remain open.

### 2026-09-13 — Root serial validation result

The real CLI mock now passes all 55 steps, timestamped save/reopen/edit/resave,
and first-file preservation. The exact 77,746-byte JSON also passes both native
and browser Runner readers for English and German, including all six steps and
saved P4/P5 geometry. See [the concise release validation record](../docs/release-validation.md)
for exact files, source/artifact hashes and evidence. Root remains sole owner;
other tasks stay idle. Planner validation is passed for this scenario. Actual
Runner playback, native combined screenshots and XDF remain open, with qualified
Start still disabled. Continue at the native Runner gate; do not repeat the
passed Planner scenario unless a relevant change invalidates it.
