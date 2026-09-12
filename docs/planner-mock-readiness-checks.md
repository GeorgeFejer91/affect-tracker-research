# Production mock driver readiness checks

The external mock driver distinguishes a native operation's actual completion
and app adoption from remaining authoring work. Selecting a new empty workspace
can publish successfully while P1 reports `media_pending`. Intermediate P2
import/save can publish while other language drafts retain `unsaved_draft` or
`missing_language_asset`. Sequential imports may also retain `invalid_draft`
for the language slots not yet filled. The mock finishes every import before
its first questionnaire save, and never allows `invalid_draft` on any save or
confirmation. Only these exact owner/field/code combinations are allowed.
Projection, stale, unknown outcome and other failures reject.

Every external operation must retain its original public operation/request ID,
completed stage and acknowledged native receipt, and publish app state.
Confirmations check the requested segment's actual confirmation result.
Final master saves require `applied` without issues and the actual timestamped
basename/native byte/hash receipt. An incomplete final save never passes.

Programmatic `runPlannerCli` steps may supply synchronous `checkResponse` and
`until` functions. The former asserts on detached copies; the latter may repeat
only a fixed read-only query. Each attempt uses a fresh request ID and records
its exact response. Bounds are 1–100 queries with 10–1000 ms spacing. A failed
predicate at the bound stops the driver. No mutation is retried. The last valid
observed revision remains in the receipt even if semantic review fails.
JSON action-file callers remain data-only; no function is parsed or evaluated.

The mock queries whole owner snapshots after import, before confirmations and
after rescan. It requires verified P1 media, matching P3 annotations, matching
P4 reference geometry and no pending catalogue/feedback dependency. Before
confirmation it also requires the actual P4 fit projection without issues.
P6 dependency identity is checked if included; the requested mock excludes P6.
This observes existing public readback, without a new application wait API or
a guarantee against subsequent edits. Production revision/dependency guards
still reject later changes. Query spacing itself is not proof of readiness.

Focused checks use external subprocess framing with a synthetic child and
synthetic response/projection inputs. They verify the driver, not a production
mock. The actual clean CLI build, from-scratch import/export, GUI parity, Runner
playback, combined screenshots and XDF remain separate execution gates.

Source review and 15 focused checks passed. Review of the actual native-I/O
transcript at `D:/GitHub/.affect-checks/main-core9-native-io-run-05b8c18/`
confirmed that the unfilled English TAS slot reports `invalid_draft` while the
German source import is successfully acknowledged and published. That observed
intermediate result motivated the import-only exception above; it is not
evidence of a complete mock or permission to accept invalid final content.

On failure the driver closes stdin and waits up to ten seconds (or its shorter
configured timeout) for orderly EOF shutdown. The original failure, observed
revision and transcript remain authoritative even if the child exits with code
zero. No later command is sent. If the grace period expires, only the exact
spawned child is terminated. `failureCleanup` records EOF, the grace period and
any forced-termination request separately from the observed exit. A forced exit
does not establish native cleanup. Successful runs have `failureCleanup: null`.
Eighteen focused checks pass, including a termination-request error that cannot
replace the original failure or prevent its receipt from being written. S5's
independent source review found no remaining issues. These remain synthetic
subprocess checks; actual native cleanup requires its own execution receipt.

## Actual early-EOF observations — 2026-09-12

Root repeated the same deliberate external assertion immediately after a real
read-only snapshot with immutable native-enabled CLI builds `356cba7` and
`1ccd756`. Both preserved the assertion and revision zero, then exceeded the
unchanged ten-second EOF grace. The driver terminated only its own hidden child.
Neither result is an orderly-shutdown pass or evidence of an indefinite hang.

The phase-enabled `1ccd756ef4318a8b46e43ac12d64da885e7bd43b` executable has
SHA-256 `c341b79a3d83e164a757e55f209bc0190a0c610ca05b88f3025ee2e925248a4d`.
For owned PID 33296, EOF and cleanup began at 1000 ms, input cleanup completed
and native shutdown was requested at 1009 ms, and NativeStalled was observed at
6028 ms. Neither verification completion nor actor retention was observed before
termination. Source review shows runtime verification runs before the initializer
checks cancellation; the native owner has the bounded cancellation repair.

Evidence is retained in
`D:/GitHub/.affect-checks/root-native-cli-failure-cleanup-1ccd756-01/`, including
`cleanup-review.json`, the process receipt and phase log. Transcript SHA-256:
`c8223d542cdd361ade8b44cee526716f2509251398df11dea8b63a568d03da16`.
The external script is
`D:/GitHub/.affect-checks/root-native-cli-failure-cleanup-1ccd756-20260912.mjs`.
The earlier `356cba7` failure remains in its separate evidence directory.
No authoring mutation, import, video Prepare/Play, master export or Runner run
was performed in these root checks. A fresh immutable build must repeat this
case after the lifecycle repair; increasing the grace is not a repair.
