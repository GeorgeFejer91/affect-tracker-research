# Standalone native typed-form validator

P2 / E2E-DEMOGRAPHICS, Backend Verification. Main/root allocated this new-only
module from Main base `f3a2bc2`, using the frozen contract/fixtures `7da84a9`
and production JavaScript validator `ffe11d8`. Main owns lib/master/P2
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
individual limits, aggregate 4 MiB size and stale hashes. Existing included
contract tests retain the historical fixture/reader checks.

`test/fixtures/form-definition-native-parity-v1.json` contains 55 vectors observed
against the pinned production JS verifier: 21 accepted and 34 rejected. Accepted
cases additionally bind the canonical file SHA-256. The reference source hash
is `f495bb7803b6d2b4888c7b01a3adfcd35be2c83b832ca427e4c7a925e165ebb4`;
the corpus records its full source commit and path. Numeric inputs are retained
as JSON text to preserve negative zero and whole-float spellings. The reference
uses the unchanged canonical/questionnaire dependencies from this base.

The external generator and logs are retained in
`D:/GitHub/.affect-checks/native-form-s4-20260912/`. Initial test invocation found
Cargo/rustfmt absent from PATH; process-scoped toolchain paths corrected that
without changing machine configuration. The final focused native suite passed
22/22, including all 55 JS-reference vectors (21 accepted / 34 rejected), both
frozen fixtures and the existing contract/error tests. Rustfmt and diff checks
passed. The build retained existing library/standalone unused-code warnings and
the existing bin/lib PDB filename collision warning; none was suppressed. No
broad native-feature, Clippy, browser, or runtime gate was run for this module.

This is typed-reader and canonical parity evidence only. Master v2 integration,
actual native CLI/UI authoring, Runner typed responses, participant execution,
and saved-XDF reconstruction remain separate owner gates.
