# Demographics typed-form contract and fixtures

Status: agreed contract direction, fixture handoff only. No production reader,
editor, command, shipped picker or Runner support is implemented by this commit.
P2 / E2E-DEMOGRAPHICS, Backend Verification; Main and Runner agreed the version
chain before root allocated this bounded pass. Base:
`6098972554fef0a5bf24094188cdcada621c795a`.

## Authority and scope

[The user amendment](../for-ai/69-CLI-RUNNER-END-TO-END-GOAL.md) authorizes a
public project-authored English/German form for full name, whole-year age,
gender and handedness. These definitions are the intended source assets for
later integration, currently stored as small contract fixtures. They contain
no participant answers, validated-instrument translations, scoring, eligibility
rules or psychometric validation claim.

The Runner owner relayed this entire direct user message, dated 2026-09-12
(Europe/Berlin), in the **Experiment Runner** task
`01a0952f-be71-7652-b682-b5440bd615bf`:

> importantly, the questionnaire data is always mandatory to fill out, aprticipants cannot ever leave them empty!

The owner reported no exposed user-message ID. This quotation/date/task is the
available authority reference; no message ID is invented. Root and Main received
the clarification. It applies to all **new Runner submissions**, including old
package/master execution, not only master v2. Every displayed item must have a
valid answer before Submit; incomplete drafts may be retained while in progress
or interrupted. Preserve historical readers, historical artifacts and definition
`required` metadata. Submission policy must not rewrite source definitions or
make previously readable artifacts invalid.

## Explicit version dispatch

| Surface | New exact identifier | Compatibility |
| --- | --- | --- |
| Master | `affect-research-planner-recipe`, version `2` | Version 1 keeps its exact reader and accepted hashes |
| Master reproduction | `planner-recipe-reproduction-v3` | Only master v2; existing algorithms stay on v1 |
| Selection | `affect-research-planner-selection`, version `2` | Binds the new master and reproduction identities |
| P2 contribution | `affect-research-questionnaire-recipe-contribution`, version `2` | No typed definitions under contribution v1 |
| P2 algorithm | `questionnaire-hooks-v3` | Explicit mixed-definition dispatch |
| Typed definition | `affect-research-form-definition`, version `1` | New type, never decoded as QuestionnaireDefinitionV1 |
| Presentation | `affect-research-questionnaire-presentation`, version `2` | Exact entry discrimination described below |
| Runner result | `affect-runner-master-responses`, version `2` | Typed values; response v1 remains readable |

P2 v2 keeps the exact outer fields `schema`, `version`, `questionnaires`,
`languageSelection`, `presentation`. `questionnaires` keeps `algorithmVersion`,
`definitions`, `modules`. Each definition dispatches by its exact schema/version:
`affect-research-questionnaire-definition` with version 1, or the new typed
definition above. Do not use permissive untagged deserialization or shape guessing.
Reject unknown versions and fields before adoption; do not fall back to v1.

Legacy definitions retain every byte/field, source identity and hash. ModuleV2
retains its existing shape and `questionnaireId`/`definitionSha256` references.
Its IDs may reference either admitted definition kind in P2 v2 only. The existing
language tree and its ordered module ID lists remain the single route/order
authority; enforce ID uniqueness across both definition kinds, exact language
coverage and hash binding. Reuse only the supported `beforeSession` and
`afterSession` placements. No parallel typed-form route list is added.

## FormDefinitionV1 exact shape

The definition has exactly `schema`, `version`, `questionnaireId`,
`questionnaireVersion`, `title`, `language`, `provenance`, `items`,
`definitionSha256`. The existing reference field name `questionnaireId` is
deliberately retained for ModuleV2 compatibility; it does not imply a Likert form.

`provenance` has exactly these values for both shipped demographic definitions:

```json
{"kind":"projectAuthored","sourceId":"affect-research-demographics","sourceVersion":"1","validationStatus":"notValidated"}
```

This provenance is inside the definition hash. It describes project authorship,
not an imported instrument or an external source/license verification. No source
file self-hash is placed inside its own content. The external manifest binds the
exact file bytes. A later content revision must change source/version metadata
and hashes; never silently replace a frozen definition.

Each item has exactly `itemId`, `order`, `prompt`, `required`, `response`.
`required` is a boolean retained as authored metadata. Orders are integers equal
to their one-based array position. Each `response` is exactly one branch:

| `kind` | Remaining fields | Meaning |
| --- | --- | --- |
| `text` | `maxUtf8Bytes` | Integer 1–1024; the demographic limit is 1024 |
| `integer` | `min`, `max`, `unit` | Safe integers with 0 ≤ min ≤ max ≤ 9007199254740991; `unit` is `years` |
| `singleChoice` | `options` | Ordered nonempty array of exact `{optionId,order,label}` objects |

There are no scores, subscales, arbitrary patterns, coercion rules or alternate
branch fields. Age bounds are representation constraints, not adult eligibility
or a plausibility cutoff. Zero is valid; fractions, negative ages, booleans,
numeric strings and out-of-safe-range integers are invalid.

For implementation, bound typed definitions to 1–256 items and choices to 1–256
options per item, within the existing master 16 MiB/depth limits and P2's combined
256-definition/1024-module bounds. IDs are case-sensitive ASCII matching
`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`, unique in their owning list; `fullName` and
`preferNotToSay` retain their capitals. Definition version text is nonempty,
at most 120 Unicode scalars; title/prompt/option label are nonempty, at most
500/8000/2000 Unicode scalars respectively. Reject unpaired surrogates. Use the
existing explicit canonical language-tag grammar, never ambient locale. Do not
silently normalize or repair imported values.

The fixture family is `demographics`, with definition IDs `demographics-en` and
`demographics-de`, `questionnaireVersion: "1"`, and language `en`/`de`. Both use
the same ordered item IDs `fullName`, `age`, `gender`, `handedness`, all with
`required: true`. Choice identities and order are language independent:

| Item | Ordered option IDs |
| --- | --- |
| `gender` | `male`, `female`, `other`, `preferNotToSay` |
| `handedness` | `right`, `left`, `ambidextrous`, `preferNotToSay` |

The fixture bytes are authoritative for the agreed EN/DE labels. Selecting
`preferNotToSay` is a valid answer and satisfies completion. No free-text
follow-up is implied by `other`.

## Presentation and ordered mock

Presentation v2 has exactly `schema`, `version`, `definitions`. Every definition
has exactly one presentation entry in the same order, with its exact identity
and hash. The entries are a closed union:

```text
{kind:"likert", questionnaireId, definitionSha256, repeatLabelsEvery:1|5|10}
{kind:"fields", questionnaireId, definitionSha256}
```

`likert` is permitted only for legacy QuestionnaireDefinitionV1; `fields` only
for FormDefinitionV1. Text inputs must not acquire a fabricated label repetition.
Within each EN/DE terminal route, the mock's module order is demographics,
MAIA-2, TAS-20, all beforeSession. P3 then supplies named ISI 1750 ms, the exact
bound video, and named ISI 3213 ms. Those modules and the master are integration
artifacts, not fabricated by this fixture pass.

## Typed answers and participant identity

The new typed command member is exactly `{itemId,value}` with one value branch:

```text
{kind:"text", text:string}
{kind:"integer", integer:number}
{kind:"singleChoice", optionId:string}
```

Bind answers to the frozen current entry/module/definition before validation.
Duplicate or unknown items, wrong branches and undeclared options reject without
replacing accepted answers. Absence represents an unanswered draft item; empty
strings and null do not manufacture a valid answer. Text must contain at least
one non-whitespace Unicode scalar when submitted and fit the declared UTF-8
byte bound. Preserve entered text exactly, including surrounding whitespace;
do not trim, case-fold or normalize Unicode. No restrictive personal-name regex.
JS and Rust must use the same explicit whitespace set for this check:
U+0009–000D, U+0020, U+0085, U+00A0, U+1680, U+2000–200A, U+2028–2029,
U+202F, U+205F, U+3000 and U+FEFF. Do not depend on differing platform `trim` sets.

The result envelope v2 retains the existing envelope field names: `schema`,
`version`, `entryId`, `position`, `module`, `questionnaireId`,
`questionnaireVersion`, `definitionSha256`, `status`, `responses`. Status is
`draft` or `submitted`. For typed definitions each response has exactly `itemId`,
`itemOrder`, `value`, `responseLatencyMs`, plus `optionOrder` and `responseLabel`
only for `singleChoice`. Native code derives order/labels and latency from the
frozen definition and observation; the renderer supplies no scores or labels.
Legacy definition responses inside a v2 run retain their existing response
member fields, selected by the bound definition schema rather than heuristics.
Unknown response variants reject. The approved information envelope binds
recipe/run/attempt/participant/variant/language identities outside this payload.
Runner owns final command-envelope integration, observation timing and storage.

V2 Start carries `participantId` as participant identity, alongside its explicit
selector/workspace/input receipt/rerun parameters. It must not also request or
derive transient name/age/code preparation. Full name and age are answers in the
demographics form. They do not replace participantId, allocate a variant or name
output directories. V1 ingress/storage schemas remain separately dispatched.

## Canonical fixtures and verification contract

The [manifest](../test/fixtures/demographics-form-v1.manifest.json) binds both
fixtures. File bytes are existing `canonicalJson(definition)` encoded as UTF-8
without BOM plus exactly one LF. `definitionSha256` hashes canonical JSON after
omitting only the root `definitionSha256`, **without** final LF. `fileSha256`
hashes the complete file including LF. Arrays retain authored order; object keys
use the repository canonical owner. Hashes are lowercase SHA-256.

| Language | Bytes | Definition SHA-256 |
| --- | --- | --- |
| [EN](../test/fixtures/demographics-en-form-v1.canonical.json) | 1329 | `0e2432c8ab25ae487679e8326b32ae9695b4d92b778077396129a7a5a5f32c76` |
| [DE](../test/fixtures/demographics-de-form-v1.canonical.json) | 1359 | `96dbcaae0a354dc828ab92708d0aeecda4cf4d048de102609224be62ae7ab117` |

The focused fixture test verifies exact bytes/hash/shape/content, cross-language
IDs and explicit rejection by the unchanged legacy definition validator. It is
an independent fixture assertion, not a new production validator. No Rust
typed reader exists in this pass. Main's later native parity must deserialize
these exact files, validate all bounds/branches, reencode byte-for-byte and
produce both manifest hashes. Its unchanged v1 fixtures/hashes remain accepted.
Negative parity must include unknown fields/version/kind, surrogate errors,
unsafe integers/coercion, duplicate IDs/order, stale definition/presentation
hashes and language-route mismatch. Runner must cover partial/submitted answers,
mandatory completion for new executions, preserved historical readability,
text-byte limits and the shared whitespace set.

Observed in this pass: the pre-edit existing P2 canonical fixture baseline
passed (1 test); `node --test test/research-demographics-contract-fixtures.test.js`
passed all 4 focused tests, and `git diff --check` passed. No native build or
browser/runtime check was run for these data/documentation-only changes.

UI/CLI accepted-state parity, actual bilingual participant controls, native
answers and saved-XDF-only reconstruction remain required later evidence under
[69](../for-ai/69-CLI-RUNNER-END-TO-END-GOAL.md). No fixture check closes those gates.

## Owner handoff

This pass owns only this document, two fixture JSONs, their manifest, a focused
fixture test and the required uniquely named board entry. Root allocated the
scope; Main supplied the clean base and owns collection/future implementation
allocation. P2's later owner implements typed assets/validator/editor/CLI state;
Main owns bounded master dispatch/native P2 reader and composition; Runner owns
participant controls, ingress, responses, mandatory-submission policy and XDF.
Online/root retain public CLI documentation/authority updates. Keep version
dispatch in bounded modules; do not enlarge unrelated composition roots.
