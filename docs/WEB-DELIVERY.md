# Affect Tracker web delivery

The 2026-09-12 request establishes one public Affect Tracker landing page and
two separate companion app addresses. The browser Planner route now loads the
existing browser authoring runtime so it can save experiment JSON from GitHub
Pages. The browser Runner route now loads a separate Runner bundle that accepts
Planner master JSON, plays JSON-selected local videos through browser file
access, captures questionnaire responses and sampled valence/arousal rows, and
downloads a session CSV. It is not a substitute for the desktop Runner's native
LSL or XDF services.

| Public route | Source | Current behavior |
| --- | --- | --- |
| `/affect-tracker-research/` | `site/index.html` | Two icon links to Planner and Runner |
| `/affect-tracker-research/planner/` | `site/planner/index.html` | Browser Experiment Planner entrypoint using `site/src/research/browser-entry.js` |
| `/affect-tracker-research/runner/` | `runner/browser.html`, `runner/src/browser-entry.js` | Browser Experiment Runner bundle with CSV export instead of LSL/XDF |
| `/affect-tracker-research/research.html` | `site/research.html` | Earlier combined browser research prototype and compatibility alias |

The launcher requires no JavaScript, account, backend, or external runtime
assets. The Planner route requires the static browser authoring closure copied
by `scripts/build-research-pages.js`, including `site/src/research/`,
`site/research.css`, questionnaire definitions, and packaged browser assets. The
Runner route is built by Vite from `runner/browser.html` and uses
`runner/src/browser-adapter.js` for browser-only recipe loading, directory
access, fullscreen, local video object URLs, and CSV export. Do not publish
Tauri entrypoints or native adapters as a browser runtime.

## Build and deploy

Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm desktop:build`, and
`pnpm build:pages`. For local preview, serve `dist-pages` with a static server,
for example `python -m http.server 8000 --directory dist-pages`.

The existing `.github/workflows/pages.yml` validates changes and deploys only
successful `main` builds through the protected `github-pages` environment.
The repository Pages source is GitHub Actions. Its separate validation and
deployment jobs follow [GitHub's custom workflow guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
No second deployment service or dependency is required.

`scripts/build-research-pages.js` copies an explicit Planner source closure,
excludes native Planner adapters, builds the separate browser Runner bundle, and
renames its generated HTML to `runner/index.html`. `scripts/verify-research-build.js`
checks the four HTML entrypoints, their local links and assets under a GitHub
project prefix, module imports, selected logo, and the declared hashed Runner
bundle assets. Missing routes, broken relative paths, and files outside the
allowlist fail the build before upload.

The build emits `build-info.json` and a matching `build-revision` meta tag on
each entrypoint. After a push, check the Pages workflow for that exact commit
and fetch all entrypoints with a cache-busting query. Their revisions must
equal the remote `main` commit. Local builds with uncommitted changes are
previews, not evidence for a published revision.

## Next app integration

Browser Runner CSV qualification uses
`scripts/qualification/browser-runner-csv-stress.mjs <browser> <output-dir>
[iterations] [4|5]`. The harness runs the production browser adapter with
mocked Chrome/Edge file handles, repeated complete and partial attempts,
SurveyJS questionnaire completion, local-video object URL resolution, affect
sampling, and CSV download capture. The 2026-09-14 evidence pass covered Chrome
v5, Edge v5, and Chrome v4 with four iterations each.

Deployed Pages CSV qualification uses
`scripts/qualification/live-pages-runner-csv-stress.mjs <browser> <output-dir>
[iterations] [4|5] [runner-url]`. This launches the actual GitHub Pages Runner
URL in the named browser, injects test-only File System Access/media/download
shims before the deployed bundle starts, fetches the live `build-info.json`, and
saves the intercepted CSV downloads for reconstruction through the production
Runner recipe reader. Its receipts prove the deployed static Runner route for
the exact reported Pages revision; they still do not qualify native LSL, XDF,
GStreamer, installed desktop playback, physical input, or full-duration timing.

Preserve strict recipe compatibility and platform capability checks; native LSL,
XDF recording, GStreamer playback, and other desktop services do not become
browser features through a static deployment. Their implementation belongs to
the desktop app. The launcher is navigation only and owns no experiment data.
