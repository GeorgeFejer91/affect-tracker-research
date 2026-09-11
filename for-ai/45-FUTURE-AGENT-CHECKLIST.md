# Historical deferred issues and roadmap routing

The central capability checklist is now
[`60-SEGMENT-CATALOGUE.md`](./60-SEGMENT-CATALOGUE.md). The issue descriptions
below preserve findings from the earlier Section 2 pass. They are not a second
completion ledger or a perpetual Section 2-only allocation. Record current
decisions and progress under the stable IDs below; add new capability items to
the owning segment there and coordinate dependencies through the message board.

| Historical topic | Central owner / capability IDs |
| --- | --- |
| Designer roles, UI authoring, final export | P7-03, P7-05–P7-09 |
| Video library and manual/version plan | P1-03–P1-07, P3-02–P3-10 |
| Runnable feedback design | P5-04–P5-08, P4-02–P4-07 |
| Draft persistence and editable reopen | P2-04, P1-07, P7-03–P7-04, Q13 |
| Label repetition, option codes, missing answers | P2-06–P2-08, Q09 |
| Participant-language UI and demographics | P2 language contribution; R1-03 downstream behavior |
| Runner scoring/recording and LSL ownership | P3-06–P3-07, R1-04–R1-06, Q07/Q09 |
| Remaining physical/accessibility qualification | R1-07 and `30-TESTING-AND-RELEASE.md` |

The bullets below are historical issue descriptions. Their current resolution
is determined by the linked central capability and evidence, not by editing
another duplicate checkbox here.

These notes record product gaps and questions discovered while simplifying
Designer Section 2 on 2026-09-11. The researcher explicitly excluded the
Experiment Runner and other sections from that historical pass. Descriptions
below are not implementation permission, passing evidence or amendments to
historical schemas. Read the charter amendment and central catalogue before
the next bounded pass; keep capability status in `60-SEGMENT-CATALOGUE.md` and
attach concrete receipts in `40-ROADMAP.md` when resolving an item.

## Designer completion and other sections

- **Make the two applet roles clear in navigation and completion.** The
  target is Designer UI → one finished unified experiment JSON → Runner
  acquisition/monitoring. Review the current load/import/preflight/Start-heavy
  flow so creating a study does not depend on externally authored
  `experiment.json` or an existing package. Provide an explicit final design
  output action and a distinct finished-package intake in the Runner without
  adding a third mode or exposing raw JSON editing.
- **Make video-library and manual-plan authoring possible through UI.**
  Current Section 3/4 documentation and implementation have transitional
  load/read-only plan controls. Researchers need to define the video library,
  blocks, participant schedules, and exact per-video ISIs in the Designer.
  Preserve explicit authored order, safe closed asset identities, and the
  existing no-randomization rule; do not invent allocation methods or silently
  fill package fields from ambient state.
- **Decide which feedback-design controls become runnable.** The current
  Flubber/Grid/procedural-Face selector, halo-size draft, and continuous/
  stepwise timing/hold controls are deliberately preview-only and absent from
  the package. A future pass must define the desired product behavior, version
  the owning contracts, provide browser/Rust parity, and verify persistence,
  hashes, input/timing, rendering, recovery, and accessibility before claiming
  the saved experiment uses those choices.
- **Review authoring-draft persistence and save/reopen semantics.** Confirm
  what happens to unsaved Section 2 edits when a researcher closes/reloads or
  loads another design. Keep invalid/unsaved variants visibly pending and block
  final package creation. Never reuse a stale accepted definition after edits;
  count an asset as saved only after the owning workspace operation returns a
  validated receipt. Do not treat transient editor state as runtime authority.

## Questionnaires, language, and future Runner work

- **Persist and execute questionnaire label repetition through an explicit
  versioned contract.** Section 2 can preview answer labels above every item,
  every 5 items, or every 10 items, but v1 has no presentation field for this.
  Decide the package/settings/questionnaire presentation owner and migration,
  add exact browser/Rust fixtures, and implement an accessible participant
  renderer that retains question/option associations, keyboard operation,
  focus, reflow, and non-color meaning. Until then this remains labelled
  preview state and must not affect Runner behavior or current package hashes.
- **Review optional-item output semantics.** The current single-choice
  answer validator omits unanswered optional items from response rows rather
  than writing a blank row. Decide whether analysis needs explicit missing-
  response rows, and document/version any changed output, completion, draft,
  recovery, and browser/Rust semantics. Do not alter this during Section 2
  authoring work.
- **Keep option count distinct from response cardinality.** The existing
  contract accepts one option ID per item. Numeric coding uses the existing
  nullable `scoreValue`, while `label` is participant-visible and `optionId`
  is stable identity. If multi-select or a configurable number of permitted
  selections is later wanted, define a separate versioned answer/record
  contract; never reinterpret the current scalar answer or infer scoring.
- **Qualify custom coding in the participant-to-output workflow.** On the
  eventual Runner pass, verify that a choice displays its authored label and
  writes the exact frozen option ID and `scoreValue`, including reverse-coded
  values, null scoring, required and optional items, interrupted drafts, and
  CSV/TSV exports. Section 2 authoring tests alone are not this end-to-end
  acquisition evidence.
- **Localize the fixed demographics and participant instructions.** Exact
  questionnaire coverage does not establish language coverage for names/age/
  gender/handedness prompts, validation messages, navigation, or other
  participant UI. Preserve transient raw-name/self-description handling and
  the closed persisted demographics contract; no translation should silently
  change response meanings.
- **Complete TAS-20 English/German preload provenance if appropriate.**
  The English researcher-supplied fixture is retained in source but excluded
  from distributions; no German asset is bundled. Obtain/record applicable
  reuse permission and exact authorized language assets before enabling
  preloads. Preserve wording, coding, attribution, and source receipts; do not
  infer TAS scoring, subscales, diagnostic thresholds, or permission from
  source-tree presence. MAIA-2 remains the currently authorized EN/DE preload.

## Acquisition outputs and qualification

- **Clarify “LSL file with markers” before implementation.** Current Windows
  LSL support emits a regular state stream and an irregular semantic marker
  stream; it is not an in-app LSL/XDF file writer. A future Runner pass should
  document independent LabRecorder/XDF capture versus any proposed owned
  recording feature, define file ownership/paths, and qualify the chosen
  receiver. Preserve the existing prohibition on questionnaire prompts/answers
  in marker payloads. CSV/TSV response/rating tables and local event/manifest
  evidence remain separate outputs.
- **Finish the existing native-media and installed-workflow gates.** The
  GstPlay actor and two approved FFI adapters are present, but safe installed
  pre-main DLL loading, redistribution/corresponding-source closure, supported
  codec/container evidence, DPI/audio/lifecycle/recovery tests, and visible
  long-run qualification remain open. Keep native Start fail-closed and
  interface-only artifacts unqualified until roadmap gates pass.
- **Finish acquisition qualification on each active target.** Use exact
  Windows Tauri, current desktop Chrome, and current desktop Edge candidates
  for full workflow, independent-instance decoding/reproduction, physical
  input, timing, durability/adversity, accessibility, and independent LSL
  evidence as applicable. No Section 2 UI/build/test receipt closes those
  existing gates.
