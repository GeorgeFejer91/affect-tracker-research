# P6 command and UI correspondence

Allocated CLI-P6 / E2E-UI, Backend Verification, from `460f516`. The shared
[command API](planner-authoring-command-api-v1.md) owns wire validation and
session publication. This adapter adds no saved schema or XR execution.

## Registration and owner hooks

```js
import { createPlannerAuthoringP6 } from "./planner-authoring-p6.js";
const p6 = createPlannerAuthoringP6({ editor: xrLayoutEditor });
authoringSession.registerOwner(p6);
```

Use the existing `createXrLayoutEditor` instance. It exposes
`getAuthoringSnapshot()` with a detached draft, owner/dependency revisions and
read-only inspection/geometry inputs; and
`stageAuthoringDraft({enabled,profile},{isCurrent,signal})`, returning
`{isCurrent,commit,afterCommit}`. The adapter captures the existing draft and applies the
entire ordered edit list to one detached candidate. Staging does not alter DOM,
draft, accepted contribution, file generation, callbacks or media authority.

The coordinator must check **all** staged `isCurrent()` predicates and global
cancellation before any commit. Guards include the XR owner's revision, which
changes on P1/P5 drift. `commit()` synchronously installs the prevalidated
candidate in the sole owner, withdraws preparation, advances its revision once
and invalidates pending profile reads. It performs no native operation, observer
call, DOM work or new domain validation. After **all** owners commit, the shared
coordinator calls `afterCommit()` to update the existing controls and notify
observers, with projection errors reported as incomplete applied outcomes.
Main retains shared publication
locking, precommit file-workflow invalidation and observer/lifecycle fencing.

Atomic field edits retain inactive spatial values on exclusion. Final master
exclusion is still exactly `{status:"excluded"}`; reenabling requires fresh
preparation. Incomplete finite geometry is editable with issues and cannot be
prepared/exported. Invalid numeric GUI text remains a string with an issue;
typed CLI numeric edits reject strings, nonfinite and out-of-range values.

## Stable field mapping

Every listed control belongs to `xr-layout-editor.js` / `xr-layout-view.js`.
Selectors below are verification locators, not accepted command field IDs.
Except inclusion, JSON paths begin `segments.P6.profile.` when XR is included.

| Command field | Existing UI control | Saved path |
| --- | --- | --- |
| `P6.enabled` | Design a screen for WebXR (`data-xr-enabled`) | `segments.P6.status`: `included` / `excluded` |
| `P6.video.distanceMetres` | Distance from setup viewer | `video.distanceMetres` |
| `P6.video.azimuthDegrees` | Centre azimuth | `video.azimuthDegrees` |
| `P6.video.elevationDegrees` | Centre elevation | `video.elevationDegrees` |
| `P6.video.widthMetres` | Width | `video.widthMetres` |
| `P6.video.heightMetres` | Height | `video.heightMetres` |
| `P6.video.yawDegrees` | Screen tilt → Yaw | `video.yawDegrees` |
| `P6.video.pitchDegrees` | Screen tilt → Pitch | `video.pitchDegrees` |
| `P6.video.rollDegrees` | Screen tilt → Roll | `video.rollDegrees` |
| `P6.feedback.enabled` | Include adjacent feedback | `feedback.enabled` |
| `P6.feedback.offsetXMetres` | Centre offset, right of screen | `feedback.offsetXMetres` |
| `P6.feedback.offsetYMetres` | Centre offset, above screen | `feedback.offsetYMetres` |
| `P6.feedback.diameterMetres` | Maximum footprint diameter | `feedback.diameterMetres` |
| `P6.feedback.minimumGapMetres` | Minimum screen gap | `feedback.minimumGapMetres` |

Each profile-field control uses `data-xr-field` equal to the command field
without the `P6.` prefix. The registered closed operation
`setAngularSize({widthDegrees,heightDegrees})` corresponds to **Enter angular
size → Apply angular size**, using `data-xr-angle="width"/"height"` and
`data-xr-action="angles"`. Both call the existing `withXrAngularSize` function.
It uses the candidate's current distance, requires a centred/untilted valid
profile and replaces only `video.widthMetres` / `video.heightMetres`. Angles are
not an additional saved size authority. Other poses retain derived angular
readouts and use metre controls.

Fixed target, projection, coordinates, fit and all five alignment rules are
read-only registered values and retain their exact profile fields. Pending
status, dependencies, angular-edit availability and resolved geometry are derived
read-only diagnostics. Inspection camera/media are explicitly transient read-only
values; the UI's view buttons, sliders and video selector do not edit the recipe
or authored session revision. No transport-only command needs a new UI control.

## Evidence and integration boundary

`research-planner-authoring-p6.test.js` covers every writable field, ordered
angular conversion, exact full-master serialization/readback, retained inactive
values, invalid drafts, malformed/read-only rejection and current-owner guards.
Its cross-owner test uses the actual shared session to prove P1 drift while
another owner stages cannot partially publish either owner.

The existing owned headless harness adds an explicit `cli` scope:

```text
node scripts/qualification/xr-authoring.mjs <Chrome-executable> <new-evidence-directory> 1440 cli
```

It mounts the actual XR editor and shared JavaScript command session. Each of
the 14 fields is set through commands, checked in the actual control, then edited
through the actual UI event; full canonical profile and included/excluded
selection must match. The actual angular button gets the same comparison.
The receipt retains each normalized value and full P6 result, plus input/harness/
image hashes. It also checks invalid numeric UI repair, transient camera,
staging nonmutation and GUI/cancellation guards. Media geometry is an explicit
synthetic fixture. This owner evidence does not claim the native CLI transport,
real media verification or Runner execution; Main/Runner own those active steps
under [69](../for-ai/69-CLI-RUNNER-END-TO-END-GOAL.md).

Final owner application checkpoint `28c5d6ce2f781eef6e37f20ccd762beabf86cb4d`
collects shared `2310efc` and `0138516`. All 26 owner tests and 13 shared tests
pass; the complete suite passes 808 checks with test concurrency two. The prior
concurrent test/build run's one P2 subprocess timeout remains in the evidence;
no timeout or assertion was changed. Desktop11/Pages239 builds pass.

Clean Chrome captures pass 84 checks at each 1440/820px and retain all 15
field/operation correspondence rows. Both PNGs were inspected. The existing
full-application master fixture passes 60 checks on this same code. Receipts,
exact source/harness/image hashes and logs are under
`D:/GitHub/.affect-preview-checks/p6-cli-20260912/`, in `final-wide-28c5d6c`,
`final-narrow-28c5d6c`, `final-app-28c5d6c` and the `final-*-28c5d6c.log` files.
These checks precede Main's combined native CLI installation; root owns the
overall E2E-UI/E2E-RECIPE/E2E-RUNNER checklist.
