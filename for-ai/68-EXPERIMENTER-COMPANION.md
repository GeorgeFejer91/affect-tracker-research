# Absent Minded Professor — Runner experimenter companion

## Dated user amendment — 2026-09-12

The researcher explicitly allocates R1/RR-11 implementation: an Internet-capable,
QR-paired browser/phone companion for the Windows Runner, using the established
BRSP/VDO.Ninja/Tauri remote-application patterns. This supersedes the RR-11
preview-only and remote-controller deferrals in 16 and 65 for this feature only.
RR-12 participant phone input remains outside this allocation.

Windows is the participant-facing authority. Its configured local device alone
changes Flubber input; sampling, experiment timing, LSL and durable recordings
remain local. The experimenter-facing browser observes and requests Start,
Pause, Resume and Stop through the same native operations. It is not an
autopilot: connection, disconnection or stale data cannot start an experiment or
invent participant responses. Local preparation and native readiness gates apply.

The user additionally requests two vertically stacked, read-only timelines:
valence above arousal, sharing an authoritative experiment-time axis. A Ratings
timeline widget opens these plots in a popup dialog when activated. Live
observations are a bounded, downsampled monitor; connection gaps stay visible.
Original samples and recordings remain the local source of research data.

## Allocated pass and shared seams

- Owner: Match landing page app icons task, branch
  `codex/segment-runner-professor-companion`, stopped base `3301440`.
- Stage: Backend Verification, followed by companion UI and delivery checks.
- Deliverable: explicit local Enable/Disable, fresh expiring QR invitation,
  authenticated experimenter connection, native-authorized semantic controls,
  sanitized live state, stacked rating timelines and bounded low-resolution
  preview of the currently playing native video.
- Shared seams: Runner professor dialog/bootstrap; additive Runner-only native
  commands/state; existing package protocol start/pause/play/finish; separately
  agreed read-only native video and sampled-state projections. Master-consumer
  methods remain owned by Experiment Runner. Canonical integration remains owned
  by Add segment confirmation flow.
- Recipe contribution: none. No Planner fields or persisted recipe schemas change.
- Verification: native authorization/expiry/dedupe/denial tests; BRSP pairing and
  lifecycle tests; browser-to-native acknowledgements; invalid participant-input
  requests; low-resolution media bounds; Chrome/Edge responsive and gap rendering;
  frontend/native builds and exact public asset/route checks.
- Separate evidence boundaries: source/component tests, real WebRTC transport,
  packaged Windows execution, physical phone/network handoff and final research
  qualification. Existing native player/input gates are retained.

## Connection and data contract

Verified base comparison for this pass:

| R1/RR-11 seam | Verified at stopped base3301440 | Bounded implementation |
|---|---|---|
| Professor widget | Static preview QR; no connection | Explicit Enable/Disable, expiring native invitation and authenticated browser |
| Experiment controls | PackageProtocolRuntime owns Start/Pause/Play/Finish | Same operations behind native scope/revision/dedupe checks; local preparation arms Start |
| Ratings | Native samples written by package worker | Optional nonblocking mailbox only after successful sample write; two read-only popup plots |
| Video | GstPlay actor owns playback; decode probe seeks | Separate read-only live snapshot command; never reuse the seek-based probe |
| Recipe JSON | Frozen package-v1 reader | No JSON contribution or changed sampling/storage contract |

This adapter targets the frozen package-v1 runtime. Experiment Runner's stopped
master core0aab279 is a separate authority: its owner requires master remote Start
to wait for the versioned S2 demographic/Start freeze. That adapter and canonical
Pages integration remain explicit collector seams, not claimed correspondence.
The master sampler can use `publish_projection(MonitorSample)` without fabricating
legacy settings or assignment hashes. Master Presented/Draft/Submit stay local.

Networking starts only from Enable in the local Runner and Connect in the
companion. The pinned VDO.Ninja SDK supplies signaling and direct/TURN WebRTC.
The static HTTPS companion has no Tauri privileges. BRSP/1 mutual proof binds
fresh session, peer/epoch and negotiated scopes; native authorization also checks
the active generation, scope, command ID, control revision and preconditions.
Invitations use URL fragments, are removed from browser history on ingestion,
expire, and are cleared on Disable/reload. No room, secret or proof is logged.

Only one experimenter is admitted per enabled session. Reliable acknowledged
commands and latest-state/video projections have bounded separate queues.
Overload drops preview updates, never authoritative samples or command outcomes.
State freshness is distinct from transport readiness; stale controls are disabled.
Disconnect leaves the local experiment under local control and retains its data.

Public state excludes names, questionnaire answers, native paths, raw logs,
credentials, recipe bytes and recorded files. The approved outbound observations
are run progress, operational readiness, current stimulus timing, live valence
and arousal, recording health and the optional current-video preview. The browser
stores no research files and cannot set ratings, submit answers, choose paths,
invoke arbitrary native commands, send raw input or execute shell commands.

The remote application interface is a fixed semantic command socket usable by
the browser and automation adapters. RustDesk informs connection/session
structure only; its generic remote-desktop input and AGPL implementation are not
part of this application.
