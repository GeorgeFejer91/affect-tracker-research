# FlubberRecorder local shell

This is a separate Windows Tauri application and NSIS bundle. It contains no
VLC, FFmpeg, player launcher, video, Node runtime, LAN listener, or research
session engine. It verifies the seven files in the independently installed
FlubberVLC Player's `manifest.json`, then calls its `--inspect-master` command
to inspect a selected Planner master. The selected master and player location
remain in memory. Research Start is disabled.

By default the player is expected at
`%LOCALAPPDATA%\Programs\FlubberVLCPlayer`. A different local installation
folder can be selected in the UI. Before accepting any installed player, the
Recorder requires `FLUBBERVLC_MANIFEST_SHA256` embedded at build time. Its value
must be the SHA-256 of the **exact manifest.json bytes** from the trusted player
package. With the value absent or malformed, player selection and master
inspection fail closed. With a trusted pin, missing, altered, or linked
components are rejected. A manifest supplied only by the installed player is
not a trust anchor.

The pin is intentionally absent in this source build: no qualified published
player package exists yet. The player installer must be installed separately
for now. A published, qualified player setup asset with fixed URL and SHA-256
is required before Recorder setup can download and verify it; no download URL
is assumed. The packaging pass must record the source artifact and exact pin.

Build the Windows installer with `pnpm install --frozen-lockfile` followed by
`pnpm build` from this directory when Windows build prerequisites are available.
Installed player inspection and a
fresh NSIS install have not been qualified yet.

The current hash check reads files before starting the player. Replacing the
executable between verification and process creation remains a race and needs
an installed Windows validation and launch-hardening pass before a secure
execution claim.
