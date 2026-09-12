# App-local prepared restoration

Main owns these composition hooks; domain validators and editor state remain
their existing owners. This is the P1 shared Open seam, not another app mode.

`researchUi.prepareWorkspaceRestoration(contribution,{isCurrent,dependencies})`
requires empty dependencies, validates a detached saved contribution and its
existing portable restore plan, and returns `{isCurrent,commit,afterCommit}`.
Preparation does not reserve a restore generation or change controls/media.
It binds the current study draft, catalogue snapshot, restore generation,
setup mode, command lifetime and disposal. Commit rechecks, installs study and
unverified video declarations, and withdraws the catalogue without notification.
Projection then notifies and refreshes controls. Saved media never grants current
readiness or directory authority. Legacy GUI restore retains its immediate
reservation and reuses preparation, commit and projection.

The current video catalogue producer adds `withdraw({notify:false})` and
`notifyChange()`. Default withdrawal behavior is unchanged; its frozen legacy
producer is untouched. Pending async catalogue work is still invalidated.

Twenty-three catalogue/workspace Node tests pass. The actual Planner controller
passes 38 headless Chrome checks at the recorded working-tree source, including
read-only preparation, state-before-notification, the existing full section
confirmation cycle and delayed media rebind/withdrawal races. Receipt and exact
input hashes: `D:/GitHub/.affect-checks/main-workspace-prepared-restore-20260912/`.
The harness uses synthetic media inputs and an isolated browser profile. This
does not establish native Open or real media qualification. Other app-local
P2/P5/policy/target preparations and final command registration remain pending.
