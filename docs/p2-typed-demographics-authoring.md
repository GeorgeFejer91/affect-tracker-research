# P2 typed demographics authoring

Backend Verification, P2 / E2E-DEMOGRAPHICS. This owner implementation extends
the [frozen contract](demographics-form-contract-v1.md) on Main's agreed
`e439018b81a5eea26b72551d651eadc7669471cd` base. It adds production JavaScript
validation, exact public EN/DE assets, mixed P2 v2 contribution validation and
the existing editor/shared CLI owner path. Main retains app capture/restore,
native persistence and Rust/master dispatch; Runner retains execution/answers.

## Source and APIs

- `form-definition.js`: strict `validateFormDefinitionV1`, asynchronous
  `verifyFormDefinitionV1`, `createFormDefinitionV1`, explicit `verifyP2Definition`
  and client-only `validateFormAnswers`. The validator is the standalone
  `ffe11d8` handoff. No latency or native submission authority lives in JS.
- `form-assets.js`: `loadDemographicsForm(language)` verifies the fixed public
  definition identity/hash. The EN/DE JSONs under
  `site/assets/questionnaires/demographics/` match the frozen fixture bytes.
  Static Pages copies and allowlists precisely these two assets; the desktop
  bundle imports the same JSON. Restricted TAS sources are unchanged.
- `form-sheet.js`: explicit `kind: "form"` branch in the existing editor's
  sheet state; typed source compilation returns canonical JSON plus one LF.
  Legacy sheets retain their original converter/provenance. `form-sheet-view.js`
  renders and edits typed fields and an inert preview using the existing CSS.
- `questionnaire-recipe-v2.js`: `validateQuestionnaireRecipeContributionV2`,
  `restoreQuestionnaireAuthoringV2`, `createQuestionnairePresentationV2`,
  `validateQuestionnairePresentationV2`, `compilePlannerQuestionnaireRoutesV2`
  and new `verifySupportedQuestionnaireRecipeContribution`. The old generic
  `validateQuestionnaireRecipeContribution` and every v1 entrypoint remain
  strictly v1. Main must opt into new dispatch only on explicit master v2 paths.

The routes compiler takes the **complete P2 v2 contribution**, including
presentation. It returns `{contribution,routes}`; each route has existing
languageId/languageTag/optionIds and ordered beforeSession/afterSession entries
`{module,definition,presentation}`. IDs/hash/language coverage are checked across
both definition kinds; typed forms never enter the legacy definition validator.

## UI and CLI correspondence

The existing routing editor adds **Add demographics**. Its handler emits the
same shared-session edit as CLI:

```json
{"kind":"apply","edits":[{"kind":"operation","owner":"P2","operation":"addDemographics","arguments":{}}]}
```

Use the normal session/revision/request envelope. This adds one draft per
selected EN/DE language and prepends the family in the editor. It does not save,
accept or create modules. Existing `addQuestionnaire` is the legacy ingress and
rejects the reserved demographics family; use the explicit operation above.
Unsupported languages reject without an English fallback or partial mutation.
The shipped operation is EN/DE only. Main's direct language-picker composition
must retain an explicit coverage/unsupported-language error when adding another
language to that family, not fabricate a translation.

Read `P2.questionnaires` to obtain actual identities. A form draft has exactly
`kind`, `familyId`, `language`, `questionnaireId`, `questionnaireVersion`, `title`,
`provenance`, `items`. Items use the frozen typed-definition item shape. Invalid
raw UI values are projected in readback with `invalid_draft` issues; they cannot
be saved. Typed CLI operations reject invalid branch/type/bound changes atomically.

| Operation or setting | Actual editor control | Effect |
| --- | --- | --- |
| `addDemographics {}` | Add demographics in routing panel | EN/DE drafts in the same editor |
| `updateForm {questionnaireId,changes}` | Form title/version | Changes title/version; provenance can be supplied by full typed authoring |
| `setFormItem {questionnaireId,itemId,item}` | Prompt, type, required metadata, byte/year limits and option ID/label/actions | Validated item replacement retaining its identity |
| `reorderItems {questionnaireId,itemIds}` | Move field up/down | Stable IDs, contiguous new item orders |
| Existing remove/family move controls | Remove questionnaire / Move questionnaire | Reuses existing parent owner callbacks |
| `P2.presentation` | Typed form presentation | `{kind:"fields",questionnaireId}`; no fabricated label repetition |
| Existing modules/languageSelection | Routing editor module and language lists | Same mixed definition/module order, no extra route store |

`P2.questionnaires` continues to accept the complete detached typed/legacy draft
array. `P2.acceptedDefinitions` stays read-only. New operations stage detached
values and perform no source writes; all owner commits precede rendering.
No participant/variant allocation is added.

## Save and Main integration

Use existing `perform saveQuestionnaire` with `{questionnaireId}` for each
actual returned ID. `saveAuthoringQuestionnaire` invokes the existing `onSave`
callback with familyId/language/definition/sourceBytes/expectedPresetToken and
the additional discriminator `sourceFormat: "formDefinitionV1"` only for typed
forms. Bytes are exact canonical JSON + LF; no CSV authoring receipt is invented.
Legacy callback behavior is unchanged. Main approved mapping this discriminator
to native workspace format `json` after strict typed validation and retaining
the actual storage receipt. Saving by itself never confirms a segment.

Main must create/update modules only through its existing guarded adoption,
then route each EN/DE terminal path explicitly as demographics, MAIA-2, TAS-20.
Use returned module IDs, not guessed names. `getPresentation(definitions)`
returns presentation v2 when any typed form is present; `restorePresentation`
dispatches explicitly by version. The P2 v2 validator and routes compiler are
ready for Main's v2 capture/export/restore. Current Main v1 compilation must
remain rejecting until that integration is installed.

The editor now exposes asynchronous
`prepareAuthoringQuestionnaireSave(questionnaireId, {isCurrent, signal})`.
Preparation is read-only and returns a detached `payload`, pure `isCurrent()`,
synchronous state-only `commit(sourceReceipt)`, and once-only projection
`afterCommit()`. Each payload access copies definition, bytes, and authoring
receipt while retaining the expected preset token. Legacy absent source bytes
remain null; existing bytes and typed canonical JSON bytes remain exact.

Main owns native storage and definition/module adoption. Its consequential
coordinator must write storage, verify currentness, then publish its adoption
and the prepared state commit, followed by projection. Preparation never calls
storage or adopts modules. Cancellation, replacement, edits, lock/busy changes,
and source-byte changes invalidate the preparation. A completed storage receipt
must be retained if publication becomes stale. Normal editor save reuses this
same converter/preparation before its existing onSave callback and commit.

Prepared-save follow-up validation: 920 Research tests pass, including detached
payloads, no preparation side effects, synchronous/idempotent commit,
cancellation/edit/reset fencing, identical normal-save bytes, and existing
legacy save/cancellation receipt checks. Evidence is in
`D:/GitHub/.affect-checks/p2-typed/prepared-save-regression-final.log`.
This is owner-level evidence; Main's native coordinator remains separately owned.

## Evidence and limits

The pre-edit fixture/legacy owner baseline passed 15 tests. Production validators
have focused fixture/hash, malformed type/Unicode/bounds/duplicate identity,
mandatory completion and partial-answer tests. Partial empty/whitespace text is
retained exactly with `complete:false` and that item in `missingRequired`;
submitted answers require all displayed items regardless `required` metadata.
All other invalid typed values reject even partial validation.

The Research regression run passed 915 tests before the final raw-draft projection
addition; the final scoped/regression receipt records the latest count separately.
Desktop 11-file and static Pages 256-file builds passed with the existing chunk
size advisory. Actual Chrome and Edge component checks exercise the routing
button through the real shared JS session, UI fields, typed CLI correspondence,
invalid-field save rejection, equal P2 v2 save content and both language previews.
The fixture source-save callback is explicitly synthetic; native persistence,
whole-app master integration, actual native CLI and Runner/XDF execution remain
Main/Runner evidence. The first Edge file-URL harness returned no DOM; the
HTTP receipt/PNG harness succeeds and retains both outcomes.

Evidence root: `D:/GitHub/.affect-checks/p2-typed/`. The new
`scripts/qualification/p2-typed-rendered.mjs` is a test-only loopback HTTP harness
using isolated browser profiles and exact source/image hashes. It introduces no
product listener or foreground interaction. Screenshots are visually reviewed;
the editor/preview use ordinary DOM-managed scrolling/reflow, not Pretext.

Root/Online must refresh the maintained public CLI inventory from the integrated
descriptors. No public deployment or native/participant qualification is claimed
by this owner handoff.

