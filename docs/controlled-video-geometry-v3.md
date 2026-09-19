# Controlled HTML Video Geometry: P1 Successor Contract

Root schema freeze 02, 2026-09-12. P1-06/P1-07, Backend Verification.
The active media path is the browser/WebView `HTMLVideoElement`. Planner save
prepares researcher videos for that player with ffprobe/ffmpeg and binds the
resulting element dimensions into the catalogue. No native player SDK, renderer
sink, source-tag repair, or filesystem permission is established by this
contract.

## Exact HTML Video Proof

`affect-research-html-video-display-metadata-receipt`, version **1**, has
exactly: `schema`, `version`, `videoWidthPx`, `videoHeightPx`,
`pixelAspectRatio`, `sourceOrientation`.

- Dimensions are integers 1–32768. Ratios have exactly `numerator` and
  `denominator`, coprime positive integers at most 65535.
- `sourceOrientation` has exactly `stream` and `media`. Each is exactly
  `{status:"absent"}` or `{status:"explicit",rotationDegrees:0|90|180|270}`.
  Missing, malformed, unsupported/reflected/auto/custom or conflicting tags
  reject; a parser failure must never be relabelled absence. Two explicit tags
  must agree. Zero means an explicit identity only when status is explicit.
- `videoWidthPx` and `videoHeightPx` are the intrinsic dimensions surfaced to
  the HTML video element after any Planner-side conversion. They are already
  the dimensions the Runner will fit on screen; no renderer-local rotation or
  sink substitution is part of the proof.
- Planner-side conversion writes a deterministic `_converted.mp4` sibling only
  when the source is not already HTML-compatible. Existing compatible converted
  siblings are reused, so repeated saves do not create clutter.

The HTML-video owner alone constructs this proof from the prepared workspace
asset and the observed element metadata. Session/generation/grant/file fences
remain runtime receipt authority, not portable recipe entropy.

## Catalogue and workspace

Catalogue schema `affect-research-video-catalogue-contribution`, version **3**,
retains exactly v2's outer fields, reversible location policy, ordering, count
bounds, SHA content identities and integrity algorithm. All eight entry fields
remain. Duplicate locations sharing content must agree on complete geometry.

Only v3 additionally admits this exact nine-key geometry branch:

```text
{status:"verified", source:"html-video-controlled-renderer",
 displayWidthPx, displayHeightPx, displayAspect, rotationDegrees,
 pixelAspectRatio,
 metadataInterpretation:"html-video-element-intrinsic-dimensions",
 htmlVideoMetadata:<exact receipt v1>}
```

In this distinctly tagged branch, all redundant values must equal independent
derivation from the complete nested proof. `displayAspect` is the reduced HTML
video display dimension ratio. The proof, including absent versus explicit
identity, participates in the hash. Historical eight-key browser branches
remain byte-identical alternatives. Their readers do not accept the new branch
or added fields.

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
and malformed/conflict negatives, absent/explicit orientation and PAR vectors,
proof-only hash changes, independent JS/Rust reencoding and geometry/P3 parity.
HTML playback/import/rebind evidence remains separate from this static contract.
