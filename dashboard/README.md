# Mission Control runtime

The dashboard the CLI serves. Plain ES modules, no build step: `serve.mjs` reads this directory
directly, and `packages/cli/dashboard/` is a generated copy (gitignored, produced by
`scripts/sync-cli-dashboard.mjs` at build/prepack time so the npm tarball can ship it).

| Path | Role |
| --- | --- |
| `serve.mjs` | HTTP server, auth gate, SSE |
| `start.mjs` / `start-broadcast.mjs` | loopback and LAN entry points, per-workspace port allocation |
| `dashboard-data.mjs` | snapshot builder for the panel |
| `dashboard.html`, `open.html` | panel and share shell |
| `lib/*.mjs` | guards, semantic model, live refresh, browser open, terminal snapshot |
| `lib/guards.d.mts` | hand-written types consumed by the CLI package (parity is pinned by a test) |

## Where the tests live

Tests for these modules are in `packages/cli/src/dashboard/*.test.ts`, not next to the source. The
CLI package owns the only test runner in the workspace (vitest), and those suites import the `.mjs`
files directly (`../../../../dashboard/lib/...`) so there is one implementation under test rather
than a copy. Lint and format are covered from the repository root (`pnpm lint` checks `dashboard/**`
before it fans out to the workspace packages).

`dashboard.html` is outside Biome's scope; CSS/HTML-only changes are covered by
`packages/cli/src/dashboard/plugin-ux-validation.test.ts` instead.

## Git tab and DevOps tab

The Git tab (`#git`) keeps the pre-rendered `git log --graph` markdown block and adds a
second, state-colored visual tree next to it, reusing the `.now-stepper`/`.now-step-marker`
timeline component built for the Current Mission panel (`renderGitVisualTree` in
`dashboard.html`, parsing `SNAPSHOT.git.graph`). It is single-lane by design — the markdown
block keeps the true branch-lane geometry; the stepper trades that for an at-a-glance
promotion read (HEAD, promoted to `origin/main`/`origin/staging`, or neither).

The DevOps tab (`#devops`) is scoped to CI/CD + deploy signal, separate from the
local-process-only Processes tab. `dashboard-data.mjs`'s `collectPipelineRuns()` shells to
`gh run list` (budget-guarded via `withinSnapshotBudget()`, fails soft to an honest
empty-state when `gh` is unavailable/unauthenticated); `collectDeploySignal()` reads `v*`
git tags plus the latest non-`Unreleased` `CHANGELOG.md` entry as a best-effort "what
shipped recently" proxy. Neither collector polls live infra/hosting — the DevOps tab never
implies monitoring it does not perform.
