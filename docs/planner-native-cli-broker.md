# Native Planner CLI broker

This is the native binding for the existing Planner authoring session. It is
enabled only by the dedicated inherited-stdin/stdout CLI executable and its
owned hidden Planner window. It does not attach to a user's open Planner,
create a listener, compile an alternate recipe, or add settings absent from
the authoring catalogue. Main owns final app composition and registration.

The nine public `perform` operations retain their existing JSONL argument shapes:

| Operation | Arguments | Native effect |
| --- | --- | --- |
| `selectWorkspace` | `directory` | Existing workspace selection |
| `importVideos` | `paths` | Existing selected-workspace file import |
| `importVideoFolder` | `directory` | Existing selected-workspace folder import |
| `rescanVideoLibrary` | none | Existing catalogue scan; no decode attestation |
| `importQuestionnaire` | `path`, `familyId`, `language` | Bounded source snapshot |
| `saveQuestionnaire` | `questionnaireId` | Exact authoring source storage |
| `confirmSegment` | `segment` P1–P6 | Frontend owner confirmation; no filesystem call |
| `saveRecipe` | `directory` | Strict supported master, timestamped new file |
| `openRecipe` | `path` | Strict supported master snapshot |

P5 confirmation remains the frontend `final_capture` instruction: the final
save captures and publishes the live feedback snapshot. This broker does not
pretend P5 was accepted separately or maintain a second owner state.

Every consequential command requires `expectedRevision`. Native hashes the
complete canonical original command before replacing its path strings with
one-use, purpose-bound UUID grants. For a paths array, one forwarded UUID owns
the complete original selection. Family, language and questionnaire IDs remain
unchanged. Native paths never enter renderer DTOs, command results or logs.
Exact public retries reuse the same forwarded request; reusing an ID with
different original content rejects before another effect can run.

## Internal IPC for Main

Register the existing `research_planner_cli_io` and
`research_planner_cli_effects` modules, then these commands alongside the
existing authoring ready/next/complete commands:

```js
invoke("research_planner_authoring_revision", {
  request: { sessionId, revision }
});
invoke("research_planner_authoring_effect", {
  request: {
    context: { sessionId, requestId, expectedRevision },
    action: { type, /* exactly the fields below */ }
  }
});
```

| Native action | Exact additional fields |
| --- | --- |
| `selectWorkspace` | `grantId` |
| `importVideos`, `importVideoFolder` | `grantId`, `workspaceId` |
| `rescanVideoLibrary` | `workspaceId` |
| `readQuestionnaire`, `readRecipe` | `grantId` |
| `storeQuestionnaire` | `workspaceId`, `questionnaireId`, `familyId`, `languageTag`, `format`, `sourceSha256`, `bytesHex` |
| `writeRecipe` | `grantId`, `sourceText` |

Both commands require the `research` window, Planner executable role and an
enabled CLI broker. Revision notices must be from the same owned session;
delayed notices never lower the native revision. The pending request retains
its original expected revision throughout preparation, I/O and publication.

The result has exactly `schema`, `version`, `operation`, `effect`, `payload`,
`error`, and `superseded`. Schema is
`affect-research-planner-native-result`, version 1. `operation` is the original
public perform name: `readQuestionnaire` returns `importQuestionnaire`,
`storeQuestionnaire` returns `saveQuestionnaire`, `writeRecipe` returns
`saveRecipe`, and `readRecipe` returns `openRecipe`.

`payload` is the existing workspace/import/source/storage receipt. A recipe
write returns `{basename, receipt}` with the real UTC timestamped basename and
exact source receipt. A recipe read returns
`{sourceText, sourceSha256, byteLength}`. No publication acknowledgement is
inferred from a missing response. The frontend must record `effect` before
checking error, cancellation or supersession, then publish owner state only
while its original command remains current.

`effect` retains the actual known acknowledgement or failure class separately
from bulk data. It includes operation/request identity, stage, outcome and
`possiblyChanged`. Successful effects retain a compact `receipt`; video scan
receipts retain workspace identity, count and digest instead of duplicating
the library. Outcomes distinguish `notInvoked`, `notPublished`,
`possiblyChanged`, `publishedUnverified`, and `acknowledged`. A completed file
is never relabelled uninvoked because a later revision or cancellation arrived.

## Lifetime, retries and limits

The broker reserves one native-effect lease until the original command
completes its frontend publication, not merely until the service call returns.
Grant claims and native I/O run outside the broker state lock. Cancellation is
recorded on native stdin admission before the frontend receives it and revokes
available selections. Four work slots plus one reserved cancellation slot
prevent a saturated work queue from excluding the cancellation control itself.
The output channel has five bounded slots.

Native action content is fingerprinted independently of the original public
command. An exact RPC retry while its original command is pending returns the
retained bulk result; an in-flight call rejects as in flight. After command
completion only the compact effect remains, with `effect_already_completed`;
the original command receipt must be reconciled. A changed RPC never repeats
an effect under an existing identity. No timed retry evicts retained identities.

There are at most 1,024 retained mutation identities and 8 MiB of compact
retention, with 64 KiB reserved for a native acknowledgement before dispatch.
Pending native result payload capacity is reserved before I/O, capped at
32 MiB overall. The entire encoded IPC envelope, including JSON escaping or
hex expansion, must fit 16 MiB before a write may be invoked. A raw 16 MiB
source is therefore not a guarantee of transport eligibility. Source reads
retain the grant helper's 4 MiB input limit; source stores retain the workspace
service's 5 MiB limit. Grant/path limits remain those of the existing helper.
An oversized read/result loses bulk delivery and returns `native_result_limit`
while preserving its compact actual effect. Native work does not accept
another mutation when receipt retention has no capacity.

Known and still-unknown effects remain in this broker instance on shutdown or
output failure. This is not a disk recovery journal. Process death or lost
transport acknowledgement can leave an unknown outcome that requires checking
the actual workspace/output files; starting another process cannot prove that
the previous effect did not occur.

## Verification scope

`planner_authoring_native` compiles the actual broker, strict readers, grant
helper, workspace service and native effect helper. The tests use temporary
directories, synthetic storage-only media/source text and the existing typed
master fixture. They cover actual byte/receipt preservation, exact retries,
purpose/identity/revision checks, cancellation saturation, pending-effect
leases, malformed/oversized requests, capacity, and late saved-file outcomes.
They do not create the user's mock, prove playable media, run participant
panels, qualify the final executable or verify an XDF experiment.

The isolated owner branch requires Main's two module declarations for Cargo's
production-library dependency. Those two test-composition lines are recorded
separately and excluded from the owner commit. Main must register both modules
and both IPC commands in the integrated app; no test harness substitutes for
the final production build and CLI-to-UI validation.
