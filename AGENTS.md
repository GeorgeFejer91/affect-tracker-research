# Affect Research agent entrypoint

The 2026-10-06 user amendment expands Windows delivery to four separate
installers: Experiment Planner, standard Experiment Runner, VLC-based Experiment
Runner (the Flubber VLC player), and same-PC FlubberRecorder. FlubberRecorder's
installer also obtains the separately installable Flubber VLC player. Both
Runner variants must consume the same Planner recipe and preserve the same
Runner-owned recording gates, outbound LSL, and XDF evidence contract. See
[`for-ai/16-COMPANION-APP-BOUNDARY.md`](./for-ai/16-COMPANION-APP-BOUNDARY.md).
The 2026-10-06 playback amendment removes GStreamer from active source, builds,
packaging, and qualification. Standard Runner uses Windows WebView video;
Flubber VLC Runner uses its separate VLC player. Both remain unqualified until
their own installed playback, timing, LSL, and XDF gates pass. Older GStreamer
instructions below are historical and do not authorize restoring it. No VLC or
remote release qualification is inferred from historical sidequest builds.

The 2026-09-12 user amendment requires two separate companion programs. Read
[`for-ai/16-COMPANION-APP-BOUNDARY.md`](./for-ai/16-COMPANION-APP-BOUNDARY.md).
Planner authors JSON and retains Flubber previews. Runner alone executes, plays
participant video, emits LSL and records own/selected external streams to XDF.
Recording policy belongs to Runner sessions. Runner-only agents use
[`for-ai/65-RUNNER-SEGMENTS.md`](./for-ai/65-RUNNER-SEGMENTS.md); both apps use
[`for-ai/66-PLANNER-RUNNER-COMPATIBILITY.md`](./for-ai/66-PLANNER-RUNNER-COMPATIBILITY.md).
This supersedes earlier single-executable/two-mode and blanket Runner-deferral
text below. Planner completion does not wait for final runtime correspondence.
Consult the **Chat Orchestrator** task for uncertain ownership or contracts.

Before project work, follow the ordered core reading and owner-specific routes
in [`for-ai/00-READ-FIRST.md`](./for-ai/00-READ-FIRST.md). Read matching ownership
entries before editing; historical receipts are consulted for relevant evidence,
not reread in full for every pass. Direct session instructions take precedence.

Before mutating work in each new development pass, follow the intent check and
three-stage verification workflow in
[`for-ai/50-AGENT-WORKFLOW.md`](./for-ai/50-AGENT-WORKFLOW.md). Infer and state
the pass goal, stage, bounded deliverable, evidence to collect now, and work
being deferred. Ask the user to confirm that best guess unless the current
request clearly states those points or is an in-scope follow-up within an
already confirmed stage. Ask again only when the goal, stage, target, intended
claim, or scope is materially ambiguous or changes. These development stages
are agent workflow labels, not additional application modes, and never waive
the claim-specific gates in
[`for-ai/30-TESTING-AND-RELEASE.md`](./for-ai/30-TESTING-AND-RELEASE.md).

[`for-ai/15-RESEARCH-V1-CHARTER.md`](./for-ai/15-RESEARCH-V1-CHARTER.md), including
its dated final-state amendment, is the product and architecture authority.
It delegates final-state segment requirements and capability completion to
[`for-ai/60-SEGMENT-CATALOGUE.md`](./for-ai/60-SEGMENT-CATALOGUE.md).
Every implementation pass must name its assigned P1–P7/R1 segment and checklist
IDs, compare intended function/inputs/JSON contribution with verified current
source, and work only on that segment's remaining items and named shared seams.
Read the wider map for context; route other-segment gaps to their owners.
Baseline Planner authoring is complete; CLI/SurveyJS extend that baseline.
Planner–Runner correspondence is allocated under `for-ai/69` and `for-ai/72`.
Use `for-ai/66-PLANNER-RUNNER-COMPATIBILITY.md` for current version support and
open consumer gaps. The two programs serve **Setting Up the Experiment** and
**Running the Experiment**, respectively.
Only Tauri on Windows and the static application in current desktop Chrome and
Edge are active-v1 qualification targets. Optional world-fixed XR authoring is
an accepted final-state roadmap target, not current runtime support.

The feature-rich WebXR/Quest, remote, Party/Ground Control, direct Polar,
Face/Photoatlas, Touch, and presentation experiments are not active source or
requirements. Their complete Git history is preserved in
[`GeorgeFejer91/affect-tracker-playground`](https://github.com/GeorgeFejer91/affect-tracker-playground)
and in this repository's immutable checkpoint/history refs. Do not restore or
reactivate them without an explicit charter change.

Windows qualified local/repository playback now targets a fenced WebView video
path for standard Runner, with Rust retaining experiment, sampling, LSL, and
XDF authority. The separate Flubber VLC Runner must meet the same Runner
contract with its VLC playback path.
Consult [`for-ai/40-ROADMAP.md`](./for-ai/40-ROADMAP.md) before making any
implementation claim: runtime verification and a fail-closed capability are not
evidence that the native player actor or playback qualification exists.
The two contained Windows FFI adapters were approved on 2026-09-10; their
focused audit and installed qualification remain open. Adding another unsafe
boundary requires explicit user approval and audited window/thread/lifecycle
invariants.

Each implementation pass owns one allocated segment. Follow the separate-branch,
isolated-worktree, and unified-integration rules in `for-ai/50-AGENT-WORKFLOW.md`.
For requested parallel or cross-app development, use the project
[`Codex development team` skill](./for-ai/skills/affect-chatdev-codex/SKILL.md)
to delegate Planner, Runner, and verification roles with explicit message
barriers. The ChatDev YAML runner is optional; Codex can coordinate these roles
directly without a separate model API key. This routing does not change segment
ownership or qualification gates.
Read matching entries and update `for-ai/55-AGENT-MESSAGE-BOARD.md` for ownership,
cross-segment suggestions, dependencies, and compatibility issues; messages never override
the user or charter. Do not edit another segment opportunistically.

Use the charter amendment and central roadmap to distinguish an intended future
capability from an unexpected mismatch. Preserve existing v1 readers/contracts;
new variant/allocation/layout/XR semantics require explicit versioned contracts
and applicable gates. Stop and identify an unapproved mismatch. Do not silently
broaden the qualified platform matrix, research data surface,
sampling or recovery semantics, native authority, accessibility obligations,
or outbound LSL contract. After reading `for-ai/`, follow any more-specific
`AGENTS.md` in the subtree being changed.
