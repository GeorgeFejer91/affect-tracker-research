# Affect Research native media runtime

The future Windows research-media target is a private **GStreamer 1.28.6**
runtime with the Rust `gstreamer`/`gstreamer-play` 0.25 bindings and GstPlay API.
The current package candidates do not bundle it. The intended qualified design
must not discover GStreamer from `%PATH%`, the registry, or a system
installation, and the application must never download native media code at
runtime.

The former libVLC pin and stager remain available at their historical commits
and in the frozen Playground repository. They are absent from the active
Research build, and `nativeLibvlc` is not a valid choice for a new attempt.

## Pinned upstream input

[`gstreamer-runtime-v1.json`](./gstreamer-runtime-v1.json) is the
machine-readable authority for the official GStreamer 1.28.6 MSVC x86-64
installer, its SHA-256 and byte length, the 0.25 Rust binding series, and the
canonical staged runtime tree. GStreamer 1.28 uses one combined Inno Setup
installer: `/TYPE=runtime` stages the redistributable application tree and
`/TYPE=devel` installs the headers, pkg-config metadata, and import libraries
needed to compile the Rust bindings. There is no second Windows development
installer to invent or trust independently.

The component checksums in `sources` are preliminary notes, not complete
corresponding-source evidence. `sourceEvidence` deliberately records the
missing archive names, canonical URLs, byte lengths, retained source artifacts,
and automated verification. No distribution can use this pin until those gaps
and the redistribution review are closed.

The canonical runtime tree contains 827 files and 340,362,958 bytes. Its
ordered `runtime-files.sha256` identity is
`51c27b6a25db1d86dea20cc108e88240fc340758b34ae1e497dd91d8de1b5566`.
The tree includes the checked-in
[`GSTREAMER-RUNTIME-NOTICE.txt`](./GSTREAMER-RUNTIME-NOTICE.txt). Runtime
integrity is an engineering supply-chain control; it is not player behavior,
format coverage, redistribution approval, or research qualification.

## Deterministic runtime staging

Download the exact combined installer named in the pin, then run:

```powershell
pwsh -File src-tauri/native-media/stage-gstreamer-runtime.ps1 `
  -InstallerPath C:\path\to\gstreamer-1.0-msvc-x86_64-1.28.6.exe
```

The stager checks the pinned filename, byte identity, and SHA-256, installs the
upstream `runtime` type into an isolated temporary directory, copies the bounded
integration-test directories plus the project notice, and verifies every
staged file. This 827-file tree is deliberately not asserted to be the minimal
or approved distributable plugin/codec closure.
It rejects traversal, links/reparse points, missing or extra files, modified
content, case-colliding paths, excessive depth/count/bytes, and wrong-
architecture required PE files. It refuses to replace an existing destination.

Verify an existing stage without changing it:

```powershell
pwsh -File src-tauri/native-media/stage-gstreamer-runtime.ps1 `
  -VerifyOnly `
  -DestinationPath src-tauri/native-media/runtime/gstreamer-1.28.6/msvc-x86_64
```

These safe metadata checks do not claim hostile TOCTOU-race elimination.

## Windows CI and local interface packaging

[`prepare-gstreamer-windows-ci.ps1`](./prepare-gstreamer-windows-ci.ps1)
downloads the URL from the checked-in pin, verifies its pinned byte length and
SHA-256, stages or re-verifies the private runtime, and installs the same
combined installer with `/TYPE=devel` into an isolated build directory. It
exports only that explicit development root and pkg-config path to later CI
steps. The ephemeral runtime is used to compile/test the optional bindings and
tree verifier; no workflow uploads it.

The build hook can test a future native package with
`AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME=1`; it rejects an absent, incomplete,
extra, linked/reparse, hash-mismatched, or wrong-architecture tree. That gate is
not authority to distribute the current tree. The supported local Windows x64
interface-package entrypoint is:

```powershell
$env:AFFECT_RESEARCH_PACKAGE_COMMIT = (git rev-parse --verify HEAD).Trim()
pnpm desktop:bundle
Remove-Item Env:AFFECT_RESEARCH_PACKAGE_COMMIT
```

That wrapper requires a clean exact commit, uses `--no-default-features`,
applies `src-tauri/tauri.bundle-windows-unqualified.conf.json`, includes no
GStreamer resource, and disables the positive `native-acquisition-windows`
feature. Start, Resume, and Finalize therefore fail before mutation. Its
local output is an unprovenanced, non-distributable test artifact. The manual
CI packaging workflow separately writes all-false provenance that binds the
exact commit, workflow, and installer without claiming native media, input,
LSL, timing, installed workflow, or research qualification.

## Current safe integration boundary

The checked-in code can stage and verify the integration tree and report its
status without exposing paths. It cannot package that tree for distribution.
The GstPlay actor and application-window adapter are implemented behind the two
Windows FFI boundaries approved on 2026-09-10. Their focused audit and installed
qualification remain open. The native build must also solve and test safe pre-`main`
Windows DLL resolution; a nested Tauri resource directory or CI development
`PATH` is not a production loader design.

Until that actor, redistribution review, installed media matrix, lifecycle
fencing, audio, resize/DPI, shutdown/recovery, and timing qualification all
land, `nativeGstPlay` fails closed for qualified Start. The separately selected
`unqualifiedWebview` mode remains development-only and permanently labels its
attempt evidence unqualified. No build or UI may claim support for “all video
formats.”
