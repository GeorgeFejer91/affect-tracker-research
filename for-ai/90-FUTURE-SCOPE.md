# Future scope

Deferred intent, deliberately outside the mandatory reading route. Nothing here
is a work item. Do not implement any of it to satisfy a historical checklist,
and do not treat a working feature as unfinished because it appears below.

## Accepted but not scheduled

- **World-fixed XR authoring (P6).** Planner can already author an optional
  XR spatial layout and round-trip it; the contract is
  [`docs/planner-p6-xr-layout.md`](../docs/planner-p6-xr-layout.md). The desktop
  Runner cannot execute XR and must not imply that it can.
- **Runner companion browser surfaces.** A mirrored "absent-minded professor"
  control page and a phone/tablet remote affect grid were sketched as QR-opened
  GitHub Pages companions. Only a labelled preview QR address exists. Building
  either needs target-owned pairing, scoped authority, revocation behaviour and
  input provenance decided first; the two scopes must not be conflated.
- **Controller override execution.** The override editor exists; native
  execution, the frozen override hash and its attempt/recovery receipts do not.
  Changed controller settings are drafts that block Start.
- **Master-protocol recovery.** Resuming an interrupted master run is not
  implemented.

## Explicitly out of scope

WebXR/Quest runtime, remote control planes, Party/Ground Control, direct Polar,
Face/Photoatlas, Touch inference, screen calibration beyond the supported
controlled-geometry contract, retro/phone/PiP presentation, macOS and Linux
experiment runs, Firefox, Safari and mobile browsers.

Their source, documentation, notices and full Git graph are preserved in
[`GeorgeFejer91/affect-tracker-playground`](https://github.com/GeorgeFejer91/affect-tracker-playground)
and in this repository's history. Reactivating any of them needs an explicit
decision from the user with a named authority and data boundary, not an
inference from an old checklist.
