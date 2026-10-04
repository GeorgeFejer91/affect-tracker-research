# P5 feedback settings v3: 21 × 21 Face packs

New Planner authoring writes `segments.P5` with schema `affect-research-feedback`, version 3. The rest of the P5 object retains the [version 2 field meanings](planner-p5-feedback-v2.md). Historical version 2 recipes retain the `procedural-face` renderer and are not silently rewritten when opened.

| Visible input | JSON output | Runner interpretation |
| --- | --- | --- |
| Flubber / 2D Grid / Face toggle | `presentation.renderer`: `flubber`, `grid`, or `photo-face-matrix21` | Exactly one participant feedback renderer; the live Planner test coordinate is not saved |
| Face portrait selector | `presentation.facePackId`, `presentation.facePackSha256` | Exact pack from the bundled nine-pack catalogue, with its local WebP bytes checked before Start |
| Shared appearance, response and input settings | Same `visual`, `mappings`, `response`, `input` and other `presentation` fields as v2 | Existing strict normalized settings and native response rules |

All nine locally bundled portraits are individually selectable. The picker identifies each synthetic preset by its creator-selected presentation style and regional design inspiration where available, and explicitly describes these as artwork cues. The catalogue is `site/assets/affect-face/photo-atlas-packs-v1.json`; pack IDs, atlas dimensions and SHA-256 values are pinned there. Face painting bilinearly blends adjacent cells of each 21 × 21 atlas at the selected valence/arousal coordinate. The assets' appearance metadata does not establish a person's gender or ethnicity, and the interpolated imagery is not an independently validated measure of affect.

Version 3 rejects `procedural-face`; version 2 rejects `photo-face-matrix21` and Face pack fields. A version 3 object always carries pack identity and hash, including while Flubber or Grid is selected, so switching back to Face restores the chosen portrait. Planner and Runner use the same catalogue and strict reader. Runner additionally verifies the selected WebP bytes before browser or native execution. If a pack is missing, altered or cannot decode to the expected geometry, Face paint stays hidden and Start fails.

The expected qualification path is: select each pack in Planner; save and reopen exact master JSON; independently read it in Runner; compare renderer, pack ID/hash, P4 placement and response settings; observe each participant display at multiple coordinates; then complete an installed session with video, input, LSL and XDF. Current source/hash tests and a nine-pack browser screenshot establish asset availability and selection, while the installed workflow remains open.
