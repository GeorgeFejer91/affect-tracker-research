# Research stimulus library

This folder stages openly redistributable affective video stimuli and their
published valence/arousal norms for later researcher use. It does not make a
stimulus set part of the qualified Affect Tracker study by itself: researchers
must still choose and lock an exact subset, obtain ethics approval, preserve
presentation conditions, and bind each media SHA-256 into the study revision.
The hosted catalogue is a read-only research resource; it is not an
`ExperimentPackageV1` asset library and cannot satisfy package preflight.

## Included now

- `caav/v1/` contains 96 silent, browser-ready CAAV clips: all 90 distinct
  actions in the `1_F` filming condition plus six separately published
  alternative actor/viewpoint samples. Each clip has an H.264/MP4 derivative,
  exact hashes, original and normalized valence/arousal norms, the complete
  official aggregate and raw rating tables as CSV, and CC0 provenance.
- `openlav/v1/` contains all four original OpenLAV rating/codebook CSVs: 188
  clip-level records and 13,264 raw rating rows, with publisher hashes and
  CC BY 4.0 provenance. Its 188 videos remain at the official repository to
  keep this Pages deployment below 1 GB.
- [`LONG-FORM-REVIEW.md`](LONG-FORM-REVIEW.md) ranks longer audiovisual,
  music, soundscape, and vignette sources and defines the interpretation and
  validation cautions for a roughly ten-minute experiment slot.
- [`catalog.json`](catalog.json) records the reviewed status of every database
  in the acquisition and long-form review.

Do not treat a downloadable file as permission to redistribute it. DEVO-2,
AVDOS, One-Minute Silent Videos, LIRIS-ACCEDE, Expanded EMDB, and Emo-FilM media stay
as upstream references until their media-level permissions and access terms
are satisfied. No access control or licence gate was bypassed.

## Naming and layout contract

Each source uses the stable path
`<source-id>/<catalog-version>/{media,ratings,metadata}/`. Browser media use
lowercase ASCII names of the form
`<source-id>__<original-source-id>__<encoding-profile>.<extension>`. CSV rating
files use `<source-id>__<rating-table>__<scale>.csv`. The original source ID is
also retained in each source catalog, so filenames can change only through a
new catalog version.

## Public paths

After Pages deploys, the registry is available at:

`https://georgefejer91.github.io/affect-tracker-research/assets/research-stimuli/catalog.json`

The CAAV machine-readable catalog is available at:

`https://georgefejer91.github.io/affect-tracker-research/assets/research-stimuli/caav/v1/catalog.json`

The OpenLAV ratings catalog is available at:

`https://georgefejer91.github.io/affect-tracker-research/assets/research-stimuli/openlav/v1/catalog.json`
