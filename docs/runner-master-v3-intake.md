# Runner master3 intake

R1 RR-02/RR-03/RR-04/RR-07/RR-10, root/Main allocation dated2026-09-12.
Controlled asset proofs are retained intact; no catalogue3 downgrade occurs.

## Frozen version matrix

| Surface | Master1 | Master2 | Master3 |
| --- | --- | --- | --- |
| Recipe / owner selection | 1 /1 | 2 /2 | 3 /3 |
| Reproduction algorithm | Frozen owner version | planner-recipe-reproduction-v3 | planner-recipe-reproduction-v4 |
| Runner plan algorithm | master-sequence-v1 | master-sequence-v2 | master-sequence-v3 |
| Plan, preflight, attempt, status, startup | 1 | 2 | 3 |
| Start command | research_runner_master_start | research_runner_master_start_v2 | research_runner_master_start_v3 |
| Start request version | Legacy unversioned coded participant | 2, participantId only | 3, participantId only |
| Action command | research_runner_master_action | research_runner_master_action_v2 | research_runner_master_action_v3 |
| Action arguments | runId/action | runId/tagged action | request:{version:3,runId,action} |
| Answer record and responses filename version | 1 | 2 | 2 |
| Profile/sample/marker/event/outcome/information frame | 1 | 1 | 1 |

Start3 request has exactly version, workspaceId, sourceText, participantId,
selector, rerunConfirmed and inputTestReceiptId. Its tagged action payload shares
MasterActionV2 meaning (Presented/Draft/Submit/Pause/Resume/Stop); request3 adds an
explicit outer version and runId. Old command gates stay exact. Main owns additive
lib handler registration. Startup3 embeds exactly recipe3 and reconstructs selection3;
its response records must be2, never3. Demographics remain ordinary mandatory
forms, not legacy coded participant preparation. No new timing/reset marker data.

## Native media seam

For wholly controlled master3 catalogues, Runner freshly rescans and uses the
native owner's attestNativeGstCatalogueV2 / NativeMediaController.attestDecodeV2 /
research_native_media_attest_decode_v2. Wholly historical catalogues retain
attest1; mixed historical/controlled catalogues fail before media side effects.
Each bounded attestation loop stops its generation. S1's
validate_runner_video_catalogue_v3 binds the current library to full cached
receipt2/control proof (or exact historical proof), content, location, duration
and fences. Runner retains the complete typed binding through media preparation;
it never converts catalogue3 to2. Current playback qualification, input receipt
and exact fullscreen gates still apply.

Root explicitly rejected duplicating the native opaque-ID hash algorithm.
Fresh RescanResult currently exposes workspaceId and stimuli with workspaceFileId,
displayName (basename), sha256, byteLength, mimeType, null duration/source/geometry
and unverified decode status. It does not expose a unique relative-location map.
No fabricated IDs, geometry or dimensions-only native binding were introduced.

### Pending mapping proposal (not implemented)

S1 owns a potential versioned read-only native descriptor response, scoped to the
selected workspace and a native-owned scan generation. Proposed envelope:
schema/version1, workspaceId, scanGeneration and entries containing
workspaceFileId, sourceRelativePath, sha256, byteLength and mimeType. Each entry
would come from the same native scan cache, never from client-supplied IDs.
Runner master-media would require an exact unique location/content set before
choosing attest1/2 per entry. The owner must specify stale-generation rejection
at use, including rescan/workspace-change invalidation. It grants no path or media
permission and does not replace final proof validation. Root/S1 allocation and
contract review are required; mixed master3 runtime remains rejected meanwhile.

## Component handoff evidence

Owner dependencies staged separately: e6f9aa2 is the exact e3df95d..9f2dc75 delta
excluding the message board; earlier dependency commits f3856a6 and1f3e54d retain
Main master3 readers/fixtures. Main owns additive lib handler registration for
Start3, action3 and owner attest2; this Runner-only commit does not edit lib.rs.

- 22 focused Node tests pass, including exact version gates, information3 with
  response2, mandatory empty-answer rejection and attestation routing/failure.
- Eight actual-app headless Chrome cases pass350 checks (EN/DE form, flow, Stop,
  disposal), using synthetic native responses and no physical video.
- Native library test compilation passes; copied diagnostic artifact passes
  26 master, 6 session and37 workspace/contribution tests. Six native master3
  plans exactly match independent JS reconstruction. No ignored tests in these
  focused selections. Eight compile warnings are unregistered owner/Runner
  commands and optional native media code; Main owns final registration.
- Runner production build and separated asset boundary pass (11 files,
  64 dependency inputs). Rust formatting and diff checks pass.

Receipts under D:/GitHub/.affect-runner-master-build/: runner-v3-node-04.log,
runner-v3-build-02.log, runner-app-v3-ui-04/, runner-v3-native-05-build.log and
runner-v3-native-05/{artifact-receipt.json,master-tests.log,session-tests.log,
workspace-tests.log,plans.json}. The existing prepare-actor-diagnostic.ps1 copied
and embedded the CommonControls6 test manifest; original Cargo binary unchanged.

Mandatory questionnaire behavior is shared by plan2/3: a participant cannot
submit a blank or incomplete form, irrespective of older optional metadata;
explicit prefer-not-to-say remains a valid answer when offered. Native worker
EN/DE tests cover rejection and successful typed submission. Responses remain2.

No actual run, native video, XDF or physical timing is claimed by these tests.
Main/root retain integration, all-controlled native smoke and release gates.
