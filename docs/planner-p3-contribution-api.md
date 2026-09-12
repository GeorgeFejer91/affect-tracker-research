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
| `setStimulusOrderCatalogue(P1snapshot)` | Async. Immediately withdraws P3 acceptance on a changed, pending, unavailable or invalid producer; validates/project its accepted content before exposing catalogue timing. |
| `validateStimulusVariantContribution(contribution, {dependencies})` | Async. `dependencies.P1` is the exact five-key current P1 snapshot. Returns `true` or throws after domain, identity and duration validation. Use as P7's owner validator. |
| `restoreStimulusVariantContribution(contribution, {isCurrent, dependencies})` | Async. Validates and projects `dependencies.P1`, validates the full P3 payload, and checks the caller's `isCurrent()` plus the editor generation before one atomic commit. Returns the final five-key snapshot. P7 must await it. |
| `confirmStimulusOrder()` | Saves the named-ISI authoring document through the existing storage receipt boundary. Edits or dependency changes during compilation cannot issue a stale write or reaccept a stale receipt. |

The old `restoreStimulusOrder(document, receipt)` and
`restoreStimulusVariantContribution(contribution, receipt)` overloads accept
`{library, catalogue?, isCurrent?}` for component/legacy workspace consumers.
`catalogue` is the explicit P3 projection with its actual owner revision. A
library-only restore cannot invent a P1 revision; it returns no P1 dependency and
does not satisfy P7's successor validator until P1 is supplied. Reapplying an
identical catalogue preserves acceptance. Withdrawal, revision regression,
malformed entries and content changes under a reused revision clear acceptance.

The composition owner connects `getVideoCatalogueContributionSnapshot()` and
`subscribeVideoCatalogueChanges(listener)` to `setStimulusOrderCatalogue` once,
handles the returned promise, and unsubscribes on teardown. All failures are
reported by P3 and leave its contribution pending. P7 registers the P3 getter and
validator, restores P1 before P3, awaits restoration, then accepts the returned
current snapshot. Neither owner reads DOM cells to construct another's payload.

## Explicit P1 compatibility projection

[`projectVariantCatalogue`](../site/src/research/variant-catalogue-adapter.js)
consumes `affect-research-video-catalogue-contribution` v1 through P1's own
validator. P1's `asset-<full content SHA-256>` and readable annotation are
different identities from the existing P3 library's
`video-<first 16 characters of identity SHA-256>` references. Existing P3 IDs
remain unchanged. The adapter reconstructs the strict v1 library from exact
package-relative path, byte SHA-256 and length, then attaches the matching P1
asset ID and duration. Duplicate readable aliases are rejected. No fallback
precedence, filename-only match or migration of saved cells is performed.

Both `compileVariantTimeline` and `createPlannedMarkerProfile` consume this same
projection and resolve only its explicit `annotationId`. Asset-only geometry
projections and duplicate references are rejected by both consumers. The source
catalogue integrity is part of the compared projection; unchanged revision
numbers cannot conceal changed durations or geometry. The P1 snapshot revision
is distinct from the nested catalogue revision and is the P7 dependency value.

`compileVariantTimeline(contribution, variantId, projection.videos)` returns
ordered paired start/end events and integer planned offsets. Zero-duration ISIs
still have two boundaries. `createPlannedMarkerProfile(contribution, variantId,
projection.videos, recipeSha256)` embeds opaque source codes and exact source
hashes/durations; P7 supplies the final recipe hash. The contribution's variant
hash binds authored sequence and byte identities; the final recipe additionally
binds P1 metadata. Planned offsets are estimates, never measured onset. See the
[marker specification](planner-marker-contract-v1.md) for reconstruction rules.

## Reproduction fixtures and limits

- [`research-video-catalogue-contribution-v1.json`](../test/fixtures/research-video-catalogue-contribution-v1.json)
  is the exact P1 shared fixture from `3d6a6b2bdf33cc685668e650ca163c39be75c491`.
- [`variant-catalogue-binding-v1.json`](../test/fixtures/variant-catalogue-binding-v1.json)
  binds that fixture at owner revision 11 (nested revision 1), two variant
  columns, the editable document, exact derived timelines and marker codebooks,
  plus pending/withdrawn/unsupported inputs. Its P3 integrity SHA-256 is
  `ebc3bee014e02ca51308b7ffb7dc1c2f870ffa3e421fbf4a2563ba118f558920`.
- [`variant-design-v1.json`](../test/fixtures/variant-design-v1.json) remains the
  strict JS/Rust named-ISI persistence parity fixture. These repairs change no
  serialized P3/Rust type or historical reader.

These are Planner software interfaces and synthetic reconstruction evidence.
Composition must not downgrade this payload into the frozen package v1 format.
Native P1 geometry proof, master composition, actual Runner clocks, emission,
recording, playback and device qualification retain their respective owners.
