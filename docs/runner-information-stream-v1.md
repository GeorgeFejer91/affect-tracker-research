# Runner information stream v1

This Runner-only successor uses the existing participant-prefixed marker outlet;
the separate eight-channel affect outlet and frozen package marker API retain
their contracts. The user explicitly requested reconstruction from the saved XDF
alone, including full name and typed demographics from the new authored form.
Recording own/external streams remains a Runner session selection.

Each primary outlet sample is canonical UTF-8 JSON with exactly
`schema: "affect-runner-information"`, `version: 1`, `runId`, `attemptId`,
`recipeSourceByteSha256`, `sequence` and `payload`. Sequence starts at one and is
contiguous across every frame, including startup and answer transfers. Context
cannot change. Payload is one of these closed objects:

- Header: `kind: "header"`, `transferId`, `contentKind`, `byteLength`, `sha256`,
  `chunkCount`. Content kind is `startup`, `observation`, `responses` or `outcome`.
- Chunk: `kind: "chunk"`, `transferId`, zero-based contiguous `index`, `data`.
  Data is standard padded base64 for the exact next bytes.
- Commit: `kind: "commit"`, `transferId`, `sha256`.

One transfer is active at a time. IDs are fresh `transfer-<UUID>` codes. Transfer
data is canonical JSON; header and commit hashes bind its exact bytes. Raw chunks
are 64 KiB except the final remainder; no frame exceeds 128 KiB of UTF-8 JSON.
An assembled transfer is at most 64 MiB (1024 chunks), one assembler buffer is
allocated only after validating the header, and the stream has at most one
million frames. The native writer checks a 30-second transfer deadline before
and after each publication; failure permanently closes its information writer.
Foreign calls cannot be force-terminated; pending native teardown retains its
owner under the separate lifecycle contract. No timeout is a successful commit.

Startup is the first committed transfer and occurs exactly once. Its object is
`affect-runner-startup` v1 with `recipeSourceText`, `recipeSourceByteSha256`,
`planIdentitySha256`, `participantId`, `selector`, `markerProfile`, `effectiveLsl`,
`legacyCodedParticipant` and `build` (commit/appVersion). Canonical Planner source
bytes include all retained owner definitions, source provenance, language routes,
ordered variants, media identities/locations/hashes/durations, desktop layout,
feedback/input configuration and policy. The reader reconstructs the exact plan
using its declared algorithm, then compares its profile/selector/identities.
Video bytes are not embedded. Existing coded preparation data is retained only
for the old master preparation flow; the typed-form generation will use null and
its authored answer records, according to S2/main's explicit successor contract.

Observation transfers contain the existing complete typed P3 observation.
Responses contain the native `affect-runner-master-responses` record and later
the explicit typed P2 successor. Submitted/required items, options/codes, source
hashes, occurrence, participant and native latencies must validate against the
reconstructed frozen definition. A draft never substitutes for submission. The
user's completion rule requires every displayed item, including items whose
older authored metadata says optional.

Outcome is `affect-runner-outcome` v1 with `protocolOutcome` (`completed` or
`partial`), `completedStepCount`, `failureCode`, `monotonicMs`,
`localCheckpoint: "durable"`, and `recordingFinalization: "pending"`. It describes
the observed native protocol terminal state after the local checkpoint. The
XDF's actual footer/counts independently establish whether the recording closed;
the stream cannot claim its own future file finalization or contain its own hash.
A missing outcome/footer or interrupted transfer is incomplete evidence.

The recorder attaches before the first header; acquisition starts only after
the startup commit. Every frame keeps its actual LSL publication timestamp.
Each reconstructed record retains its first/header and commit LSL times, distinct
from the native monotonic observation contained in the payload. Missing frames,
duplicates, reordering, bad context/hash/base64/length, oversized input and invalid
typed responses reject or report incomplete; no consumer synthesizes missing
events or fills actual timing from planned offsets.

The incremental JS assembler retains one validated transfer at a time. Its
convenience reconstruction collector rejects more than 256 MiB of cumulative
decoded records; the independent pyxdf qualification command accepts XDF files
up to 512 MiB. These are explicit analysis-tool bounds, not additional wire
formats. Larger recordings require incremental analysis. Both readers preserve
raw LSL timestamps; no clock synchronization or sample dejittering is enabled.

Verification first reads only the XDF through an independent reader. The source,
plan, selected definitions, responses, ordered observed occurrences and terminal
state are reconstructed before comparison with any external producer JSON or
native observation log. Synthetic outlet/recording checks prove engineering
correspondence only; they do not establish the actual full-video smoke or native
qualification.
