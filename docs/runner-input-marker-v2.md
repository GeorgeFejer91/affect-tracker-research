# Runner supplemental input markers v2

The Planner's `affect-research-marker` v1 vocabulary and all existing v1
observations remain unchanged. During a Runner video occurrence, the native
worker may add `affect-research-marker` v2 observations to the same ordered
information stream. These are Runner evidence, not Planner-authored events.

V2 retains every v1 identity, context, sequence and `monotonicMs` field.
`monotonicMs` is the worker's ordered publication observation. V2 adds
`observedMonotonicMs`, measured from the same run epoch at the original native
input callback. It can precede `monotonicMs`; the worker never substitutes its
poll time or the input reducer's ordering adjustment for this value. The
information frames' LSL/XDF timestamps remain
their actual publication times. A reader must retain both clocks and must not
infer that publication time was physical input time.

`inputEdge` has an `input` object with exactly `direction` (`up`, `down`, `left`
or `right`), `applyStep`, `inputActive` and `impulse` booleans. It is bound to
the currently playing video entry/execution/source. It records accepted
physical digital press, release and wheel impulses; authority-generated
releases are not labeled physical. The native mailbox remains bounded and
fails closed on overflow.

`neutralReset` omits `input`. It immediately follows the matching `videoEnd`
observation after the native response has been reset to `(0, 0)`. Its
`observedMonotonicMs` equals its `monotonicMs`. The same run and marker sequence
continues across v1 and v2. Readers validate v2 context and ordering, then
apply the unchanged v1 planned-occurrence rules to lifecycle observations.
The boundary marker does not add an out-of-cadence affect sample: the last
scheduled state sample before video end may still be nonneutral. The next
scheduled sample uses the reset state.
An unknown version or malformed v2 record is rejected. This does not authorize
the session-draft neutral hotkey or controller override; both remain blocked
until their native receipt and recovery contract exists.
