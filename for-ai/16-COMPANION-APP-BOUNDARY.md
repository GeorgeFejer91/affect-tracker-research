# Planner and Runner companion programs

## User amendment — 2026-09-12

The researcher explicitly requires **two separate programs**. This supersedes
earlier statements that Setup/Run are only modes in one executable and that all
Runner implementation is deferred. It does not waive any qualification gate.
The charter adopts this boundary. Planner remains independently completable;
final Planner–Runner execution correspondence is the last development stage,
not a prerequisite for truthful Planner JSON generation.

**Experiment Planner** authors the experiment and generates one comprehensive,
versioned JSON recipe. It retains Flubber/Grid previews, binding tests, language
and questionnaire previews, and screen/spatial authoring previews. These are
authoring tools, never participant acquisition or recorded experiment runs.

**Experiment Runner** is a separate desktop companion with its own entry point,
window, application identity and native command surface. It opens Planner JSON,
validates it, binds actual media, prepares a participant/session and executes the
specified video order, intervals, questionnaires, feedback, layout and input.
It owns actual timing, acquisition, playback, LSL transport, run records,
recovery and stream recording. Desktop Windows is the present implementation
target. XR and phone/browser controllers are separate future allocations.

The user clarified: **“the stream recording policy is owned by the runner!”**
The requested recorder captures **own and selected external LSL streams to XDF**.
Stream discovery, selection, recording destination, start/stop and connection
failure policy are Runner session choices, saved with run evidence. They are not
missing Planner fields and must not be added to the Planner recipe by inference.
Planner still owns authored LSL emission configuration/expected marker meaning;
Runner owns the actual outlets, inlet selection, timestamps and recorded files.

## Ownership and sharing

| Concern | Planner | Runner | Shared seam |
| --- | --- | --- | --- |
| Study/media | Author identity, verified declarations | Authorize actual media root and verify all declared files | Versioned identity/path/hash/length/duration/geometry contract |
| Order | Exact variants, named ISIs, occurrences and expected events | Participant allocation and frozen selection; execute exact order | Recipe definitions and selected-version run receipt |
| Feedback/input | Saved bindings, style/mappings; transient Flubber preview | Apply saved bindings/feedback to acquired state | Pure validators, renderer mathematics, explicitly versioned settings |
| Layout | Declare screen reference, units, placement/fit, optional target | Validate actual screen capability and render exact layout | Complete typed profile; unsupported semantics reject |
| Questionnaires | Full definitions, labels/codes, routes and placements | Participant route choice, presentation, durable answers | Complete language/definition/protocol contracts |
| LSL output | Authored stream metadata and expected event contract | Emit actual samples/markers | Frozen outbound contract; never invent timestamps in Planner |
| Stream recording | No recording policy or inlet selection | Own and selected external streams, XDF, failure/recovery | Runner session recording receipt, not Planner JSON |
| Persistence | Named recipe save and editable reopen | Immutable recipe copy, attempts, journals, data and recovery | Preserve exact recipe hash/bytes in run evidence |

Sharing pure contract code and rendering math does not combine the applications.
Runner must not import Planner editors, contribution registries or mutable setup
state. Planner must not instantiate an acquisition scheduler, participant player,
outlet or recorder. Native command registration and service construction enforce
this split, not merely hidden buttons. Preview decoding/metadata inspection can
use a narrow media-inspection service; it grants no participant-run authority.

## Recipe handoff and progress claims

P7 owns the complete recipe writer/readers. Do not create a competing Runner
recipe schema or interpret standalone P1–P6 contributions as a finished recipe.
Use strict schema/version dispatch, exact full readers and native validation;
no field picking, defaults from Planner memory, silent downgrade or partial
execution. Versioned successor formats preserve the existing v1 reader.

Each saved run-affecting option needs an explicit field and consumer behavior.
Transient preview position/input, editor state and unapproved simulator drafts
remain outside execution authority. The distinction must be visible and tested;
an implementation gap must not be relabelled as preview-only to omit it.
See [66-PLANNER-RUNNER-COMPATIBILITY.md](66-PLANNER-RUNNER-COMPATIBILITY.md).

The Planner may complete its strict authoring, comprehensive JSON, save/reopen
and independent reconstruction checks while Runner execution is still being
built. Runtime correspondence is assessed later against the exact saved recipe
and capabilities. Reading a valid file is not evidence that its experiment ran.
Native playback remains blocked where its qualification evidence is incomplete.

Runner-only agents use [65-RUNNER-SEGMENTS.md](65-RUNNER-SEGMENTS.md) for allocation,
interfaces and evidence. Planner P1–P7 retain their owners and catalogue. Shared
changes name exact seams in the message board; consult the **Chat Orchestrator**
task when ownership or a product decision is uncertain. Neither ledger overrides
the researcher. No independent agent may silently merge the integration checkout.
