# HTML video geometry for saved catalogue v3

The 2026-10-04 media change retires the former native renderer proof. Current
Planner and Runner use the HTML video element. P1 records the element's verified
`videoWidth` and `videoHeight` after the prepared file loads and representative
frames decode. The catalogue records the resulting reduced aspect ratio with
`source: "browser-decoder"`, `rotationDegrees: null`,
`pixelAspectRatio: null`, and
`metadataInterpretation: "decoder-oriented-display"`.

Catalogue version 3 retains its exact path, content ID, duration, ordering, and
integrity rules. Its current geometry reader accepts the same eight-key HTML
geometry as versions 1 and 2. Renderer configuration, raw pixel-aspect tags and
native snapshot metadata are outside this contract. A source file is first
inspected by FFprobe; FFmpeg prepares a playable copy when needed. Only the
prepared file is scanned, bound to the saved recipe, and issued to Runner.

The replacement is implemented in source with focused canonical fixtures.
Clean-install media preparation, actual installed playback, and Runner/XDF
correspondence remain separate qualification gates. Prior native proof receipts
in Git history are historical evidence and do not qualify the current build.
