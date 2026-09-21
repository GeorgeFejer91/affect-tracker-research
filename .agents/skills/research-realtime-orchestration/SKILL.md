---
name: research-realtime-orchestration
description: Design, implement, or review Affect Research realtime protocol orchestration and reconstructable experiment evidence. Use for Planner/Runner state machines, media or questionnaire lifecycle, Flubber sampling and neutral resets, semantic event logging, LSL/XDF projection, recovery, replay, or related UI logic; not for game creation or gamification.
---

# Research realtime orchestration

Use game-development patterns only where they improve deterministic interaction.
The product remains a research instrument: the native protocol, persistence, and
evidence contracts outrank the renderer, animation loop, and convenience event
systems.

## Read the owning contracts

Read the repository `AGENTS.md` and `for-ai/00-READ-FIRST.md` first. Then read:

- `for-ai/20-ARCHITECTURE.md` for authority, timing, and evidence boundaries;
- `for-ai/60-SEGMENT-CATALOGUE.md` plus the relevant `docs/planner-*.md` when
  changing authored event meaning or the recipe;
- `for-ai/65-RUNNER-SEGMENTS.md`, `for-ai/66-COMPATIBILITY.md`, and the relevant
  `docs/runner-*.md` when changing execution, recording, recovery, or readers;
- `for-ai/25-UI-LAYOUT.md` for any visible UI work.

Use Ponytail for code work. Extend the existing reducer, scheduler, journal,
media fencing, input normalization, and information-stream components before
adding an abstraction or dependency.

## Apply the useful game-development lessons

Treat these as design lenses, not product dependencies:

- **Simulation/render separation:** keep the authoritative protocol state and
  clocks outside DOM, canvas, WebGL, and animation-frame callbacks. Renderers
  consume snapshots and may be recreated.
- **Explicit action mapping:** normalize keyboard, pointer, and controller input
  into bounded semantic actions before the protocol consumes it. Preserve the
  original observation time and provenance.
- **Pure transitions plus effects:** prefer a reducer-shaped core that turns an
  accepted action and current state into the next state plus explicit effects.
  Effects perform media, persistence, LSL, and UI work through named adapters.
- **Generation fencing:** bind asynchronous media, form, and persistence results
  to run, attempt, occurrence, and operation generations so stale callbacks
  cannot advance the current protocol.
- **Deterministic playtests:** use fixed traces, clock-controlled tests, and
  state snapshots for transition coverage, then qualify the real installed app.
- **Input/UI gating:** dialogs and questionnaires explicitly suspend or redirect
  protocol input; focus and pointer capture never become hidden authority.

When the OpenAI Game Studio skills are available, use
[`web-game-foundations`](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/web-game-foundations/SKILL.md),
[`game-ui-frontend`](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/game-ui-frontend/SKILL.md),
and
[`game-playtest`](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/game-playtest/SKILL.md)
as optional reference passes for those concerns.
[`phaser-2d-game`](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/phaser-2d-game/SKILL.md)
may inform thin-scene and disposable-renderer structure, but do not add Phaser
or another engine merely to obtain that structure. Sprite, WebGL, and 3D asset
skills apply only when the user actually requests those visual assets or
surfaces.

## Keep three planes distinct

1. **Orchestration plane:** native authoritative phase, occurrence identity,
   monotonic deadlines, accepted input, and requested effects.
2. **Evidence plane:** versioned semantic events and continuous samples with
   sequence, identity, clock provenance, durability state, and LSL/XDF
   projections sufficient for independent reconstruction.
3. **Presentation plane:** DOM/video/Flubber/questionnaire views and status UI
   projected from state. Presentation callbacks report observations; they do
   not create scientific truth by themselves.

Do not add a second event bus, renderer-owned state machine, frame-loop sampler,
or UI-side evidence writer. A game engine's event emitter or save system is not
the research evidence plane.

## Design each operation as a reconstructable chain

For every scientifically meaningful operation, distinguish as applicable:

1. accepted command or physical input;
2. authoritative protocol transition;
3. effect request;
4. observed effect or explicit failure;
5. immutable semantic event/sample acceptance;
6. local durability and bounded flush state;
7. LSL information/marker or regular-state projection; and
8. terminal reconstruction and verification from XDF.

Do not collapse a Play request into observed video start, a timer deadline into
observed completion, a focused answer into a submitted answer, or a visual reset
into an accepted neutral state. Command acceptance, application, observation,
and durability are different facts.

Create one canonical event/sample envelope in the owning runtime and project it
to its permitted outputs. Do not independently synthesize local events and LSL
markers from separate UI handlers. Preserve separately named monotonic,
LSL-compatible, wall-clock, and media observation times; never substitute one
for another or infer a missing event from planned duration.

## Required domain coverage

- **Video:** occurrence-specific effect request, observed `playing`, observed
  `ended`, pause/buffering/error/interruption, and explicit failure. Acquisition
  boundaries follow the versioned contract, not animation frames.
- **Flubber/input:** continuous current and target values come from the owning
  scheduler and are the primary moment-to-moment outcome. Keep admitted raw
  input observations in a separate ordered artifact so device/UI behavior can
  be analysed without treating it as the rating series. Digital input edges
  also project one-for-one to bounded semantic events; high-rate continuous
  positions do not flood the marker stream. Input records retain physical
  observation time and separately named acceptance time. Every automatic,
  manual, or recovery neutral reset is an authoritative transition with reason,
  occurrence context, and a semantic event; later samples must reflect the
  neutral state. A renderer-only zeroing is a defect.
- **Questionnaires:** distinguish presentation, durable draft acceptance,
  validation rejection, durable submission, completion, interruption, and
  recovery. Store typed answers only through the approved privacy and
  information-stream contracts; bounded markers need not contain answer text.
- **Intervals and pauses:** mark actual start/end and any timing gap. Never emit
  catch-up samples or repair a trace from authored offsets. In the current
  desktop contract a paused video keeps the last committed affect coordinates
  visible and sampled, while input is quiescent and `input_active` is false;
  pause/resume markers delimit that frozen state. Do not silently turn pause
  into a neutral reset unless a later versioned research contract requires it.
- **Terminal and recovery:** completion, stop-early, write failure, quarantine,
  and resume lineage remain explicit and reconstructable. Partial evidence is
  retained and labelled incomplete.

Master1–5 and policy v1 remain frozen to active decoded-video sampling. Master6
and policy v2 explicitly select `activeVideoOnly` or `fullAttempt`; fresh
authoring may choose the latter, while opening an older recipe never upgrades
its meaning. In `fullAttempt`, start the native sampling clock only after the
attempt exists durably and startup/LSL preparation succeeds, then keep the
regular state stream active through the terminal boundary. Samples name their
phase and use neutral values while feedback is not presented; paused video is
the explicitly marked frozen-rating exception above. The browser
Runner must reject master6 execution because it has no native timing, input,
LSL/XDF, or desktop durability authority.

For master6, preserve three non-interchangeable local evidence layers:

- `master-samples.v2.jsonl`: the highest-detail Flubber/Grid affect outcome,
  including the no-catch-up schedule, phase, values, activity, and identity;
- `master-inputs.v2.jsonl`: every admitted digital or continuous observation,
  original observation time, acceptance time, and resulting affect state; and
- `master-events.v2.jsonl`: bounded lifecycle, digital-edge, neutral-reset,
  timing-gap, questionnaire, interval, and terminal events also eligible for
  the permitted LSL marker projection.

Append the canonical local event before its outbound LSL projection. A missing,
short, corrupt, reordered, or identity-mismatched artifact is incomplete
evidence; readers report that condition instead of reconstructing from render
state, planned durations, or another layer. The authored full-attempt storage
calculation is only a video-period lower bound when questionnaire, pause, and
interval duration are not known; the desktop Runner must fail closed on actual
write/finalization failures.

## Validation ladder

Use the cheapest evidence that can disprove the change, then climb only as far
as the claim requires:

1. pure reducer traces for legal/illegal transitions and stale generations;
2. clock-controlled scheduler tests, including missed slots and no catch-up;
3. JS/Rust contract and reconstruction parity where both are readers;
4. synthetic journal/LSL/XDF cases with gaps, duplicates, reordering, retries,
   neutral resets, and interrupted questionnaires;
5. built desktop Planner/Runner correspondence against one exact recipe;
6. installed Windows runs with real video, physical input, LSL capture, failure
   injection, and independent XDF-only reconstruction.

Parsing, mocks, screenshots, or synthetic streams do not qualify a real run.
Record the exact artifact, source identity, inputs, and limitations of each
receipt.

## Reject these transfers from game development

- gameplay loops or `requestAnimationFrame` as research clocks;
- entity-component systems, scene frameworks, physics, RNG, asset pipelines,
  or engine dependencies without a demonstrated product requirement;
- lossy analytics/telemetry in place of durable evidence;
- global event buses with unowned ordering or payloads;
- mutable save games in place of append-only attempt evidence;
- visual tween completion as proof of stimulus or state onset;
- internet synchronization, multiplayer, accounts, or remote control during
  the desktop-first completion phase.

For substantial architecture work, report the decision, scope/non-scope,
authority owner, interfaces, observability, validation, borrowed game-development
lesson, rejected overreach, and the smallest next implementation slice.
