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
P2 preparation and final command registration remain pending.

`prepareFeedbackRestoration` now reuses P5's existing prepared control/model
writer and separate projection, after exact contribution validation. It binds
the current raw draft and caller lifetime; commit does not accept Live Preview.
`preparePlannerPolicyRestoration` uses the existing policy validator/control
writer with detached preparation and control-identity/value checks.
`preparePlannerTargetRestoration` prepares the explicit target and defers P6
invalidation notification until projection. Default invalidation still notifies.

Twenty-six registry/policy checks pass. The expanded actual Planner Chrome
harness passes 44 checks, including exact feedback, policy and target restoration
without automatic confirmation. The first expanded run attempted to read the
invalid sampling draft deliberately retained by an earlier negative test; the
strict reader correctly rejected. The fixture now restores the known validated
policy instead, with no production validator change. Both outcomes remain under
`D:/GitHub/.affect-checks/main-policy-feedback-prepared-restore-20260912/` and
`D:/GitHub/.affect-checks/main-policy-feedback-prepared-restore-corrected-20260912/`.
These receipts bind actual working-tree inputs, not a native executable.
