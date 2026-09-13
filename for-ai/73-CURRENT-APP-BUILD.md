# Authoritative local companion application build

The current Runner entrypoint is `D:/GitHub/.affect-checks/current-apps/Experiment Runner.exe`.
Read `current-build.json` beside it and compare the source commit and both binary
hashes before any actual-app validation. The adjacent engine is an implementation
binary of the same version, not a second application version. Do not launch it
without the verified launcher.

Root consolidates accepted segment changes into this one distribution. Isolated
source worktrees and Cargo outputs are development artifacts, not alternative
user launch targets. Do not create additional desktop/download shortcuts or
leave old application builds running. Archive superseded distributions in a
non-launchable form while preserving hashes, evidence, experiments and outputs.
Push validated source milestones to `codex/final-release-validation`; do not
claim a pushed commit is installed until the build receipt matches it. Installer
qualification and publication follow functional pipeline completion.

The consolidated SurveyJS build at `dc7f18914bc4a9d31898bb576081e99ba92f4541`
launched successfully as the sole Runner process, PID 29412, and automatically
reopened the exact mock. Old PID 25120 closed gracefully after its blocked
preparation was observed; its executable and previous current-app binaries are
archived in non-launchable form. All source milestones through this build are
pushed. Subsequent replacements must refresh the adjacent build receipt.

Native keyboard setup reached the validation checkbox and input-test region,
but all four directions remained unregistered (`runner-real-survey-settings-03`).
No experiment or recording started. The next focused fix prevents arrow-key
scrolling from cancelling the input test and waits for the initial region scroll
before arming it; actual native verification is still required. Full experiment,
geometry, ISI and XDF validation remain open.
