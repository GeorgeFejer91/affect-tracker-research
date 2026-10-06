# Supervised decoded VLC observations (source seam)

The opt-in single-occurrence command is separate from FlubberRecorder's
`--control-stdio` v1 protocol:

```text
FlubberVLC.exe --play-master-video MASTER.json --participant P001 --selector-json SELECTOR_JSON --entry-id VIDEO_ENTRY --live-binding-json BINDING_JSON
```

`BINDING_JSON` is
`{"attemptId":"ATTEMPT","generation":1,"workspaceFileId":"FILE"}`.

The launcher uses the existing strict Planner master reader and copies the
selected video only after checking its saved byte length and SHA-256. Its
`position` and `assetSha256` come from that selected plan; the supervising
Runner supplies its current attempt, generation and exact workspace file ID.
The Runner must independently compare every field to its own active binding.

The bundled filter writes `FLUBBER_LIVE_V1` lines to the owned VLC child's
stdout **after successful decoded Render**. The supervising host must
continuously drain launcher stdout: backpressure on that pipe can stall VLC's
Render callback. The launcher accepts bounded,
ordered frame lines and writes one JSON object per stdout line under
`flubber-vlc-runner-live/v1`. Observations have `kind: "observation"`,
`observationSource: "decoded-render"`, `backend: "vlc"`, the five binding
fields, sequence, decoded frame count, media position, and `playing` or
`ended`. `ended` requires the filter's decoded completion sentinel. It is
never inferred from a request acknowledgement, a process exit, or the event
CSV. Plugin/launcher CSV files are diagnostics only; the shared Runner owns
all samples, markers, LSL, XDF and attempt evidence. The terminal line has
`kind: "terminal"` and `ended`, `stopped`, or
`failed`; it is not a playback observation.

In this opt-in mode the VLC filter ignores its legacy arrow-key and shared
memory affect controls, and its own LSL outlet is disabled. It renders neutral
feedback until the shared Runner's feedback state is projected into VLC in a
separate pass. The legacy FlubberRecorder/player mode retains its controls.

The supervising process may send JSON lines on stdin with `protocol`,
`requestId`, `generation`, and `command: "stop"`. Pause and resume requests
return `ok: false` and `state: "unsupported"` until VLC can report an observed
paused state. Command replies have `kind: "command"` and a requested state.
They are not observed playback states and cannot open or close the Runner's
sample clock.
Closing stdin requests VLC shutdown. The launcher retains and reaps its VLC
child, and a missing decoded completion fails closed. This source seam does
not yet connect a VLC child to `MasterWorker`; pause needs an observed state
before it may become a Runner pause, and installed/physical playback and the
shared LSL/XDF contract remain open.
