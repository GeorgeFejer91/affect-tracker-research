# P3 contribution and catalogue interface

P3 owns the named ISI dictionary, ordered variant entries and occurrence IDs,
variant version hashes, planned video/ISI boundaries and marker specification.
Participant selection/allocation belongs to the Runner. P7 owns the final master
recipe, session acceptance, save acknowledgement and dependency-ordered reopen.

The accepted payload is `affect-research-variant-design` version 1, validated by
`validateVariantDesign(contribution, library)` in
[`variant-design.js`](../site/src/research/variant-design.js). The optional
editable sidecar is `affect-research-stimulus-order` version 2. Historical version
1 sidecars retain their numeric-ISI reader and require explicit conversion.
Reopening a master recipe requires only its canonical P3 payload and P1 payload;
it does not require an authoring sidecar or write a file.

## Public controller methods

| Method | Contract |
| --- | --- |
| `getStimulusOrderSnapshot()` | Exactly `{revision, enabled, pending, contribution, dependencyRevisions}`; dependencies contain the actual P1 **snapshot** revision. |
| `setStimulusOrderCatalogue(P1snapshot)` | Async. Accepts the registered **workspace composite** snapshot. Immediately withdraws P3 preparation on a changed, pending, unavailable or invalid producer; validates/projects its content before exposing catalogue timing. |
| `validateStimulusVariantContribution(contribution, {dependencies})` | Async. `dependencies.P1` is the exact five-key current P1 snapshot. Returns `true` or throws after domain, identity and duration validation. Use as P7's owner validator. |
| `restoreStimulusVariantContribution(contribution, {isCurrent, dependencies})` | Async ready-media path. Validates and projects `dependencies.P1`, validates the full P3 payload, and checks the caller's `isCurrent()` plus editor/restore generations before one atomic commit. Returns the final five-key snapshot. P7 must await it. |
| `restoreStimulusVariantContent(contribution, {savedWorkspaceContribution, dependencies, isCurrent})` | Async content-only path. Validates the saved P1 workspace payload and P3 declarations, then restores the editable table/dictionary while publishing `pending:true`, `contribution:null` and the actual current `dependencies.P1.revision`. No media readiness, filesystem permission, sidecar write or acceptance is inferred from saved content. |
| `prepareStimulusVariantContribution({isCurrent?})` | Async. Validates the current table and bound P1 durations, checks generation and optional caller guard, then returns the final five-key prepared P3 snapshot. No sidecar or storage write. Invalid, stale or cancelled preparation rejects and must not advance shared confirmation. |
| `confirmStimulusOrder()` | Explicit legacy workspace compatibility: saves the named-ISI authoring document through the existing storage receipt boundary. The final master flow uses preparation followed by P7 acceptance instead. |

The old `restoreStimulusOrder(document, receipt)` and
`restoreStimulusVariantContribution(contribution, receipt)` overloads accept
`{library, catalogue?, isCurrent?}` for component/legacy workspace consumers.
`catalogue` is the explicit P3 projection with its actual owner revision. A
library-only restore cannot invent a P1 revision; it returns no P1 dependency and
does not satisfy P7's successor validator until P1 is supplied. Reapplying an
identical catalogue preserves acceptance. Withdrawal, revision regression,
malformed entries and content changes under a reused revision clear acceptance.

The composition owner connects `getWorkspaceContributionSnapshot()` and
`subscribeWorkspaceContributionChanges(listener)` to `setStimulusOrderCatalogue` once,
handles the returned promise, and unsubscribes on teardown. All failures are
reported by P3 and leave its contribution pending. P7 registers the P3 getter and
validator, prepares the current table before registry acceptance, restores P1
before P3, awaits restoration, then accepts the returned current snapshot.
Prepared domain data, P7 registry acceptance and acknowledged final persistence
are separate states. Neither owner reads DOM cells to construct another's payload.

When P1 restoration stages media declarations as unresolved, P7 passes the
strictly parsed saved P1 workspace payload to the content-only hook and the
actual pending P1 snapshot in `dependencies.P1`. P3 uses the pure
`projectSavedVariantCatalogue` declaration projection, with no fabricated ready
snapshot. Users can view and edit the table before media rebind; preparation
remains blocked. Later verified P1 snapshots preserve that draft and require
explicit preparation/acceptance. Changed media identities leave old references
unresolved rather than substituting videos. Pending producer changes retain
their actual P1 revision in P3's dependency list. All three restore paths share
a latest-request guard; newer reopen, edits, dependency changes and teardown
invalidate a delayed restoration before it can mutate the editor.

## Explicit P1 compatibility projection

### Location references (P1 catalogue v2, P3 design v2)

The generic workspace validator/projector now dispatches P1 v1 and v2. For v2,
`createLocationVariantLibrary(catalogue)` in `variant-library.js` derives an
internal editor view whose ordered videos contain exactly `annotationId`,
`assetId`, `relativePath` (the package path), `sha256`, `byteLength`, `durationMs`.
Its library hash covers `{schema:"affect-research-video-library",version:2,videos}`.
The full validated P1 catalogue is attached for provenance; this view is not a
second persisted master media authority.

P3 contribution v2 retains the v1 root keys. Each video entry contains exactly
`{entryId,kind:"video",referenceId,assetId}`; `referenceId` is the exact reversible
P1 location annotation including extension. ISI entries retain their three v1
fields. Distinct locations can share bytes and an asset ID. Both identities must
match P1. Moving or renaming a file invalidates the old cells; there is no asset-
only fallback or implicit migration. Variant hashes bind the complete video
projection, including duration. Allocation remains exactly `{kind:"runnerAssigned"}`.

The embedded marker contract is version 2 with added
`sourceIdentity:"video-location-content-pair-sha256-v1"`. A video's private
codebook identity hash is canonical SHA-256 of `{annotationId,assetId}`, so repeated
occurrences share a source while distinct locations remain distinct even with
identical bytes. Marker event envelopes and Runner behavior are unchanged.

`variant-reproduction-v2.json` adds duplicate-content locations to the full
reproduction fixture. Its three independently specified sequence durations are
50646, 37801 and 37035 ms. Both fixture versions are supported by the independent
assertion/process helpers. Historical P1/P3 v1 readers, hashes and fixtures remain
unchanged. The internal editable stimulus-order document uses version 3 for P3
v2; P7 embeds the contribution itself and uses content-only restoration.

P3 v2 clipboard input is TSV as supplied by Excel, including single-column
blocks with commas in filenames. The shared parser's optional character bound
is capped at 6144, defaulting to the existing 4000 for P2 and legacy callers;
P3 additionally enforces 6144 UTF-8 bytes per cell. Full IDs survive CSV/XLSX
exports. v2 download requests include the validated P1 catalogue for the export
adapter to verify against the current owned library before generating bytes.

### Historical v1 projection

[`projectVariantCatalogue`](../site/src/research/variant-catalogue-adapter.js)
consumes the registered `affect-research-workspace-contribution` v1 snapshot
through P1's `projectWorkspaceVideoCatalogueSnapshotV1`. P1 validates the complete
workspace and extracts its video catalogue without changing the registered owner
revision or the nested catalogue's own revision/hash. P3 fingerprints the complete
workspace payload, so study-only edits also invalidate/rebind its dependency.
P1's `asset-<full content SHA-256>` and readable annotation are
different identities from the existing P3 library's
`video-<first 16 characters of identity SHA-256>` references. Existing P3 IDs
remain unchanged. The adapter reconstructs the strict v1 library from exact
package-relative path, byte SHA-256 and length, then attaches the matching P1
asset ID and duration. Duplicate readable aliases are rejected. No fallback
precedence, filename-only match or migration of saved cells is performed.

Both `compileVariantTimeline` and `createPlannedMarkerProfile` consume this same
projection and resolve only its explicit `annotationId`. Asset-only geometry
projections and duplicate references are rejected by both consumers. The source
workspace integrity is part of the compared projection; unchanged revision
numbers cannot conceal changed durations or geometry. The P1 snapshot revision
is distinct from the nested catalogue revision and is the P7 dependency value.
The explicitly named `projectLegacyVariantCatalogue` remains available for
video-only component fixtures. That legacy snapshot shape is not accepted by the
production workspace setter, validator or P7 restore adapter.

`compileVariantTimeline(contribution, variantId, projection.videos)` returns
ordered paired start/end events and integer planned offsets. Zero-duration ISIs
still have two boundaries. `createPlannedMarkerProfile(contribution, variantId,
projection.videos, recipeSha256)` embeds opaque source codes and exact source
hashes/durations; P7 supplies the final recipe hash. The contribution's variant
hash binds authored sequence and byte identities; the final recipe additionally
binds P1 metadata. Planned offsets are estimates, never measured onset. See the
[marker specification](planner-marker-contract-v1.md) for reconstruction rules.

## Reproduction fixtures and limits

- [`variant-reproduction-v1.json`](../test/fixtures/variant-reproduction-v1.json)
  supplies full P1 declarations, editable P3 input and its accepted contribution
  for P7 master tests. Authored variant order is 3, 1, 2; lengths are 8, 4, 3;
  occurrence IDs are deliberately non-contiguous. Repeated/adjacent videos,
  leading/consecutive/final/zero ISIs, distinct duplicate durations and an unused
  dictionary definition all survive. Expected per-entry bounds are specified
  independently; totals are 50646, 37801 and 48146 ms.
  `scripts/emit-variant-reproduction-fixture.js` regenerates the payload without
  deriving expected times from the timeline compiler.
- P7 can reuse `assertVariantReproduction(workspace, contribution,
  definitionSha256, expected)` from
  [`assert-variant-reproduction.js`](../test/fixtures/assert-variant-reproduction.js)
  after strict complete-master parsing. Pass actual `segments.P1`, `segments.P3`
  and authored-core definition hash; do not replace full master validation with
  this owner assertion. It checks every boundary, occurrence and embedded marker
  source against the fixture. The standalone process fixture currently covers
  P3 domain reproduction only; it does not claim complete-master acceptance.

- [`research-video-catalogue-contribution-v1.json`](../test/fixtures/research-video-catalogue-contribution-v1.json)
  is the exact P1 shared fixture from `3d6a6b2bdf33cc685668e650ca163c39be75c491`.
- [`variant-catalogue-binding-v1.json`](../test/fixtures/variant-catalogue-binding-v1.json)
  preserves the legacy video-only projection fixture at revision 11 (nested revision 1), two variant
  columns, the editable document, exact derived timelines and marker codebooks,
  plus pending/withdrawn/unsupported inputs. Its P3 integrity SHA-256 is
  `ebc3bee014e02ca51308b7ffb7dc1c2f870ffa3e421fbf4a2563ba118f558920`.
- [`variant-workspace-binding-v1.json`](../test/fixtures/variant-workspace-binding-v1.json)
  is the current P7 dependency/restore fixture: workspace revision 30, study-only
  revision 31 with unchanged video catalogue, then workspace revision 32 with
  video catalogue revision 2. It retains the exact same P3 payload and records
  the expected dependency revisions, complete workspace fingerprints and timing.
- [`variant-design-v1.json`](../test/fixtures/variant-design-v1.json) remains the
  strict JS/Rust named-ISI persistence parity fixture. These repairs change no
  serialized P3/Rust type or historical reader.

These are Planner software interfaces and synthetic reconstruction evidence.
Composition must not downgrade this payload into the frozen package v1 format.
Native P1 geometry proof, master composition, actual Runner clocks, emission,
recording, playback and device qualification retain their respective owners.
