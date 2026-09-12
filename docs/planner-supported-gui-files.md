# Supported GUI Planner file adapters

S7 GUI/CLI parity allocation from Main `1747784`, Backend Verification. Main
owns actual app injection and native GUI load/save registration. These hooks
reuse the existing recipe authorities and introduce no compiler or schema.

The optional workflow constructor argument is:

```js
documentAdapter: {
  parseDocument,  // async (Uint8Array) -> immutable loaded recipe document
  compileDocument, // async (capture.input) -> immutable loaded recipe document
  captureInput,   // synchronous (registry, options) -> { input, isCurrent }
}
```

All three hooks are required when an adapter is supplied. Without it, existing
GUI Open/Save keeps strict-v1 parsing, compilation and capture. Prepared CLI
Open/Save retains its separate existing per-call hooks.

For supported GUI operation, Main supplies `parseSupportedPlannerRecipe` and
dispatches `compilePlannerRecipeV1`/`compilePlannerRecipeV2` by explicit input
version, serializing and strictly parsing the result into a loaded document.
The additive `capturePlannerRecipeInputVersion(registry, { version, ...options })`
requires numeric version 1 or 2. Main selects this version from the actual P2
snapshot. The existing `capturePlannerRecipeInputV1` always constructs version 1,
even if an extra version option is supplied; domain compatibility stays with
the existing strict compiler. Capture still requires real current acceptance,
including P5, and binds acceptance generation and source snapshots.

With the adapter, GUI Open accepts `planner-recipe-v1` and `planner-recipe-v2`
and requires the strict parsed version to match the selected kind before any
owner restoration begins. Existing `experiment-package-v1` dispatch remains
with `openLegacy`. The default workflow rejects v2. Content restoration order,
partial restoration errors, edit/disposal guards and source adoption are shared.

Fresh GUI Save retains existing P5 acceptance timing and uses the injected
capture/compiler. Unchanged re-export uses the injected strict reader and
requires unchanged canonical text and source hash. Saving only updates source
metadata; it never reapplies owner fields. The existing exporter still owns
cancel/stale/late-write outcomes and exact save-receipt adoption.

The browser file helper adds:

```js
openSupportedBrowserPlannerRecipeFile({ isCurrent, pickOpenFile? })
prepareSupportedBrowserPlannerRecipeSave(sourceText, { isCurrent, pickSaveFile? })
```

Supported Open performs explicit schema dispatch: master versions 1/2 use the
existing supported reader; legacy packages use the existing file dispatcher.
There is no catch-and-fallback parsing. It returns the existing `{kind, document}`
shape or null on picker cancellation. Its picker is still invoked synchronously.

Supported Save returns the existing prepared object with `chooseAndSave()`.
Both legacy and supported entrypoints share all handle, size, current-operation,
write/close/abort and strict readback code. A nonempty destination is rejected
before creating a writable stream. As before, the browser cannot distinguish an
existing empty file from a new picker file or promise atomic exclusion against
other writers; native exclusive creation is a separate guarantee. Timestamp
suggestions and the six-field version-1 save receipt are unchanged.

Verification: 26 baseline workflow/browser/prepared-save tests passed. The final
47 checks include legacy workflow/browser/capture/prepared-save, eight supported
GUI/browser cases, and the modular architecture guard. Existing canonical v1
and mixed typed-v2 fixtures are processed by real compilers/readers and registry;
picker and restoration adapters are typed test doubles. Exact bytes, unchanged
re-export, metadata-only adoption, legacy dispatch, malformed/hash rejection,
nonempty destinations, stale/partial Open, write faults and late write evidence
are covered. Diff checks pass. Log:
`D:/GitHub/.affect-checks/p7-gui-supported-final.log`.

This is workflow/helper evidence. Actual GUI hook installation, native dialogs,
rendered typed-form interaction, complete user mock and Runner/XDF execution
remain separate Main/root integration gates.
