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

An exclusive `arm` alternative accepts a selected Planner master:

```json
{"protocol":"flubber-vlc-control/v1","requestId":"master-1","command":"arm","masterSequence":{"masterPath":"C:\\study\\experiment.json","participantId":"P001","selector":{"variantId":"variant-3","languageId":"en","languageSelectionPath":["both","en"],"presentationTarget":"desktop-screen"}}}
```

It freezes the exact master and selected plan at Arm. `start` rechecks that
identity before a diagnostic video/ISI sequence. `status` uses the current
generation and returns the current phase; after a terminal result, it includes
a bounded `sequenceReceipt` with `status`, `path` and `sha256`. `stop` may
report `stop-requested` while the owned child is being cancelled and reaped;
poll `status` for the terminal reference. Master-sequence pause/resume are
rejected. The launcher sends no unsolicited status frames. A failed early
Start or cancellation retains the Arm identity in its terminal receipt.

This selected-sequence path still rejects questionnaires and does not use the
standard Runner's live input, timing, LSL or XDF authority. It is diagnostic
playback, not a qualified research attempt. The separate Flubber VLC Runner
must consume the shared Runner worker and installed qualification gates before
research execution is available.
