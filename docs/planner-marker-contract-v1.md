# Planned marker contract v1

P3 authors ordered variant entries and the fixed
`affect-research-planned-markers` v1 specification. P7 embeds the accepted
contribution. The Runner chooses participant allocation and records actual
observations; this document does not implement or qualify recording or change
the existing LSL wire contract.

Every planned entry has a stable `entryId`, type (`video` or `isi`) and source
reference. Repeated source references retain separate entry IDs. A video uses
the verified catalogue duration, while an ISI uses its embedded definition.
Each entry derives distinct ordered start and end events. Equal planned times
do not merge boundaries; zero-duration ISIs still have two events. Missing
video duration blocks a numerical timeline estimate. Planned offsets are not
timestamps or measured visible onset.

The future stream carries one embedded profile for the chosen recipe and
variant: `recipeSha256`, `variantId`, `variantVersionSha256`, ordered
`entries[{entryId,sourceCode}]` and a complete
`codebook[{sourceCode,kind,identitySha256,durationMs}]`. Video identity is its
byte SHA-256; ISI identity binds its definition. Questionnaire source identity
binds the accepted definition and its response-dependent duration is explicitly
null. Questionnaire placement remains with the agreed P2/P3/P7 contract; the
current table does not guess form or block syntax. No external spreadsheet or
sidecar dictionary is required to interpret the embedded profile.

Each observation envelope has exactly these fields:

| Field | Meaning |
| --- | --- |
| `schema`, `version` | `affect-research-marker`, integer `1` |
| `recipeSha256`, `variantId`, `variantVersionSha256` | Exact frozen definition and variant |
| `runId`, `attemptId` | Bounded opaque execution context; no demographics |
| `sequence` | Safe positive integer, strictly increasing by one within a run |
| `eventType` | One of the fixed vocabulary below |
| `entryId` | Planned occurrence; explicit null for session boundaries |
| `executionId` | Distinct execution occurrence; restarted playback uses a fresh code |
| `sourceCode` | Opaque codebook reference; no filename, path or questionnaire text |
| `monotonicMs` | Finite nonnegative observation time from the owning Runner clock |

The vocabulary is `sessionStart`, `videoStart`, `videoEnd`, `isiStart`,
`isiEnd`, `formStart`, `formEnd`, `pause`, `resume`, `interruption`, `restart`,
`complete` and `partial`. Typed starts/ends bind the same entry, execution and
source. Pause/resume retain that occurrence. Interruption leaves its end unknown;
restart names the interrupted occurrence before a new execution starts the same
planned entry from the beginning. A new execution does not rewrite earlier
evidence. Completion requires all planned entries closed; an explicit partial
terminal does not assert completion.

The time denotes the Runner's observed lifecycle boundary. A Play request,
planned deadline, rendering frame or transport push time cannot be substituted.
Qualified visible onset, clock mapping, actual LSL metadata/emission, recording
format and recovery durability remain separate Runner decisions and evidence.

The pure synthetic-trace inspector reports sequence gaps/reordering, reversed
times, context mismatch, unpaired boundaries, reused execution identities,
unclosed occurrences, premature completion and missing terminals. It never
fills missing events or invents end times. Its source code and synthetic tests
are Planner specification evidence only, not recorded-stream qualification.
