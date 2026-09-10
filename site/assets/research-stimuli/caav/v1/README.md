# CAAV browser stimulus subset

This directory contains a practical, versioned subset of the **Chieti
Affective Action Video (CAAV)** database for later AffectTracker2D validation.
The official Figshare record labels CAAV **CC0 1.0**. The validation study
reports 360 silent 15-second videos, 90 actions, two actors, multiple filming
conditions, 444 participants, and retrospective 1–9 SAM valence/arousal norms.

Sources:

- [Official CAAV Figshare record](https://springernature.figshare.com/articles/dataset/CAAV_database/11215067)
- [Validation paper](https://www.nature.com/articles/s41597-020-0366-1)
- [CC0 1.0 public-domain dedication](https://creativecommons.org/publicdomain/zero/1.0/)

## What is hosted

- `media/`: 96 silent H.264/MP4 files for current desktop Chrome and Edge,
  named `caav__<original-id>__h264-1080p.mp4`.
- `catalog.json`: authoritative per-clip action, filming condition, aggregate
  and participant-gender subgroup norms, normalized tracker coordinates,
  source identity, browser-media identity, duration, frame count, and hashes.
- `ratings/caav__clip-norms__sam-1-9.csv`: all 360 aggregate clip records,
  including overall and participant-gender subgroup means and standard
  deviations.
- `ratings/caav__raw-{valence,arousal}__sam-1-9.csv`: the complete sparse raw
  rating matrices for all 360 clips.
- `ratings/original/`: the two official ratings workbooks from Figshare.
- `metadata/original/CAAV_Study_Characteristics.xlsx`: the official
  study-description workbook.
- `metadata/*-manifest.json`: exact source and derivative identities used to
  build and audit this subset.

The primary subset contains `1_F_001` through `1_F_090`: one fixed viewpoint
and actor condition covering all 90 actions. Six additional sample clips cover
alternative actor/viewpoint conditions for actions 014 and 085. The separate
sample articles published by the authors also provide direct source identity
for the two corresponding primary clips.

## Rating coordinates

The original CAAV norms are retrospective post-video SAM ratings on a 1–9
scale. The catalog retains each mean and standard deviation and adds the exact
linear mapping used by AffectTracker2D:

`affectTrackerCoordinate = (SAM - 5) / 4`

This maps 1 to -1, 5 to 0, and 9 to +1. It does not turn the clip-level CAAV
norm into continuous ground truth. For validation, pre-register how a
participant's continuous trace will be reduced (for example, median, mean,
endpoint, or a fixed time window) before comparison with the published norm.

## Derivative and study controls

The official source files are MPEG program streams. To support browser
playback, their video streams were transcoded to lossy H.264/AVC MP4 at the
original 1920×1080 dimensions with no audio, using the recipe recorded in
`catalog.json`. The conversion preserves the source frame count; 95 files have
451 frames and `1_F_074` has 450 frames. Each derivative has a unique SHA-256,
which should be bound into the published study revision.

Researchers should screen action descriptions and clips for distressing or
violent content, define withdrawal/debrief procedures, and obtain the relevant
ethics approval. Do not infer that a clip is safe or appropriate merely because
it is openly licensed.

The complete official 6.14 GB archive is not mirrored because it alone exceeds
GitHub Pages' 1 GB published-site limit. Its upstream URL and published hash
remain in `catalog.json`.

The official raw ratings contain pseudonymous subject labels, age, gender, and
list assignment. They are already published under CC0 and are included because
this archive is intended to preserve all available original ratings. Prefer
the aggregate norms for ordinary stimulus selection and handle row-level data
as participant research data even though the upstream record is public.
