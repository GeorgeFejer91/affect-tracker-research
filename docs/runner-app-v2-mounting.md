# Runner app v2 questionnaire mounting

RR-06/RR-10, with named RR-02/03 presentation seams. Main/root allocated this
isolated app-only pass from `f590511` on `codex/segment-runner-app-v2`.
The app now consumes the previously implemented supported recipe reader,
versioned native adapter and typed presenter. It does not add a parser,
questionnaire definition, native command or recording policy.

For master2, fullscreen preparation asks for the saved experiment language and
omits the legacy coded-demographics fields. Continue retains the current native
media/input/preflight gates and sends the exact participantId-only Start2 request.
Names and ages are entered only in the authored typed form. Package/master1 keep
their separate legacy preparation and command shapes. Preflight version must
match the selected plan, as well as its source and plan hashes.

The app retains the typed presenter for its occurrence. Polls preserve input
identity, local text, focus and selection. Draft/Submit read the existing owner's
typed values and send itemId-to-value maps through the versioned adapter; Likert
v2 uses tagged singleChoice values while its definition validator receives its
original option-ID projection. Every item must be answered before submission.
Whitespace-only text, missing choices and fractional ages cannot advance.
Native rejection leaves the current inputs available for correction. Pending
actions disable answer controls and Submit, including while status polls arrive.

Occurrence changes, terminal return, source replacement and disposal destroy the
typed handle. Queued operations bind their original questionnaire object, and a
late status after disposal cannot recreate the controls. Repeated definitions do
not inherit prior occurrence answers. Localized typed instructions, progress and
Submit labels come from the presenter. The hidden-ISI neutral preview mapping
from `bfc3746` is preserved; no feedback geometry or native timing was changed.

## Verification and limits

`node --check runner/src/app.js` and `git diff --check` pass. The existing actual-app
master1 headless harness passes all five cases / 68 assertions. The new
`scripts/qualification/runner-app-v2-ui.mjs` imports production `bootRunner`,
loads the exact owner-generated engineering recipe, and exercises real browser
controls with explicitly synthetic native replies and fictitious answers.
All eight EN/DE form/flow/stop/dispose cases pass, with 254 assertions covering
mandatory submissions, exact Start2 fields and answer values, correction after
native rejection, pending-action disabling, polling/focus, typed-to-Likert and
timed-stage transitions, repeated-form reset and terminal/disposal cleanup.

Evidence under `D:/GitHub/.affect-runner-master-build/`:

- `runner-app-v2-v1-ui-01/receipt.json`: existing master1 checks.
- `runner-app-v2-ui-final/receipt.json`: final eight-case app2 checks, DOM output,
  recorded synthetic calls and submitted values; measured viewport 1920×1080.
- `runner-app-v2-ui-final/en-form.png`: reviewed **verified DOM snapshot**.
  Form screenshots clone the already-checked rendered DOM before disposal,
  then freeze that view solely for screenshot inspection. They are not live
  native/fullscreen evidence. Live command-line capture otherwise caused a
  later resize/Stop projection after the DOM receipt. Some German command-line
  images additionally have compositor gaps, including the focused recapture at
  `runner-app-v2-form-de-final`; those images are not accepted visual evidence.
  The German controls, labels and fit assertions pass independently.

The first new harness run rejected its inconsistent synthetic capability
reasonCode; the test fixture was corrected to the owner's required `ready`.
The initial harness asset URL was corrected to preserve the production module's
relative SVG resolution. No production readiness gate was weakened.

This pass does not run a native executable, actual media, input acquisition or
XDF recording. It does not establish installed rendering or timing qualification.
The real CLI-authored bilingual experiment and independent saved-XDF reconstruction
remain the end-to-end goal. Existing user windows and binaries were untouched.

Run the bounded app harness with:

```text
node scripts/qualification/runner-app-v2-ui.mjs <Chrome.exe> <new-evidence-directory> [en-form|de-form|en-flow|de-flow|en-stop|de-stop|en-dispose|de-dispose]
```
