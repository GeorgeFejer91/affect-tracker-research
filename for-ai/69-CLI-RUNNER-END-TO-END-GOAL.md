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

The English TAS-20 retained source is marked as requiring an authorized copy,
and the German TAS-20 source is absent. The source-path question is pending.
Continue independent implementation/testing; leave the requested bilingual
artifact incomplete until those inputs are resolved. No fabricated translation
or blank template may stand in for the requested instrument.

Runner current-master runtime consumption and native execution gates require
fresh inspection by the Runner owner. Previous strict reader or legacy-package
tests do not prove this master can run. Add precise gaps and actual receipts as
they are established. The active goal is not complete until the requested
artifact and applicable execution comparisons pass; remaining input or platform
limits must be reported truthfully rather than silently reducing the objective.
