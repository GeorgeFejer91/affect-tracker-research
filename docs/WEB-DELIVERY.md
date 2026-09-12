# Affect Tracker web delivery

The 2026-09-12 request establishes one public Affect Tracker landing page and
two separate companion app addresses. This is the website infrastructure stage;
it does not port the current desktop programs or qualify browser experiments.

| Public route | Source | Current behavior |
| --- | --- | --- |
| `/affect-tracker-research/` | `site/index.html` | Two icon links to Planner and Runner |
| `/affect-tracker-research/planner/` | `site/planner/index.html` | Explicit development status for the future online authoring app |
| `/affect-tracker-research/runner/` | `site/runner/index.html` | Explicit development status for the future online execution app |
| `/affect-tracker-research/research.html` | `site/research.html` | Earlier combined browser research prototype |

The launcher and app status pages require no JavaScript, account, backend, or
external runtime assets. They share `site/launcher.css`, the selected Aurora
Axis logo, relative links, keyboard focus styles, and narrow-screen reflow.
The two companion routes must retain their addresses when their actual apps
replace the status pages. Do not label the earlier combined prototype as the
new Planner or Runner, or publish native adapters as a browser runtime.

## Build and deploy

Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm desktop:build`, and
`pnpm build:pages`. For local preview, serve `dist-pages` with a static server,
for example `python -m http.server 8000 --directory dist-pages`.

The existing `.github/workflows/pages.yml` validates changes and deploys only
successful `main` builds through the protected `github-pages` environment.
The repository Pages source is GitHub Actions. Its separate validation and
deployment jobs follow [GitHub's custom workflow guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
No second deployment service or dependency is required.

`scripts/build-research-pages.js` copies an explicit source closure and excludes
native adapters. `scripts/verify-research-build.js` checks the four HTML entrypoints,
their local links and assets under a GitHub project prefix, module imports, and
selected logo. Missing routes, broken relative paths, and files outside the
allowlist fail the build before upload.

The build emits `build-info.json` and a matching `build-revision` meta tag on
each entrypoint. After a push, check the Pages workflow for that exact commit
and fetch all entrypoints with a cache-busting query. Their revisions must
equal the remote `main` commit. Local builds with uncommitted changes are
previews, not evidence for a published revision.

## Next app integration

Bring in the verified Planner browser entrypoint and its explicit asset closure
under `planner/`, then do the same for a separately implemented browser Runner.
Preserve strict recipe compatibility and platform capability checks; native LSL,
XDF recording, playback, and other desktop services do not become browser
features through a static deployment. Their implementation belongs to the
separate app work. The launcher is navigation only and owns no experiment data.
