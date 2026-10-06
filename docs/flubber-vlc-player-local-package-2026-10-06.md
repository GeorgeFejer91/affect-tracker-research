# Flubber VLC Player local package check — 2026-10-06

The Windows player installer was built from source commit
`b8c3b0eeb990451c0b83a7e64b0690829a47cd64` with
`package-player.ps1 -CompileInstaller`. The generated setup is
`Flubber_VLC_Player_Setup_0.1.0_x64.exe`, 102,811,436 bytes, SHA-256
`c10953bb26e25c60a445543ba323e165cf88b279cb8bb164165075f8a789739b`.
Its provenance records manifest SHA-256
`a3340d1e9baa9cf65d851f516bc4cc8984476b3931100305542420f9d437a4c7`
and payload-manifest SHA-256
`3e4d5210ad43390f8639c59975de8c639d0fddbd51b378dcb84baf0751519303`.
The staged manifest enumerated 604 files; all 604 names and hashes matched.

Silent internal installation succeeded with exit code 0 when the directory was
explicitly set to `%LOCALAPPDATA%\Programs\FlubberVLCPlayer`. Inno Setup
otherwise reused a directory from an earlier test install with the same AppId.
The installed manifest hashes match the provenance, and all 604 installed
payload hashes match the manifest. Installed `FlubberVLC.exe --help` exited 0
and listed inspection, selected-video/sequence and supervised local-control
commands. The matching Recorder package script accepted these exact setup and
manifest hashes in its validate-only preflight.
The installed executable also inspected the checked-in canonical Planner
master1 fixture with explicit P001/variant-3/English/desktop selection, exiting
0 with the `affect-runner-master-plan` v1 schema, ten steps and plan SHA-256
`e24b7472da37e6eb55b6a04bd401728c99eb8efa76d78e8e16da515e411eeffb`.
The integrated FlubberRecorder source, built as a local debug executable with
the two exact manifest hashes embedded, exited 0 for `--verify-player` against
that installed player. This checks its dependency verifier; it is not a
Recorder installer or interactive control test.
The installed player also completed a same-PC `--control-stdio` greeting,
correlated idle `status` request and correlated `shutdown` reply, then exited
0. This no-media smoke does not attest to playback or sequence recording.

This is an internal packaging and command-line check of the `b8c3b0e`
candidate. Later source commits need a new installer and provenance. Visible
video playback, physical input, LSL/XDF capture, Recorder installed controls,
and research qualification have not been observed here.
