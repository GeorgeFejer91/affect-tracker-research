# Affect Research Suite installation and packaging

This folder is the authority for the standalone Windows suite. Installer
success does not by itself qualify experiment timing, input, LSL/XDF, playback,
or research use.

## Decision

Ship one Windows x64 NSIS installer containing two separate Rust/Tauri
executables:

- **Experiment Planner**, with Classic and Ledger shortcuts over the same
  Planner binary and authoring backend; and
- **Experiment Runner**, with its own executable, embedded frontend, native
  command registry, runtime state, icon, and shortcut.

The installer also contains the icons, notices, exact suite marker, and offline
WebView2 installer payload. After the installer is downloaded, installation and
ordinary use require no source checkout, Node, pnpm, local server, or network.
Packaging the programs together does not merge their authorities: Planner
authors/reopens; Runner executes/records.

Here, **self-contained** means that application code, assets, the Runner, and
the WebView2 installer are present locally and that the research workflow has no
required online service. It does not mean that the Microsoft Evergreen WebView2
runtime is network-silent when a network is available. Current WebView2 builds
may contact Microsoft's experimentation/configuration service even when the app
loads only embedded content; ordinary Chromium background-network switches are
best-effort diagnostic controls, not a firewall. Microsoft documents the
supported service kill switch as the global
[`ExperimentationAndConfigurationServiceControl`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-webview-policies#experimentationandconfigurationservicecontrol)
enterprise policy, so the suite installer must not set it and thereby alter
unrelated WebView2 applications. Prove network-independent use by running the
offline gate with default-route adapters disconnected, and keep internet
integration a separate future capability.

The interactive installer exposes its standard directory page. The researcher
chooses one writable suite directory; that exact directory becomes the base of
operations. A protected, linked, reparse-routed, unavailable, or non-writable
selection fails closed rather than falling back elsewhere.

## Suite directory contract

Program resources and retained user data are separate children of the chosen
root:

```text
<Suite root>/
  affect-research.exe
  uninstall.exe
  resources/
    affect-research-suite-root.json
    bin/affect-runner.exe
    icons/
  state/
    planner/
      app-data/
      webview/
    runner/
      app-data/
      webview/
  workspace/
    stimuli/
    settings/
    outputs/
    recovery/
    assets/
      stimuli/
      questionnaires/
```

The installer owns only the executables, uninstaller, and `resources/`.
`state/` and `workspace/` are runtime-owned retained data. Repair and upgrade
must preserve them. Uninstall removes program files and shortcuts but retains
both trees so that cached application state and research evidence are not
silently destroyed. The suite hook disables Tauri's generic AppData deletion
path because it addresses a legacy external bundle profile, not suite-owned
state. Retained data is deleted or archived only as a separate explicit action.

The exact installed marker activates suite-local paths. An unpackaged developer
binary without that marker retains the existing development path behavior.
Rust validates the marker and creates the folder contract before constructing
services or WebViews. Both programs select the same `workspace/` through
`WorkspaceService`; their app data and WebView profiles stay isolated beneath
their role-specific `state/` directory. The WebView never constructs native
paths.

`WorkspaceService` remains the sole owner of workspace-library creation and its
ordinary-directory, canonical-child, replacement-identity, write/readback, and
fixed-child checks. The suite layer supplies only validated root and role
locations; it does not duplicate the inner workspace initializer.

## Package contract

Extend the existing host-native, clean-tree, locked-dependency Tauri/NSIS path.
Do not add another installer framework. A Windows candidate must:

1. build both production frontends and both release Rust binaries from one
   exact clean commit;
2. embed the Runner executable as a mapped Tauri resource and package exactly
   one NSIS installer;
3. embed all runtime assets and the offline WebView2 payload;
4. install for the current user without administrator authority by default;
5. let the interactive user select a writable directory;
6. create the exact Classic, Ledger, and Runner shortcuts with scoped icons;
7. contain no participant data, study media, development credentials, signing
   material, or undeclared sidecars;
8. emit SHA-256 and provenance for the exact tested installer; and
9. keep research-readiness flags false until their independent gates pass.

The generated Runner is built with the Windows native-acquisition and LSL
features. The Planner bundle remains free of Runner command registration; the
second executable is a packaged companion, not an imported Planner mode.

## Non-scope

- Signing, publishing, updater activation, store submission, or a release
  channel without separate authorization and credentials.
- Internet accounts, remote control, hosted dependencies, or online study
  synchronization.
- Bundled participant data, study media, user questionnaires, sample studies,
  or personal identifiers.
- Treating a successful build/install as timing, playback, LSL/XDF, input, or
  research qualification.
- Changing saved experiment semantics, recipe versions, sampling policy, or
  Planner/Runner ownership.

## Observability

Each qualification attempt records a path-redacted receipt containing:

- schema/version, source commit, clean-tree rejection, product version,
  OS/architecture, toolchains, and feature set;
- installer filename, byte length, SHA-256, signature state, and closed
  installed-program inventory hash;
- selected-directory, install, launch, restart, repair, and uninstall results;
- directory-contract results with no personal path;
- three shortcut target/argument/icon checks;
- Planner Classic/Ledger canonical-JSON comparison hash;
- installed-window screenshots at required display scales; and
- explicit `passed`, `failed`, `blocked`, and `notRun` gates.

A receipt proves only its named bytes, host, actions, and checks. It is not a
release, publication, signature, or research-qualification receipt.

For a local Windows candidate, use the same exact commit for the build and its
provenance receipt:

```powershell
$env:AFFECT_RESEARCH_PACKAGE_COMMIT = (git rev-parse --verify HEAD).Trim()
pnpm desktop:bundle
pnpm desktop:provenance
Remove-Item Env:AFFECT_RESEARCH_PACKAGE_COMMIT
```

Local provenance records `origin: local` and null workflow/run fields. It must
never synthesize a GitHub Actions run URL. The helper still rejects a dirty
tree, a commit mismatch, a cross-host target, or an ambiguous artifact set.

## Validation gates

All applicable gates run against one unchanged installer artifact:

1. **Source:** clean exact commit, locked frontend/Cargo graphs, focused and full
   repository checks pass.
2. **Build:** both embedded frontends and binaries build; one Windows installer
   plus checksum/provenance is produced.
3. **Clean install:** from the user's known Downloads directory on a fresh
   Windows x64 profile with no repository, Node, pnpm, or development server.
4. **Selected root:** silent qualification supplies a fresh Downloads child;
   interactive qualification chooses a writable path through the directory
   page. The installed suite uses exactly that root.
5. **Environment:** Planner creates the shared workspace and its own state;
   Runner reuses the workspace and creates separate state. Repeated launch is
   idempotent; file/link/junction conflicts reject without mutation.
6. **Interfaces:** all three shortcuts target the intended executable,
   arguments, and icon; Planner surfaces reproduce identical canonical JSON;
   Runner reads that exact saved package.
7. **Offline:** after installation, disconnect networking and repeat launch,
   author/save/reopen, Runner load/preflight, and ordinary close.
8. **Visual/interaction:** inspect installed windows at 100%, 125%, and 150%
   scaling, including keyboard use, dialogs, long paths, and non-ASCII paths.
9. **Lifecycle:** restart and same-artifact repair preserve `workspace/` and
   `state/`; upgrade preserves saved-file compatibility; uninstall removes all
   program files and shortcuts while retaining both data trees.
10. **Research evidence:** separately run real-video, physical-input, configured
    sample-rate, semantic-marker, LSL/XDF, failure/recovery, and independent
    reconstruction qualifications. Installer gates cannot satisfy this gate.
11. **Boundary:** no signing, publishing, updater, or internet-integration claim
    is inferred from these results.

## Clean-profile installed smoke route

The Windows workflow artifact includes
`scripts/qualification/planner-installed-smoke.ps1` (the historical filename is
retained for automation compatibility; its schema is suite-wide). Copy that
script, the single NSIS installer, and its provenance receipt directly into a
fresh disposable user's known Downloads directory. Do not copy the repository
or install Node/pnpm. Disconnect every default-route adapter before the offline
gate:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\planner-installed-smoke.ps1 `
  -InstallerPath '.\Affect Research Suite_0.4.0-alpha.1_x64-setup.exe' `
  -ProvenancePath '.\unqualified-windows-x64-provenance.json' `
  -ReceiptPath '.\Affect Research Suite_0.4.0-alpha.1_x64-installed-smoke.json' `
  -RequireOffline
```

`-InstallDirectoryName` may supply another single direct child of the known
Downloads folder for long-path or non-ASCII qualification. The validator
rejects empty values and anything that does not resolve to exactly one direct
child with the same leaf name before starting the installer; its receipt keeps
the selected name path-redacted.

The route refuses a pre-existing selected Downloads child, installs there with
NSIS `/D`, checks the exact program inventory and all shortcuts,
launches Classic, Ledger, and Runner, verifies suite-local workspace/state,
records per-launch TCP connection counts, repairs a removed Ledger icon with
the same artifact, then uninstalls. With `-RequireOffline`, zero connections
are required in addition to the absence of every default-route adapter. It
requires program files and shortcuts to disappear while the exact workspace
and state inventories remain.

For functional diagnosis on a machine that contains the repository or
Node/pnpm, `-AllowDevelopmentHost` may continue through the later lifecycle
gates. That switch does not waive qualification: the receipt records the
`cleanProfile` gate and its overall status as `blocked`. Omit the switch for the
fresh-profile acceptance run; the default remains fail-closed before install.

This smoke does not replace identical-input Planner comparison, actual
directory-page interaction, the scale/path visual matrix, cross-version
upgrade, or scientific Runner qualification. Keep those gates `notRun` until
their own evidence exists.

## Next qualification slices

1. Produce one clean Windows x64 suite artifact and run the checkout-free
   offline smoke on a disposable profile.
2. Run installed Classic/Ledger save/reopen equivalence and Runner load against
   one exact package.
3. Run the installed visual/interaction matrix at 100%, 125%, and 150% with
   long and non-ASCII suite paths.
4. Prove cross-version upgrade while preserving `workspace/`, `state/`, and
   historical saved-file readers.
5. Execute the separate real experiment-evidence qualification ladder before
   any research-ready claim.
