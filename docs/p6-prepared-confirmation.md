# P6 confirmation publication

Backend Verification for P6-04/P6-05 and the allocated CLI confirmation seam.
Main composes the application; S7 owns registry acceptance. Existing GUI
`authoring.prepare()` and `acceptLayout()` keep their immediate behavior.

`await authoring.prepareConfirmation({isCurrent, signal})` uses the existing
live P1/P5 validation and geometry compiler, then the editor's synchronous
`prepareConfirmation({isCurrent, signal})`. Use the authoring entrypoint in
application composition: the editor alone validates its currently bound geometry
but does not own live producer validation. Preparation never calls refresh,
changes owner state, renders or notifies. Included XR requires complete current
producer content and matching editor bindings; stale or pending bindings reject.
Excluded XR needs no ready producers and keeps its inactive draft untouched.

Both entrypoints return a guarded candidate:

```js
{ get snapshot(), isCurrent, commit, afterCommit }
```

The detached future `snapshot` has exactly the existing registry-consumer shape:
`{enabled, revision, pending, contribution, dependencyRevisions}`. Included XR
has revision +1, pending false and the complete validated `XrLayoutProfileV1`
contribution. Dependency revisions are preserved. Excluded XR keeps the exact
existing disabled snapshot, with no contribution and no revision advance,
matching the existing GUI no-op. No included/excluded wrapper changes this
owner snapshot contract. Every getter returns a detached copy, stable and
readable before and after commit.

The single-use synchronous `commit()` rechecks request/abort, lifecycle,
original owner revision and complete dependency identity, then installs only
previously validated accepted state. It does no rendering, notification or
asynchronous work. `isCurrent()` becomes false after commit. `afterCommit()`
uses the continuing command lifetime and committed revision, renders/notifies
once for included XR, and remains a no-op for excluded XR. Projection failures
retain the committed state and are not replayed on retry. No registry
acceptance, native access, runtime or headset capability is introduced.

Focused tests use the real editor and authoring owners with DOM doubles and
counted writes. They verify read-only preparation, exact future/live equality,
detached getters, included/excluded behavior, stale/reset/dependency guards,
abort during asynchronous validation, disposal, single use, deferred projection,
projection failure and unchanged GUI preparation. These are software checks;
Main owns actual CLI integration and S7's registry composition validation.
