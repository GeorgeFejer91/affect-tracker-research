# ChatDev 2.0 development workflow

The researcher authorized ChatDev 2.0 integration on 2026-10-05 to make
development steps more clearly compartmentalized. The exact pre-integration
GitHub checkpoint is tag `pre-chatdev-2026-10-05` at
`058694cab918ed9b2e7a65cf1421182124a7f632`.

## Default in Codex

Use the project [Codex development team skill](skills/affect-chatdev-codex/SKILL.md)
for requested parallel Planner/Runner work. Codex directly delegates independent
owner and verification roles, exchanges labeled messages at barriers, and keeps
root integration authority. It uses the current Codex session and needs no
separate ChatDev installation or model API key. A small single-segment pass can
still follow [50](50-AGENT-WORKFLOW.md) directly. The YAML graphs below are an
optional way to run the same role pattern in ChatDev 2.0 outside Codex.

This is an optional development tool. The first companion app change is a
separate Runner R1/RR-03 and RR-10 pass on
`codex/segment-r1-plan-immutability`: a plan-immutability guard in
`runner/src/master-recipe.js`, with a focused regression in
`test/research-runner-master.test.js`. It does not close native playback or
installed qualification. The
canonical charter, segment catalogue, strict readers and release gates remain
authoritative. Root remains the single repository integration and release owner
under [72](72-RUNNER-FINAL-VALIDATION.md). ChatDev agents work on frozen copies
in their session workspace and may only propose a patch. They cannot mark a
segment complete, merge, push, change the current app or qualify a run.

## Compartments and assets

The [ChatDev workflow](../chatdev/affect-research-development.yaml) has two
parallel rounds with explicit message barriers:

1. **Scope** sets one segment, checklist IDs, allowed files and stage evidence.
2. **SourceRecon** and **GateRecon** run in parallel, inspecting source/tests and
   contracts/gates independently.
3. **Synthesis** receives both labeled messages and broadcasts one bounded
   brief to **Draft**, the sole initial patch writer.
4. **CodeReview** and **ContractReview** run in parallel on `proposal.patch`.
5. **Revision** receives both labeled reviews, responds to each finding and
   updates the proposal when supported. **Handoff** reports the final result.

Each join must find both expected labels or report `BLOCKED`. ChatDev 2.0's
edges deliver completed messages at barriers; agents do not have a live peer
chat while running concurrently. Parallel agents never write the same file.

For a task that explicitly allocates one Planner segment and one Runner seam,
the [cross-app workflow](../chatdev/affect-research-cross-app.yaml) runs the
Planner and Runner owners in parallel. Their separate `planner.patch` and
`runner.patch` meet at **CompatibilitySync**. Four independent agents then
review the proposals in parallel:

| Agent | Responsibility and evidence |
| --- | --- |
| **UIVerifier** | Visible controls, state, accessibility and required rendered/installed observations |
| **FunctionVerifier** | Inputs, validation, strict readers, deterministic behavior, tests and producer/consumer parity |
| **RecordingGate** | Runner-owned LSL/XDF, timestamp, privacy, recovery and physical recording gates |
| **PackagingGate** | Separate apps, Windows installer, Chrome/Edge delivery, native runtime provenance and release claims |

These agents inspect proposals and existing receipts. Root alone owns the
current installed validation, packaging acceptance and release claim.

PlannerRevision and RunnerRevision each receive all four labeled verdicts and
revise only their own proposal. IntegrationReview checks both resulting patches
and the shared contract; Handoff reports what the root owner can apply and
verify. A missing role output or an unsupported contract is a blocked handoff.
This graph coordinates two separately allocated segment passes. It does not
grant a Planner owner access to Runner files or combine their branches before
root integration.

The [context exporter](../scripts/chatdev-workflow.mjs) accepts one P1–P7, R1,
`contracts` or `integration` compartment, or `joint` for the cross-app graph.
It stages complete current core
guidance (`AGENTS.md`, 00/15/16/30/50/60/66), roadmap, message board, the
[compartment catalog](../docs/compartment-catalog.md), and matching owner
contracts. The caller names the exact source and test files needed for the
pass. It accepts tracked UTF-8 text files only and records their SHA-256 hashes,
source paths and Git commit in `manifest.json`. `SESSION.md` maps the unique
staged input names back to repository paths. The [launcher](../chatdev/run_segment.py)
copies these files into the ChatDev session workspace for on-demand reads and
sends only `SESSION.md` as the initial prompt. This avoids inlining the large
core documents into one model request. This is a snapshot, not a second
schema or copied source authority.

Selected project inputs must be tracked UTF-8 text; video and other binary
assets are rejected. Keep participant output and private questionnaire source
material out of the task file and selected inputs. A task requiring those needs
its owner's specific authorization and a separate evidence path. Real
experiments remain under the existing Runner and qualification workflow.

## Use the optional ChatDev runner

Install ChatDev 2.0 separately from its official repository and set
`CHATDEV_HOME` to that checkout. This workflow was schema-checked against
ChatDev tag `v2.2.0` (`3c72d860d2553f05129b7dff0fd4efdde5b01d2f`).
Set `API_KEY` and `CHATDEV_MODEL` in the private process environment; the
workflow uses ChatDev's OpenAI provider. These credentials never belong in a
task file, source bundle or Git commit.

From this repository, for example:

```powershell
node scripts/chatdev-workflow.mjs check
node scripts/chatdev-workflow.mjs prepare P5 C:\temp\affect-p5-pass chatdev\example-task.md site\src\research\feedback-settings.js
node scripts/chatdev-workflow.mjs run P5 C:\temp\affect-p5-live chatdev\example-task.md site\src\research\feedback-settings.js
```

For a joint pass, use `joint` as the segment and provide a task file that names
the Planner P1–P7 and Runner R1/RR checklist IDs, allowed source paths, shared
contract and separate patch goals. Name source and tests from both apps after
the task file. For example:

```powershell
node scripts/chatdev-workflow.mjs prepare joint C:\temp\affect-joint-pass C:\temp\joint-task.md site\src\research\feedback-settings.js runner\src\recipe.js test\research-runner-master.test.js
```

This preparation command does not launch agents. A live run uses `run joint`
with a new output directory and the same task/source arguments.

Each output directory must be new and outside the repository. `prepare`
creates the frozen context bundle without calling a model. `run` creates a
new bundle and invokes ChatDev through its local graph executor. The model
workflow needs a functioning ChatDev installation and configured API access;
the local `check` and `prepare` commands do not call a model. Select source and
test files for the actual bounded pass rather than relying on an agent to infer
the whole repository from documentation.

Before integrating a ChatDev proposal, the root owner checks the source commit
and every attached file hash, verifies the allowed paths and current diff, runs
`git apply --check` in that pass's isolated worktree, reviews the patch, then
applies it and runs the stage's focused and cross-layer checks. Any changed
contract, native authority, release behavior or platform claim follows the
stricter project stage and gate in [30](30-TESTING-AND-RELEASE.md) and
[50](50-AGENT-WORKFLOW.md). ChatDev's review text is never a test receipt.

## Current verification

The workflow YAML parses and passes the ChatDev v2.2.0 `DesignConfig` schema
with its registered agent and edge-condition types. The exporter checks its
source map against tracked files, and the launcher validates copied hashes.
A model-powered ChatDev run has not been performed in this pass. The Runner
immutability change was made and tested directly in its separate R1 worktree,
not generated by ChatDev. Installed Runner qualification remains open.
