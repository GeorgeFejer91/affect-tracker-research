# Experiment Planner installation and packaging

This folder is the authority for the next standalone Experiment Planner
installation goal. It does not certify the current debug executable or the
existing unsigned alpha as an installed product.

## Decision

Ship one Windows x64 NSIS installer containing the Planner's Rust/Tauri binary,
embedded frontend, icons, notices, and required WebView2 installer payload. It
must run without the source checkout, Node, pnpm, a local web server, or network
access after the installer has been downloaded.

The installer owns one application installation and exposes two shortcuts over
the same binary and backend:

- **Experiment Planner Classic** starts the default interface;
- **Experiment Planner Ledger** starts with `--ledger` and its own Ledger icon.

Both interfaces use the same workspace service and produce byte-identical
canonical JSON for identical accepted inputs. Packaging must not fork the
authoring or save logic.

## Scope

- Per-user Windows installation and clean uninstall.
- One isolated WebView profile and app-data namespace for Experiment Planner.
- One deterministic researcher-visible default workspace beneath the current
  Windows user's known Downloads folder.
- Clean install, first launch, restart, upgrade, repair, uninstall, and offline
  launch validation against the exact packaged artifact.
- Artifact identity, checksum, build provenance, installed-file inventory, and
  actual-window visual/interaction evidence.

## Non-scope

- Publishing, signing, updater activation, store submission, or release-channel
  creation without separate authorization and credentials.
- Moving the installed executable into Downloads or making the source checkout
  part of the runtime.
- Bundling participant data, study media, user-authored questionnaires, sample
  experiments, or private identifiers.
- Claiming research readiness, native timing, LSL, XDF, or playback
  qualification from installer success.
- Changing experiment semantics, canonical JSON, or Planner/Runner ownership.

## Authority and directory contract

The installer owns program files. Rust owns directory resolution, creation,
validation, and workspace selection. The WebView receives bounded status and
uses existing typed workspace commands; it never constructs native paths.

Resolve Downloads through the Windows known-folder API, never by concatenating
`USERPROFILE` or assuming the folder is named `Downloads`. On first GUI launch,
create this default environment only when each ancestor is absent or an ordinary
directory:

```text
<Known Downloads>/Affect Research/
  Experiment Planner/
    workspace/
      stimuli/
      settings/
      outputs/
      recovery/
      assets/
        stimuli/
        questionnaires/
```

`WorkspaceService` remains the sole owner of the inner workspace shape and its
ordinary-directory, reparse-point, write-readback, and fixed-child checks. The
installation layer supplies only the parent path. It must not duplicate the
workspace initializer.

Private implementation state remains in the operating system's per-user
application-data and WebView-data locations under the existing bundle identity.
Researcher-visible projects and exports stay in the Downloads workspace. This
separation keeps the install replaceable while preserving user data.

Creation is idempotent and fail-closed:

- never replace a file, link, junction, reparse point, or non-directory;
- never delete, rename, merge, or silently adopt a conflicting tree;
- never fall back to the current directory, repository, Desktop, or a temporary
  directory;
- report an actionable startup blocker if Downloads cannot be resolved or the
  environment cannot pass the existing workspace readiness checks;
- retain the existing explicit **Set work directory** path so the researcher can
  choose another validated workspace after startup.

## Package contract

Extend the existing host-native, clean-tree, locked-dependency packaging route;
do not add a second package manager or installer framework. A candidate must:

1. build the production frontend and release Rust binary from one exact commit;
2. embed all application assets and use no `localhost` or source-tree runtime;
3. include the offline WebView2 installation mode required for a one-download
   Windows setup;
4. install per user without administrator authority unless a later signed
   distribution decision explicitly changes the scope;
5. create both shortcuts with their exact arguments and distinct icons;
6. contain no participant data, development credentials, signing material, or
   undeclared sidecars;
7. emit SHA-256 and provenance for the exact installer that is tested; and
8. keep the current unqualified/research-readiness flags false until their
   independent gates pass.

## Observability

Each validation attempt records a path-redacted receipt containing:

- schema/version, source commit, dirty-state rejection, product version, target
  OS/architecture, Rust/Node/pnpm/Tauri versions, and build feature set;
- installer filename, byte length, SHA-256, signature state, and installed-file
  inventory hash;
- install mode and success/failure codes for install, launch, restart, upgrade,
  repair, and uninstall;
- directory-contract result for every required child, with no personal path;
- Classic and Ledger shortcut target/argument/icon checks;
- canonical JSON comparison hash from both interfaces;
- actual installed-window screenshots at the required display scales; and
- explicit `passed`, `failed`, `blocked`, and `notRun` gates.

A receipt proves only its named artifact, host, actions, and checks. It is not a
release, publication, signing, or research-qualification receipt.

## Validation gates

The goal is complete only when all applicable gates pass against one unchanged
installer artifact:

1. **Source:** clean exact commit; locked frontend and Cargo dependency graphs;
   existing focused and full repository checks pass.
2. **Build:** production desktop assets and release binary build; exactly one
   intended Windows installer is produced with a checksum and provenance.
3. **Clean install:** launch the installer from the user's normal Downloads
   folder on a clean Windows profile; no repository, Node, pnpm, or development
   server is present.
4. **Environment:** first launch creates exactly the directory contract above;
   a second launch is idempotent; file/link/junction conflicts reject without
   mutation; a user-selected replacement workspace still works.
5. **Isolation:** installed app and WebView state do not read the developer
   checkout, browser storage, another Planner profile, or ambient working
   directory.
6. **Interfaces:** both shortcuts launch the installed app with the intended
   interface and icon; Classic and Ledger can open, edit, confirm, save, reopen,
   and reproduce the same JSON through the shared backend.
7. **Offline:** after installation, disconnect networking and repeat launch,
   workspace readiness, authoring, save, close, and reopen.
8. **Visual/interaction:** inspect the actually installed windows at 100%, 125%,
   and 150% Windows scaling; verify title-bar controls, tab/ledger geometry,
   scrolling, keyboard access, dialogs, long paths, and non-ASCII paths.
9. **Lifecycle:** restart preserves the selected workspace; upgrade preserves
   user data and compatibility; repair restores program files without changing
   the workspace; uninstall removes program files and shortcuts while retaining
   research data unless the user explicitly chooses a separately validated data
   removal action.
10. **Boundary:** no signing, publishing, updater, native-timing, LSL, XDF, or
    research-readiness claim is inferred from the passing installer gates.

## Mitigation map

| Risk | Required control |
| --- | --- |
| Downloads is redirected, renamed, or unavailable | Windows known-folder resolution; explicit startup blocker; no guessed fallback |
| Existing path is a file/link/junction | Existing strict ordinary-directory validation; no mutation |
| Upgrade or uninstall loses research data | Program/data separation; preserve Downloads workspace by default; clean-profile lifecycle tests |
| Classic and Ledger drift | One binary and shared backend; identical-input JSON hash comparison |
| Installer passes but runtime depends on the repo | Clean-profile and offline tests with no development tools/server |
| Tested bytes differ from distributed bytes | Test one immutable artifact; bind SHA-256 and installed inventory in the receipt |
| Installer success is mistaken for scientific qualification | Preserve explicit unqualified flags and separate acceptance gates |

## Next slice

1. Add a versioned Rust resolver that supplies the known-Downloads parent to
   the existing `WorkspaceService` initializer, with conflict/idempotence tests.
2. Add a Windows packaging override for offline WebView2 and per-user NSIS.
3. Add the two installed shortcuts and distinct icon without duplicating the
   executable or Planner logic.
4. Extend package provenance and implement a clean-profile installed smoke test.
5. Build one local unsigned candidate, run the gates above, and retain its exact
   evidence without publishing it.
