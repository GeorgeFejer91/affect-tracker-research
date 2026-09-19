# Affect Research agent entrypoint

Read [`for-ai/00-READ-FIRST.md`](./for-ai/00-READ-FIRST.md). Those two files are
the whole mandatory route; read further documents only when your task touches
them. After reading them, follow any more specific `AGENTS.md` in the subtree
you are changing. Direct session instructions take precedence.

## Task routing

| Working on | Also read |
| --- | --- |
| Any UI text, styling, responsive component or SVG icon | [`for-ai/25-UI-LAYOUT.md`](./for-ai/25-UI-LAYOUT.md): Pretext-based font-to-box fitting and container-relative geometry |
| Planner authoring, Open/Save, preview | [`for-ai/60-SEGMENT-CATALOGUE.md`](./for-ai/60-SEGMENT-CATALOGUE.md), the relevant `docs/planner-*.md` |
| Planner CLI | [`docs/planner-cli.md`](./docs/planner-cli.md), [`docs/planner-cli-library.md`](./docs/planner-cli-library.md) |
| Runner execution, recording, browser path | [`for-ai/65-RUNNER-SEGMENTS.md`](./for-ai/65-RUNNER-SEGMENTS.md), [`docs/runner-*.md`](./docs) |
| Saved-file formats and version support | [`for-ai/66-COMPATIBILITY.md`](./for-ai/66-COMPATIBILITY.md) |
| Module boundaries, native authority | [`for-ai/20-ARCHITECTURE.md`](./for-ai/20-ARCHITECTURE.md) |
| Product scope, delivery surfaces, package authority | [`for-ai/10-PRODUCT.md`](./for-ai/10-PRODUCT.md) |
| Questionnaire content, citations, licences | [`for-ai/70-RESEARCH-PROVENANCE.md`](./for-ai/70-RESEARCH-PROVENANCE.md) |
| Layout and geometry | [`docs/planner-p4-layout-contract.md`](./docs/planner-p4-layout-contract.md), [`docs/controlled-video-geometry-v3.md`](./docs/controlled-video-geometry-v3.md) |

## Invariants

1. **Planner and Runner stay separate programs.** Planner authors and reopens;
   Runner executes and records.
2. **Video playback is HTML video.** Useful observed start/end events, no
   frame-accurate or physical display-onset guarantee. Do not restore the
   retired native player stack, its runtime staging, or new unsafe media
   adapters.
3. **Be honest about capability.** The browser path has no LSL, no XDF, no
   native input and no native timing authority, and must not imply otherwise.
4. **Never silently change experiment semantics.** Sampling rate, input
   mappings, sequence order, questionnaire meaning, recording requirements and
   authored layout are the researcher's decisions. Reject an unsupported
   setting explicitly instead of substituting a default.
5. **Never lose data.** Partial results must stay recoverable and must be
   labelled incomplete. Open never silently upgrades a historical saved file.
   Do not publish participant data or personal identifiers.
6. **Preserve scientific material.** References, questionnaire provenance,
   licences and attribution are not cleanup targets.
7. **Keep the tree parsimonious.** Update the current authority in place. Do not
   add backup copies, parallel ledgers, superseded architectures, or new `vN`
   document generations for ordinary internal iteration. Git history is the
   archive.
8. **Confined native access.** Raw `invoke(` stays in the named native adapter
   modules; project-authored `unsafe` stays absent.

## Working rules

- Use [Ponytail's upstream skill](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md) for every implementation, fix, refactor and code review. Load it through the normal skill mechanism, or read and apply the actual `SKILL.md`; do not invent an invocation or build skill-management infrastructure. Reuse existing code and native platform features, preserving correctness, accessibility and research semantics.
- For all UI work, follow [`25-UI-LAYOUT.md`](./for-ai/25-UI-LAYOUT.md). CSS defines the available box; measured text sizing and container-relative SVG geometry adapt within it. Do not replace this with per-element font/offset patches or clipping essential text.
- Make changes in small increments that build and test.
- Run focused checks as you go and the applicable full checks before handing
  off; see [`for-ai/00-READ-FIRST.md`](./for-ai/00-READ-FIRST.md) §3.
- Branch for the change; do not force-push and do not push to `main`.
- Distinguish pre-existing failures from new regressions, and say which
  verification you could not run.
