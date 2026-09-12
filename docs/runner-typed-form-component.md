# Runner typed form component

RR-06/RR-10 Backend Verification against the agreed
[typed form contract](demographics-form-contract-v1.md). This is a component
handoff, not production master-v2 execution or native playback qualification.

## Ownership and dependencies

The component consumes S3's `form-definition.js` through `ffe11d8`, `b5e93dc`
and `aa8717b`, and S4's `research_form_definition.rs` through `c4237b2`,
`2deaf4a` and `5f786f0`. The native and JS authorities now agree on the frozen
16 MiB bound and existing language grammar. Original EN/DE definition bytes
and hashes from `7da84a9` remain unchanged. No second whole-definition parser
or hash authority is implemented by Runner.

Main owns production lib/P2/master-v2 composition. The new Runner modules are
currently exercised independently; existing v1 master/package execution and
its mandatory-submission guards remain in place.

## Native answer state

`research_runner_master/typed_forms.rs` provides closed `TypedChoice` and
`FormAnswerValue` ingress types and `TypedFormAnswers::replace`. It accepts a
P2 `FormDefinitionV1`, validates the complete definition/hash through its owner,
and checks each value against `FormResponseV1`. Input arrays cannot repeat or
invent items or options. Failed replacement preserves the previous state.

Text retains exact entered Unicode, whitespace and newlines within its UTF-8
byte bound. Age is a nonnegative safe whole number; numeric JSON `1`, `1.0` and
`1e0` have the same meaning, without accepting strings, fractions, negative zero
or unsafe values. Representation bounds do not impose an adult eligibility rule.
An explicit `preferNotToSay` option is an answer. Every displayed item is needed
for submission even when older metadata says `required: false`.

Partial drafts may contain missing or whitespace-only text and are incomplete.
Latencies are calculated from supplied native `Instant` observations, bounded to
24 hours, and retained for unchanged values. New values receive the current
native latency. The component returns ordered response rows and completeness;
the master worker must bind these to its current occurrence and version-2
response envelope. Only choices receive definition-derived labels/option order.
No score, subscale, participant code, filename or allocation is derived from
demographic answers.

## Participant presentation and recorded rows

`runner/src/typed-form.js` exposes `renderTypedForm(host, definition,
presentation, initialAnswers)`. It requires the `fields` presentation binding
and uses the P2 answer validator. It returns `read`, `progress`,
`focusFirstUnanswered`, `setDisabled` and `destroy`, plus localized instruction
and Submit text. Controls preserve text exactly, have no default answers and
expose browser required semantics. The parent must preserve this presenter
between status polls and destroy it when the occurrence changes.

`runner/src/typed-responses.js` validates recorded response rows against their
verified bound definition: exact typed branches/keys, authored order/labels,
mandatory completion and native latency bounds. It never repairs missing data.
The full information reader remains responsible for source/selection/occurrence
binding, ordering and actual LSL timestamps.

## Evidence and remaining integration

- Three focused native answer tests pass through the standalone
  `src-tauri/tests/runner_typed_answers.rs` harness, which includes the exact
  production component and its owners without changing shared lib registration.
- Twelve focused Node checks cover frozen fixtures, current P2 validation and
  recorded typed responses. EN and DE each pass 22 actual headless Chromium
  control checks at 1920×1080; both form captures were reviewed visually.
- Actual native component output in `typed-native-responses-02.json` is accepted
  unchanged by the independent JS row consumer. Names and elapsed times are
  explicitly fictitious/synthetic. This is native/JS engineering correspondence,
  not a participant run or an XDF recording of a typed master.

Evidence is under `D:/GitHub/.affect-runner-master-build/`, including
`typed-native-final.log`, `typed-node-final.log`, `typed-form-ui-01/` and
`typed-native-responses-02.receipt.json`. The original negative test setup tried
to construct an unsafe value through an already rejecting deserializer; it was
corrected to test direct Rust construction separately. Final checks pass.

After Main's versioned master APIs are ready, Runner must register the component,
add participantId-only v2 Start, mount the exact selected demographic form ahead
of MAIA/TAS, bind actions and response rows to the native worker, and extend
XDF-only reconstruction through exact schema dispatch. Forms remain local
participant authority, including Presented/Draft/Submit; remote operator control
must not impersonate answers. Full CLI-authored EN/DE native execution and the
independent saved-XDF acceptance goal remain open.
