# Desktop master execution contract

Runner owns these new contracts. They do not widen frozen ExperimentPackageV1,
legacy run manifests or the old semantic-code LSL marker API. Complete intake is
implemented separately from worker execution and platform qualification.

`affect-runner-master-plan` v1, algorithm `master-sequence-v1`, binds exact source
bytes, an explicit canonical P001-style participant number, and P7's complete
variant/language/path/target selector. The plan identity hashes those values;
raw derived geometry is not a portable hash input. The complete P7 selected
projection is retained. All beforeSession forms precede the exact P3 entries,
including leading/consecutive/zero/final ISIs and repeated videos; afterSession
forms follow. P3 occurrence IDs remain unchanged. Forms receive `form-N`, where
N is their one-based complete sequence position; their original full module,
definition and presentation remain in the step payload. P3's accepted entry IDs
are variant-prefixed, so these form codes cannot collide. A participant count is
metadata, never an allocator. No route or variant is selected by default.

The initial master marker sample is `affect-runner-master-stream-profile` v1.
Its exact fields are schema, version, recipeSourceByteSha256, planIdentitySha256,
participantId, selector, runId, attemptId, plannedProfile, executionProfile and
profileSha256. The last hashes the canonical object with that field omitted.
The original P3 plannedProfile is unchanged. executionProfile has P3's exact
five-field shape, with ordered form occurrences added and `form-source-N`
codebook entries of kind `form`, the full definition hash and null duration.
No prompts, filenames, names or demographics are added to observations.
Run/attempt/execution codes have alphabetic prefixes and fresh UUIDs.

Subsequent samples use the existing explicit `affect-research-marker` v1 envelope
and vocabulary. Their monotonicMs denotes a native observed lifecycle boundary;
planned offsets and durations never stand in for actual onset/end. Actual LSL
push timestamps stay on the LSL samples and in recorded event evidence. State
stream channel identities, formats, units and participant name prefixes are
preserved. Master markers use a separate adapter; old marker validation remains
unchanged. Profiles are bounded to 4 MiB and observations to 2048 UTF-8 bytes.
Oversized profiles reject before acquisition. The selected own recorder attaches
before the profile is published. A subscriber missing the initial profile has
incomplete evidence; it must not infer or repair the dictionary. XML metadata
extension is not required, and the pinned transport dependency is unchanged.

Output identity uses the full exact-source SHA-256 under `outputs/recipe-HASH/`.
The immutable master is retained as `experiment.master.json`; per-JSON participant
selection and Runner-owned XDF recordings share that root. Master run records use
distinct versioned filenames and schemas, never legacy manifest extensions:
`master-attempt.v1.json`, `master-plan.v1.json`, four `master-*.v1.jsonl` files for
events/samples/responses/diagnostics, selected CSV/TSV sample tables, and an
immutable final `master-result.v1.json` containing artifact hashes. An unfinished
attempt remains used; starting another requires explicit rerun confirmation.
Master resume/finalize-only recovery is not implemented and is visibly disabled.

P4 requires the authored exact fullscreen CSS viewport and fixed reference box;
it does not permit fitting an experiment into a differently sized window. P5's
complete response owns grid steps, full-span continuous holds, separate/repeated
presses and absolute-position snapping. Native OS repeat is ignored, opposing
holds cancel, and overdue repeat polling reports missed repeats without a burst.
P2 label repetition creates consecutive table groups, not pages; different visible
answer labels immediately begin a new group. Required responses and explicit
nullable recorded codes retain P2's meanings.

The native worker requires actual qualified GstPlay, fresh exact P1 media
bindings, an exact fullscreen viewport, a native input-test receipt and idle
shared services. The renderer acknowledges a painted occurrence before its
native form/ISI transition or video preparation. Only native observed Playing
enables acquisition. One poll emits at most one sample; missed deadlines are
recorded. Native input is withdrawn before pause, interruption and termination.
A companion lease prevents simultaneous legacy/master use of native services.
The integration owner must wire `MasterRuntime::shutdown/is_stopped/join_stopped`
into the coordinated window/actor teardown; this candidate does not replace the
shared close coordinator or approve pending native lifetime fixes.

This first master stream generation reconstructs the occurrence dictionary and
observations. It does not embed full definitions, demographics or answers.
The user's later self-contained XDF and typed demographics allocation requires
the separate bounded information protocol and P2 successor contract; do not use
this generation's synthetic recording receipt as evidence for that expansion.

Current software correspondence evidence is not an executed experiment. Start
remains subject to the separately verified native actor, input, media, storage,
stream and installed platform gates. The implementation ledger records progress
and outstanding seams without turning planned capabilities into success claims.
