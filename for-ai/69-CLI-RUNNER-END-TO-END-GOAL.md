# CLI → Planner JSON → Runner validation goal

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
S2 owns local import-file preparation and independent item/anchor verification;
production CLI import remains pending. Retain raw supplied response codes;
instrument-scoring validation and public redistribution are not inferred from
the researcher's local-use authorization. A second Greifswald download returned
bot-challenge HTML, not a usable PDF, and must not become an input.
No fabricated translation or blank template may stand in for the instrument.

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
