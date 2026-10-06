# FlubberRecorder local shell

This is a separate Windows Tauri application and NSIS bundle. It contains no
VLC, FFmpeg, player launcher, video, Node runtime, LAN listener, or research
session engine. It verifies the seven critical files in the independently installed
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

The pins are intentionally absent in this source build: no qualified published
player package exists yet. The player installer must be installed separately
for now. A published, qualified player setup asset with fixed URL and SHA-256
is required before Recorder setup can download and verify it; no download URL
is assumed. The packaging pass must record the source artifact and both exact pins.

Build the Windows installer with `pnpm install --frozen-lockfile` followed by
`pnpm build` from this directory when Windows build prerequisites are available.
Installed player inspection and a
fresh NSIS install have not been qualified yet.

The current hash check reads files before starting the player. Replacing the
executable between verification and process creation remains a race and needs
an installed Windows validation and launch-hardening pass before a secure
execution claim.
