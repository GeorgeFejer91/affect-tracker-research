# FlubberRecorder local shell

This is a separate Windows Tauri application and NSIS bundle. It contains no
VLC, FFmpeg, player launcher, video, Node runtime, LAN listener, or research
session engine. Its setup downloads an exact standalone Flubber VLC Player
installer from a fixed HTTPS URL, checks the installer SHA-256, and runs that
installer into the default local player directory before copying Recorder files.
It verifies the installed player through
the same native trust check after Recorder files are copied. A failed download,
digest, player install, or installed-payload check stops Recorder setup; the
player retains its independent installation and uninstaller.
If the final installed-payload check fails after Recorder files are copied,
NSIS reports a failed setup but may leave Recorder files, shortcuts, or an
uninstaller entry behind. Remove that partial Recorder installation before
retrying or repairing it. The Recorder shell may still open, but player status,
selection, connection, and master inspection require the embedded player hashes
and reject an untrusted payload. The separately installed player is not rolled
back by a Recorder setup failure.

Recorder verifies the seven critical files in the independently installed
FlubberVLC Player's `manifest.json` and every player payload file in
`payload-manifest.json`, then calls its `--inspect-master` command
to inspect a selected Planner master. The selected master and player location
remain in memory. The local Connect action starts a supervised player child
through `--control-stdio`; Disconnect sends a correlated shutdown request and
tears down the child. Replies are bounded, checked for protocol, request ID,
state and generation, and time out closed. Research Start is disabled; the
single-video arm/start commands are not exposed to the UI or treated as
Planner-master execution evidence.
On disconnect or failure, Recorder closes stdin and gives the player two
seconds to exit before force-killing a hung launcher. Forced termination of the
launcher does not yet guarantee its VLC child exits on Windows; this lifecycle
case needs installed validation and a reviewed process-tree strategy.

By default the player is expected at
`%LOCALAPPDATA%\Programs\FlubberVLCPlayer`. A different local installation
folder can be selected in the UI. Before accepting any installed player, the
Recorder requires both `FLUBBERVLC_MANIFEST_SHA256` and
`FLUBBERVLC_PAYLOAD_MANIFEST_SHA256` embedded at build time. Each value must
be the SHA-256 of the corresponding **exact manifest bytes** from the trusted
player package. With either value absent or malformed, player selection,
master inspection, and local control fail closed. The payload inventory must
match the installed player files; missing, extra, altered, or linked files and
unsafe relative paths are rejected. The installer's own files in the real
top-level `uninst` directory are excluded from the player payload check.
Manifests supplied only by the installed player are not trust anchors.

The pins and download URL are intentionally absent from ordinary source builds:
no qualified published player package exists yet. Build Recorder setup only
after a fixed player asset URL and the exact player setup plus package-provenance
files exist. The standalone player setup remains independently usable. No URL
is assumed by the source or installer hook.

Build the Windows installer from this directory with `pwsh -File
build-recorder-installer.ps1 -PlayerSetupUrl HTTPS_URL -PlayerSetupPath SETUP_EXE
-PlayerStagePath PLAYER_STAGE -PlayerProvenancePath PROVENANCE_JSON` when the
published URL exists. The script validates the exact setup SHA-256 and both raw
manifest hashes against the player package provenance, installs locked frontend
dependencies, embeds the pins in the Recorder executable, and creates the NSIS
bundle. Direct unpinned release builds fail. The installer invokes
`FlubberRecorder.exe --verify-player` after installation to check the complete
payload without starting the UI. The build writes `recorder-package-provenance.json`
beside the NSIS setup with exact Recorder and player artifact identities. No
source URL is baked into this repository; the manual
`flubber-recorder-package.yml` workflow requires the fixed player setup and
provenance URLs with independently known SHA-256 hashes. It only uploads an
unqualified package candidate. No Recorder installer or installed player
inspection has been qualified yet; test
exact download, offline and tampered
failures, fresh install, launch, upgrade, and separate uninstall before promotion.

The current hash check reads files before starting the player. Replacing the
executable between verification and process creation remains a race and needs
an installed Windows validation and launch-hardening pass before a secure
execution claim.
