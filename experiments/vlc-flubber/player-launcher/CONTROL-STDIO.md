# Flubber VLC same-PC control v1

Start the player as a supervised child with `FlubberVLC.exe --control-stdio` and
redirect both stdin and stdout. The launcher keeps the VLC child alive and emits
only one JSON object per stdout line. Do not send commands to VLC's internal
loopback RC port; the launcher does not publish it.

The first reply is `{"protocol":"flubber-vlc-control/v1","requestId":null,"ok":true,"state":"idle","generation":0,"error":null}`.
Send one UTF-8 JSON object per stdin line, at most 16 KiB before the newline:

```json
{"protocol":"flubber-vlc-control/v1","requestId":"arm-1","command":"arm","videoPath":"C:\\media\\clip.mp4"}
```

`arm` may also specify `panelPercent` and `stepPercent`. It prepares one video,
starts the native player, and returns `state: "armed"` with a new `generation`.
Commands `start`, `pause`, `resume`, and `stop` require that generation and no
video fields. `shutdown` is always accepted and ends the child session. Replies
repeat the request ID, current generation, accepted command state, and an error
code when `ok` is false. `start-requested` and `pause-requested` mean that the
VLC RC write succeeded; they do not attest to a presented frame or recording.
The launcher emits an uncorrelated `child_lost` error and exits if VLC exits.
It kills VLC on stdin EOF, stdout failure, shutdown, and other session exits.

This mode accepts a single video only. Saved Planner master JSON remains
inspection-only through `--inspect-master`; master execution, Runner recording
gates, shared LSL/XDF evidence, and installed timing qualification are still
open.
