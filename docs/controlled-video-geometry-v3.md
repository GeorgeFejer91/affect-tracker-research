# Controlled native geometry: P1 successor contract

Root schema freeze 02, 2026-09-12. P1-06/P1-07, Backend Verification.
Native renderer configuration is controlled and read back, not independently
observed pixel orientation. No playback qualification, source re-encoding,
source-tag repair or filesystem permission is established by this contract.

## Exact native proof

`affect-research-native-display-metadata-receipt`, version **2**, has exactly:
`schema`, `version`, `encodedWidthPx`, `encodedHeightPx`, `pixelAspectRatio`,
`sourceOrientation`, `snapshotWidthPx`, `snapshotHeightPx`,
`snapshotPixelAspectRatio`, `snapshotInterpretation`, `renderer`.

- Dimensions are integers 1–32768. Ratios have exactly `numerator` and
  `denominator`, coprime positive integers at most 65535.
- `sourceOrientation` has exactly `stream` and `media`. Each is exactly
  `{status:"absent"}` or `{status:"explicit",rotationDegrees:0|90|180|270}`.
  Missing, malformed, unsupported/reflected/auto/custom or conflicting tags
  reject; a parser failure must never be relabelled absence. Two explicit tags
  must agree. Zero means an explicit identity only when status is explicit.
- `snapshotInterpretation` is `pre-renderer-square-pixel` and
  `snapshotPixelAspectRatio` is exactly 1/1. Its raw aspect must equal encoded
  width × source PAR / encoded height. Already-rotated nonsquare caps reject.
  Square-frame dimensions cannot prove rotation; this is a configured policy.
- `renderer` has exactly `sinkFactory:"d3d11videosink"`,
  `configuredRotationDegrees`, `readbackRotationDegrees`. Both rotations equal
  the agreed explicit source rotation, or controlled zero when both are absent.
  This last policy does not fabricate an explicit source tag.
- Derive display dimensions by swapping raw snapshot width/height exactly once
  for controlled 90/270 degrees, otherwise retaining them. No second rotation,
  snapshot-orientation inference, sink substitution or ambient default.

The native owner alone constructs this proof from the actual selected sink,
set/readback and raw snapshot caps. Session/generation/grant/file/metadata-revision
fences remain native receipt/lifecycle authority, not portable recipe entropy.
The outer native decode receipt is separately version 2; its v1 remains strict.

## Catalogue and workspace

Catalogue schema `affect-research-video-catalogue-contribution`, version **3**,
retains exactly v2's outer fields, reversible location policy, ordering, count
bounds, SHA content identities and integrity algorithm. All eight entry fields
remain. Duplicate locations sharing content must agree on complete geometry.

Only v3 additionally admits this exact nine-key geometry branch:

```text
{status:"verified", source:"native-gstplay-controlled-renderer",
 displayWidthPx, displayHeightPx, displayAspect, rotationDegrees,
 pixelAspectRatio,
 metadataInterpretation:"controlled-renderer-and-pre-sink-square-pixel-snapshot",
 nativeDisplayMetadata:<exact receipt v2>}
```

In this distinctly tagged branch rotation is controlled rotation and PAR is
source PAR. All redundant values must equal independent derivation from the
complete nested proof. `displayAspect` is the reduced display dimension ratio.
The proof, including absent versus explicit identity, participates in the hash.
Historical eight-key browser and explicit-native branches remain byte-identical
alternatives. Their readers do not accept the new branch or added fields.

Workspace `affect-research-workspace-contribution`, version **3**, retains
`schema/version/study/workspaceLayout/videoCatalogue`, requires catalogue3 and
keeps the existing study/layout rules. Versions 1/2 never accept catalogue3.
Supported dispatch is separate from historical readers. Old files are not
automatically upgraded or rewritten. New producer dispatch selects3 for controlled
proof and preserves3 on later revisions; old-only new catalogues remain2.

## Downstream ownership

P3's explicit catalogue3 context retains the full source catalogue but projects
the same geometry-free location-library2 core and hash. No catalogue downconversion
occurs. Sequence/occurrence/marker semantics remain P3v2. P4/P6 consume explicit
supported geometry projections with unchanged math and fresh P1 dependency guards.
Main owns master3/reproduction-v4/selection3 and strict master1/2 version fences;
Runner owns supported intake and actual live media correspondence. These are not
implemented or qualified merely by the P1 reader handoff.

Required evidence: frozen old canonical hashes and rejection rules, new exact-key
and malformed/conflict negatives, absent/explicit quarter-turn and PAR vectors,
proof-only hash changes, independent JS/Rust reencoding and geometry/P3 parity.
Native sink lifecycle evidence and actual CLI import/rebind remain separate.
