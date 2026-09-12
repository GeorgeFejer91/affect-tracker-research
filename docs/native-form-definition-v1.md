# Standalone native typed-form validator

P2 / E2E-DEMOGRAPHICS, Backend Verification. Main/root allocated this new-only
module from Main base `f3a2bc2`, using the frozen contract/fixtures `7da84a9`
and production JavaScript validator `ffe11d8`, subsequently corrected through
`aa8717b` for the frozen size/language bounds. Main owns lib/master/P2
composition; Runner owns participant controls, answers, submission and XDF.

`src-tauri/src/research_form_definition.rs` exports `FormDefinitionV1`,
`FormProvenanceV1`, `FormItemV1`, `FormResponseV1` and `FormOptionV1`. All public
fields and the three response variants match Main/Runner's agreed API. They
derive Clone/Serialize/Deserialize and retain closed camelCase JSON shapes.

```rust
pub fn decode_form_definition_v1(value: &serde_json::Value)
    -> ResearchResult<FormDefinitionV1>;
pub fn validate_form_definition_v1(definition: &FormDefinitionV1)
    -> ResearchResult<()>;
```

Both entrypoints enforce the complete new form contract, including the existing
`research_contracts::canonical_json` / `canonical_sha256` authority and exact
self-hash with only root `definitionSha256` omitted. Direct struct construction
does not bypass semantic validation. Deserialization alone establishes shape,
not validity: consumers must call one of these validated entrypoints.

Numeric deserialization accepts semantic whole numbers such as JSON `1.0` and
`1e0`; rejects negative zero, fractions, strings, booleans and unsafe integers;
and preserves Main's u8/u32/u64 public field types. No text trimming, Unicode
normalization, locale inference or scientific scoring is introduced. Valid
Unicode scalar bounds differ deliberately from the text-answer UTF-8 byte
limit. Definition text may contain whitespace; Runner owns nonblank answer
validation using the frozen explicit whitespace set. `required` remains source
metadata and is never rewritten to enforce Runner submission policy.

Standalone tests include the exact module and its existing contract/error owners
by path, so this handoff changes no shared lib registration or historical reader.
Run `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
--test research_form_definition`. Main registers the production module later;
Runner consumes `&FormResponseV1` directly instead of adding another JSON parser.

The frozen EN/DE definitions must reproduce exact canonical file bytes, final
LF, definition hashes and manifest file hashes. Focused malformed cases exercise
every closed object, missing keys, response branches, ordered unique IDs, type
coercion, negative zero, safe integer bounds, Unicode scalars, language grammar,
individual limits, aggregate 16 MiB size and stale hashes. Existing included
contract tests retain the historical fixture/reader checks.

`test/fixtures/form-definition-native-parity-v1.json` contains 62 vectors observed
against production JS `aa8717b`: 21 accepted and 41 rejected. Accepted
cases additionally bind the canonical file SHA-256. The reference source hash
is `add8d8f941666d57f33317185f8f40e377203261f09903e5f7832cf1174d26aa`;
the corpus records its full source commit and path. Numeric inputs are retained
as JSON text to preserve negative zero and whole-float spellings. The reference
uses the unchanged canonical/questionnaire dependencies from this base.

The external generator and logs are retained in
`D:/GitHub/.affect-checks/native-form-s4-20260912/`. Initial test invocation found
Cargo/rustfmt absent from PATH; process-scoped toolchain paths corrected that
without changing machine configuration. The final focused native suite passed
22/22, including all 62 JS-reference vectors (21 accepted / 41 rejected), both
frozen fixtures and the existing contract/error tests. Rustfmt and diff checks
passed. The build retained existing library/standalone unused-code warnings and
the existing bin/lib PDB filename collision warning; none was suppressed. No
broad native-feature, Clippy, browser, or runtime gate was run for this module.

This is typed-reader and canonical parity evidence only. Master v2 integration,
actual native CLI/UI authoring, Runner typed responses, participant execution,
and saved-XDF reconstruction remain separate owner gates.

Follow-up contract correction: the initial reference JS/native 4 MiB form cap
was narrower than frozen `7da84a9`'s 16 MiB master bound. Native now uses 16 MiB,
coordinated with S3's JS correction. The focused size regression accepts a valid
form larger than 4 MiB and rejects a form larger than 16 MiB whose individual
items/options still satisfy their bounds. The JS corpus does not assert the
superseded cap.

The corrected 22/22 suite passed again through an external standalone Cargo
harness including the exact same test/source paths and existing contract/error
owners. It used copied repository lockfile/dependency declarations plus explicit
`time/parsing` (normally enabled by app feature unification); the first minimal
harness build exposed that missing feature and is retained. Final log:
`D:/GitHub/.affect-checks/native-form-s4-20260912/cargo-cap-fix-final.log`.
No shared application build target was changed by this follow-up validation.

Language follow-up: match the existing questionnaire grammar's 80-character
maximum and reject `und` case-insensitively. Regenerated the pinned JS corpus
against `aa8717b`, adding `Und`/`uNd`, valid 80-character and invalid 81/83-character
tags, plus null item/option rejection. The historical generator/55-case results
remain in Git and external evidence. The corrected native suite passes 22/22;
`cargo-language-fix.log` and `generate-parity-language.mjs` in the same evidence
directory record the final comparison. Public types and the 16 MiB limit are
unchanged; no Runner integration or answer policy is added.
