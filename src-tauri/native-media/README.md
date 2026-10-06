# Windows video playback

Standard Experiment Runner uses its Windows WebView video element. Flubber VLC
Runner is a separate program with a separate VLC playback path. Neither path
inherits qualification from the other.

The standard Runner's Rust worker remains the authority for experiment steps,
sampling, outbound LSL, and XDF recording. WebView video must present a
hash-bound source and report run-, attempt-, step-, and generation-fenced
decoded playback status to that worker. Sampling begins only after accepted
playback evidence, pauses on a stall or pause, and advances only after an
observed end. Error, stale status, or missing evidence fails closed.

The existing WebView preview/CSV route is unqualified. A native recorded run
requires installed playback and timing checks plus independent XDF readback
before a qualification claim. See
[`for-ai/30-TESTING-AND-RELEASE.md`](../../for-ai/30-TESTING-AND-RELEASE.md).
