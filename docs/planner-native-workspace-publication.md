# Native workspace publication

The native bridge connects this interface during Planner initialization, before
the native authoring session boots:

```js
researchUi.connectPlannerNativeWorkspace({
  getWorkspaceId,
  prepareWorkspace,
  prepareCatalogue,
});
```

`getWorkspaceId()` returns the current opaque native workspace UUID, or `null`
before selection/after bridge disposal. It does not expose a filesystem path.

`prepareWorkspace(receipt, {isCurrent})` is synchronous. It requires a selected
workspace, valid UUID and initialized libraries, then detaches the native
receipt. Preparation does not select a directory, rescan, publish owner state,
emit an event or touch the UI. The returned candidate has:

- `isCurrent()` for a precommit lifetime check;
- a single-use synchronous `commit()` that adopts the bridge workspace and
  clears its prior catalogue;
- a detached `projection` getter containing the existing workspace-ready data:
  `{surface:"tauri", label, directoryPermission:true, workspaceId}`.

`await prepareCatalogue(scan, {isCurrent})` returns the same candidate shape.
It uses the existing sequential native GstPlay attestation or explicitly
selected unqualified WebView probe. It does not introduce another decoder or
upgrade qualification claims. It prepares all entries before returning and
rejects failures and duplicate native identities without publishing a partial
catalogue. CLI preparation does not emit UI events or update progress text.
Its projection is the existing `{items, replace:true}` data, including source,
decode qualification and display geometry. Existing saved stimulus titles and
IDs are resolved against a detached settings snapshot.

Both candidates guard caller and bridge lifetime, workspace identity and
catalogue publication. Catalogue preparation also guards the selected playback
mode, media capability and app stimulus settings. Guards are checked around
asynchronous decoding and before commit. The existing actor orchestration
attempts stop after each stimulus, including a stale or failed preparation.
Projection getters return fresh copies, so inspecting or changing a returned
copy cannot alter the prepared bridge state.

Main must prepare the matching P1 app state from this projection, then publish
the bridge commit **first**, the P1 app state commit second, and rendering last.
The P1 state change intentionally invalidates the prior stimulus-settings
dependency, so committing the bridge afterward would correctly reject it as
stale. No asynchronous work or UI events belong inside either state commit.
The consumed candidate cannot be committed again. `isCurrent()` is a precommit
guard, not a postcommit acknowledgement.

Legacy GUI workspace selection and scanning reuse these same preparations,
then dispatch their existing events. GUI decode progress remains available.
A failed current scan withdraws the catalogue instead of partially accepting
successful entries. A stale scan cannot clear or overwrite a newer publication.
All four native scan/import call sites capture the workspace/catalogue guard
before awaiting the native scan result, including a new publication in the
same workspace. This prevents an older receipt from adopting the newer
workspace as its baseline when it finally arrives.

The focused checks use the actual bridge and event contract with synthetic
controller receipts. Forty checks pass across native bridge and catalogue
tests, including nine new preparation/legacy-race cases. They establish
publication ordering and lifetime behavior, not actual native video playback,
rendered final-app parity, completed mock export or Runner/XDF execution.
Evidence: `D:/GitHub/.affect-checks/root-native-workspace-focused.log`.

The app-side connector, matching P1 state preparation and CLI command handlers
remain Main's integration responsibility. This component introduces no UI
controls, visual layout changes, new file authority or recipe schema.
