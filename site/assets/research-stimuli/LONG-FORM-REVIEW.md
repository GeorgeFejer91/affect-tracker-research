# Long-form affective-stimulus review for AffectTracker2D

Reviewed 2026-09-10. This is a source audit and study-design recommendation,
not an approved stimulus protocol. The decisive distinction is whether ratings
describe the **participant's induced/felt affect** or the emotion
**perceived/expressed in the stimulus**. For validating a self-report tracker,
induced valence and arousal are the closer criterion.

## Recommended order

| Rank | Source and modality | Duration and ratings | Openness | Suitability for a roughly 10-minute slot |
| --- | --- | --- | --- | --- |
| 1 | [Emo-FilM](https://www.nature.com/articles/s41597-025-04803-5) / [LIRIS-ACCEDE](https://liris-accede.ec-lyon.fr/database.php), narrative audiovisual films | Emo-FilM has 16 edited films lasting 6:42–17:08 (mean 11:47). LIRIS supplies second-by-second continuous induced valence/arousal annotations for 30 films; Emo-FilM adds 1 Hz appraisal/component annotations. | The underlying films are public-domain or Creative-Commons works, but LIRIS database access requires an institutional-email EULA and each selected film's licence must be preserved. | **Best one-piece option.** Select an approximately 8–12 minute film with both LIRIS V/A traces and appropriate content, then lock the exact cut and hash. Existing continuous annotations are the closest temporal comparator. |
| 2 | [DEAM](https://cvml.unige.ch/databases/DEAM/), music | 1,802 songs/excerpts; 45-second excerpts plus 58 full songs. Dynamic valence/arousal at 2 Hz and static 1–9 ratings. | Public research download; the official manual describes royalty-free/Creative-Commons audio and non-commercial reuse conditions. Verify the exact licence/version attached to each release. | **Best audio benchmark.** Two to four full songs can fill the slot, or use a counterbalanced excerpt block. The annotations concern emotion expressed/perceived in music, so they are an imperfect ground truth for the listener's felt affect. |
| 3 | [IDEST](https://pmc.ncbi.nlm.nih.gov/articles/PMC9544016/) / [OSF data](https://osf.io/9tga3/), first-person written vignettes | 250 stories of roughly 900–1,100 characters, with 1–9 SAM valence, arousal, and comprehensibility ratings in six source languages and English. | The article states that the database is freely available for academic research; the OSF record should be checked for an explicit derivative/redistribution licence before publishing audio. | **Best vignette starting point.** Approximately five to seven fixed narrations may fill ten minutes. Text ratings do not validate a new audio rendering: voice, prosody, pace, translation, and pauses require a fresh audio pilot. |
| 4 | [OpenLAV](https://doi.org/10.23668/psycharchives.5043), short audiovisual clips | 188 videos, 12–71 seconds (about 40 seconds average); induced post-clip valence/arousal, appraisals, and emotion labels from 422 participants. | Videos and complete ratings are CC BY 4.0. All original rating CSVs are mirrored in `openlav/v1/`; video media remains at the official record. | **Best fully open clip sequence.** About 15 clips fill ten minutes. Treat clips as repeated units, counterbalance order, and pilot the exact sequence; concatenation does not create an already validated continuous film. |
| 5 | [CASE](https://pmc.ncbi.nlm.nih.gov/articles/PMC6785543/), audiovisual clips | Eight emotion videos of roughly 119–197 seconds; 30 participants supplied simultaneous continuous induced valence/arousal with a joystick, plus physiology. | Ratings/data are available, but several stimuli are commercial film or web excerpts; redistribution rights are not clean. | **Best methodological match** to a two-dimensional joystick tracker. Three or four clips fill the slot, but media must be sourced/licensed independently and exact time windows preserved. |
| 6 | [AMIGOS](https://eecs.qmul.ac.uk/mmv/datasets/amigos/), audiovisual film excerpts | 16 short and four long excerpts; long clips are about 14–24 minutes. Self-assessed V/A, external continuous annotations, physiology, and individual/group conditions. | Controlled research access; commercial film excerpts are not publicly redistributable. | Useful comparison corpus but longer than the target and confounded by social viewing condition. Not a Pages-hostable stimulus library. |
| 7 | [Emo-Soundscapes](https://www.metacreation.net/projects/emo-soundscapes), environmental audio | 1,213 six-second CC-licensed clips; perceived valence/arousal from 1,182 annotators across 74 countries. | Open CC audio, subject to per-clip attribution/licence preservation. | Excellent brief audio calibration coverage, poor as a natural ten-minute induction: a 100-clip montage introduces extreme context switching and must be re-normed. |

## Sources that do not meet the primary criterion

- [SENDv1](https://pmc.ncbi.nlm.nih.gov/articles/PMC8414991/) contains 193
  autobiographical audiovisual narratives averaging about 2:15 and continuous
  observer ratings, but only valence—not arousal—and the target person's
  displayed affect is rated rather than the observer's induced two-dimensional
  experience.
- [K-EmoCon](https://zenodo.org/records/3931963) contains approximately
  ten-minute paired debates and five-second V/A annotations, but it is a
  controlled-access social-interaction corpus, not a standardized set of
  emotion-inducing stimuli.
- RAVDESS, CREMA-D, and similar emotional-speech corpora label a speaker's
  expressed emotion. They are useful recognition stimuli but do not provide a
  validated induced valence/arousal target for the listener.
- IADS/IADS-E and the Affective Audio Database are mainly short sounds. Their
  source-media redistribution conditions are less suitable for an open Pages
  catalogue, and extending or concatenating them changes the stimulus context.

## Recommended study designs

For the cleanest validation, use one Emo-FilM/LIRIS narrative of 8–12 minutes
whose full continuous V/A trace is licensed and available. Preserve the exact
cut, codec, loudness, resolution, and hash. This tests temporal convergence
against a group norm while retaining a coherent emotional arc.

If an entirely open workflow is more important, use a preregistered OpenLAV
block of approximately 12–15 clips. Add a neutral lead-in, fixed inter-clip
intervals, and a counterbalanced or Latin-square order. Compare each
participant's pre-specified within-clip summary with the corresponding OpenLAV
norm; do not correlate a stitched trace with static clip norms as if it were
continuous ground truth.

For audio-only validation, DEAM is the strongest existing V/A resource. Use
full songs where available and explicitly label the analysis as convergence
with **perceived musical emotion**. If the research question is felt affect,
collect new induced ratings for the selected songs.

For vignettes, choose stories covering the desired V/A quadrants, produce one
fixed narration voice and loudness profile, and pilot the audio derivatives as
new stimuli. Translation is not neutral: the IDEST paper reports much stronger
cross-language agreement for valence than arousal. Do not claim that the
written-text norms validate synthesized or human-read audio.

## Analysis safeguards

Pre-register the response-lag window and temporal alignment. Estimate a single
lag policy on pilot/training material rather than optimizing lag independently
on every test trace. Resample both traces onto a common clock and report
concordance correlation (agreement), Spearman correlation (shape/order), and
absolute error; correlation alone can hide offset and scale bias. Use
participant- and stimulus-level hierarchical or repeated-measures analysis,
and report inter-rater uncertainty in the published norm.

Long blocks reduce the number of independent stimulus units and increase
habituation, fatigue, narrative-context, and carryover effects. Include a
neutral baseline, content warning/withdrawal path, planned washout, volume and
display controls, and an exact study manifest. Do not tune smoothing, lag, or
normalization after viewing held-out validation outcomes.

## Practical recommendation

Use **Emo-FilM/LIRIS as the primary continuous ten-minute benchmark**, a small
**OpenLAV subset as a fully open clip-level convergent check**, and **DEAM as an
audio modality check**. Treat IDEST-to-audio as a separate stimulus-development
study requiring new validation. CASE is methodologically excellent evidence
for the 2D procedure but is not the best media-distribution choice.
