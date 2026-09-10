# OpenLAV rating archive

This source folder preserves the complete published CSV ratings for the **Open
Library for Affective Videos (OpenLAV)**. OpenLAV contains 188 emotion-inducing
videos (12–71 seconds, approximately 40 seconds on average) tested by 422
US participants, with about 71 ratings per video. The repository record marks
the videos and rating files **CC BY 4.0**.

Sources:

- [Official OpenLAV data record](https://doi.org/10.23668/psycharchives.5043)
- [Official OpenLAV moving-image record](https://www.psycharchives.org/en/item/18779e98-c04b-4299-8311-dc442dc89bcd)
- [CC BY 4.0 licence](https://creativecommons.org/licenses/by/4.0/)

## What is hosted

- `ratings/openlav__clip-norms__original.csv`: the publisher's complete
  188-video descriptive table, including source URL, licence, duration, mean
  valence/arousal factor scores, dispersion, and emotion-label counts.
- `ratings/openlav__clip-norms-codebook__original.csv`: its original codebook.
- `ratings/openlav__raw-ratings__original.csv`: all 13,264 published rating
  rows before the authors' exclusions.
- `ratings/openlav__raw-ratings-codebook__original.csv`: the complete original
  raw-data codebook.
- `metadata/original/openlav__source-readme__original.txt`: the publisher's
  README.
- `catalog.json`: exact source URLs, published MD5s, local SHA-256s, byte
  lengths, and interpretation boundaries.

The filenames are normalized for this catalogue, but file contents are
byte-for-byte identical to the publisher downloads. In particular, the
clip-level `valence` and `arousal` columns are the authors' factor scores—not
raw SAM values and not AffectTracker coordinates. The raw table contains the
original 1–9 SAM items (`sam_0` valence and `sam_1` arousal). Any transformation
must be specified in the study analysis plan and must not overwrite the
original files.

The raw table also retains publisher-issued HIT/worker identifiers,
demographics, personality and questionnaire fields. Although PsychArchives
publishes it as a public-use CC BY 4.0 file, treat it as participant-level
research data: use the aggregate clip table by default, restrict row-level
processing to a justified analysis, and do not attempt re-identification.

## Media boundary

The 188 videos are not duplicated on this GitHub Pages site. They are available
from the official moving-image record, but the current Pages deployment is
already close to its 1 GB publication limit after the CAAV subset. Researchers
should download the exact selected OpenLAV videos from the publisher, preserve
the author/source attribution and licence recorded in the clip table, and bind
each selected file hash into the study revision.

OpenLAV is especially useful for selecting approximately 15 short clips for a
10-minute session. That sequence is a new compound stimulus: counterbalance
order, include transitions or washouts, analyse the clips as repeated units,
and pilot the exact sequence rather than treating it as an already validated
single 10-minute film.
