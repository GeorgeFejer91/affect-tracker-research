# Experimental phone control profile

The Rust/Tauri Flubbercorder remains the single authority. The phone page
can request only Start, Pause, Resume, and Stop. It receives a bounded live
projection of the experiment phase, Flubber LSL values, stream status, and
markers. Recipe paths, output paths, raw recordings, and local configuration
do not cross this interface. VLC alone renders the video and Flubber.

Phone control is a **manual session**: the experimenter presses Give control
in the installed app, which starts a listener bound to one detected private
IPv4 address. Public IPv4 interfaces are rejected. A random 256-bit link
secret is generated for that session.
Revoke closes the listener and invalidates the secret. The app does not
change Windows firewall settings or start a background service. A phone must
be able to reach the computer on the same trusted network; a local firewall
may still block it. `FLUBBERCORDER_PHONE_HOST` can select a private
interface, or loopback for a same-computer test. This machine has only a
public Ethernet address, so a real phone test needs a private hotspot or
other private network connection.

This prototype serves HTTP on the local network. Its bearer link can be
observed by someone with access to that network; use it only on a trusted
network. It has no public internet reachability, TLS, password pairing, or
remembered browser credential. It must not be described as a secure remote
control service. The link grants only the four named actions and can be
revoked locally. A future wider-network release needs authenticated TLS or
a reviewed peer transport and device authorization.

One browser command carries a random ID. Rust validates the ID and closed
action set, applies the action through the same session methods as Tauri IPC,
and returns an applied revision. Duplicate IDs within the bounded active
session return the prior result. Browser refreshes read a fresh authoritative
snapshot; no browser state is accepted as experiment truth.
