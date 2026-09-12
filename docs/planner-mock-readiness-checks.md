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
