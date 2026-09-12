# Pages CLI reference maintenance

`site/about/index.html` owns public prose and examples. The Pages builder calls
`buildCliReference(repositoryRoot, outputRoot)` from `scripts/render-cli-reference.mjs`.
It inserts the captured catalogue and renders the external command table directly
from `docs/planner-cli-consequential-commands-v1.md`. No manual field or argument
inventory is maintained in the page.

The integration owner produces `planner-authoring-catalogue.json` from a successful
production `catalogue` query, retaining descriptors only, with this envelope:

```json
{
  "schema": "affect-research-planner-cli-catalogue-reference",
  "version": 1,
  "sourceRevision": "<40-character source commit>",
  "sourceFiles": [{"path": "<repository-relative source>", "sha256": "<64-character SHA-256>"}],
  "catalogue": {"settings": [], "operations": []}
}
```

Run `node scripts/capture-cli-reference.mjs <production-driver-evidence-directory>`
against the exact source used by that executable. The generator verifies the
transcript hash, finds the actual successful catalogue request/reply, and checks
every local JavaScript dependency against `git show <captured-revision>:<path>`.
Its separate evidence JSON retains executable/transcript hashes without private
paths or runtime IDs. Main must rebuild and recapture after a bound source changes.

Never copy snapshot values, file paths, session identifiers, private questionnaire
content or a hand-constructed owner registry into that public artifact. Bind actual
registration, the session and all seven descriptor modules plus their metadata
dependencies. The renderer fails if any bound source changed, a required source is
missing, an owner is absent or an identifier is repeated. Recapture through the
current executable after source changes; do not update hashes to bless an old query.

Run `node scripts/render-cli-reference.mjs --check`, the focused
`test/research-cli-reference.test.js` tests and `npm run build:pages`. The normal
Pages build and verification also check freshness and exact rendered HTML. No new
runtime dependency or browser/native authority is needed. About is an independent
static route, with project-relative links and no required JavaScript.

Keep verification dated and source-bound: a captured descriptor, actual native
query/edit, UI parity, complete recipe export and Runner execution are different
claims. Update the availability prose when evidence changes. The agent maintenance
entry point is `for-ai/71-CLI-LIBRARY.md`, owned by Chat Orchestrator. Main integration
owns publication and combines the landing navigation link to `./about/`; this
branch does not replace the active landing, app or companion code.
