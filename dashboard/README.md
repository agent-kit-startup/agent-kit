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
| `lib/*.mjs` | guards, semantic model, live refresh, browser open, terminal snapshot, headless run feed (`run-logs.mjs`) |
| `lib/guards.d.mts` | hand-written types consumed by the CLI package (parity is pinned by a test) |

## Where the tests live

Tests for these modules are in `packages/cli/src/dashboard/*.test.ts`, not next to the source. The
CLI package owns the only test runner in the workspace (vitest), and those suites import the `.mjs`
files directly (`../../../../dashboard/lib/...`) so there is one implementation under test rather
than a copy. Lint and format are covered from the repository root (`pnpm lint` checks `dashboard/**`
before it fans out to the workspace packages).

`dashboard.html` is outside Biome's scope; CSS/HTML-only changes are covered by
`packages/cli/src/dashboard/plugin-ux-validation.test.ts` instead.

## Embedding (action seam, CSP readiness)

A host page can replace the copy-to-clipboard default by defining
`window.__MISSION_CONTROL_ACTIONS__ = { perform(action) }` before the panel's script runs;
every action is one `{ kind: "copy", text, subject, destination, toastMessage }` record. The web
dashboard keeps the copy-only default. Contract, CSP readiness counts and the innerHTML sink
audit: `docs/mission-control-embedding.md`. The snapshot shape is versioned by `dashboardDataVersion`
and published as `docs/contracts/mission-control-snapshot.schema.json`. The Flight Log lists pending
operator tickets (gate exits awaiting triage) read-only from `gateExit`
(`lib/gate-exit-tickets.mjs`, the no-fetch mirror of `agent-kit ground-control status`).

## Colony section

**Colony** (`#colony`, in the More menu) is a single-player game panel over the snapshot's
`outcomeLedger` field (1.9.0, `lib/outcome-ledger.mjs`; ADR
`2026-10-23_colony-game-canon-outcome-ledger-art-policy.md`). A 61-tile hex map (SVG, no image
needed) turns from fog and grey ground to green as verified outcomes accrue: the ledger alone
greens up to 60% of it, finished buildings green the rest. Logic, Compute and Rare are the
ledger totals minus what the player spent. Building queues a structure for a real-time
duration; the player's state (spent resources, queue, buildings) lives only in this browser's
`localStorage` (`agent-kit-colony-state-v1`), and timers are `startedAt` + duration evaluated
when the panel renders: no timer, no extra polling, no server write. A streak of at least 3
to-dos closed in a row, the last within 2 hours (`outcomeLedger.flow`), runs builds 25% faster.
Art: at most 4 images, 400 KB together, in `art/` (re-encoded from the Colony app's curated
set); a host that cannot serve them gets the panel without images. An older engine without
`outcomeLedger` shows an update hint.

## Git e CI/CD section

The former Git and DevOps tabs are one section, **Git e CI/CD** (`#git`; `#devops` and
`#git-cicd` still deep-link there through `SECTION_ALIASES`), laid out as a bento grid
(`.bento`, 6 columns on the skin tokens; one column below 900px). Tiles: Ship lane, Promotion
flow, Open pull requests, CI/CD pipeline, Deploy activity, Branch graph, and Changed files when
the tree is dirty. The Ship lane and Open pull requests tiles read the snapshot's `shipLane`
field (1.8.0, `lib/ship-lane.mjs`) and show an empty state on an older engine. Every action is
copy-only: the ship lane copy buttons carry their command in `data-ship-copy` and go through one
delegated listener into `copyForPaste`, with no inline handler. ADR
`2026-10-23_git-cicd-tab-read-in-mc-act-in-colony.md`.

The branch graph tile keeps the pre-rendered `git log --graph` markdown block and adds a
second, state-colored visual tree next to it, reusing the `.now-stepper`/`.now-step-marker`
timeline component built for the Current Mission panel (`renderGitVisualTree` in
`dashboard.html`, parsing `SNAPSHOT.git.graph`). It is single-lane by design — the markdown
block keeps the true branch-lane geometry; the stepper trades that for an at-a-glance
promotion read (HEAD, promoted to `origin/main`/`origin/staging`, or neither).

The CI/CD pipeline and Deploy activity tiles are scoped to CI/CD + deploy signal, separate
from the local-process-only Processes tab. `dashboard-data.mjs`'s `collectPipelineRuns()` shells to
`gh run list` (budget-guarded via `withinSnapshotBudget()`, fails soft to an honest
empty-state when `gh` is unavailable/unauthenticated); `collectDeploySignal()` reads `v*`
git tags plus the latest non-`Unreleased` `CHANGELOG.md` entry as a best-effort "what
shipped recently" proxy. Neither collector polls live infra/hosting — the section never
implies monitoring it does not perform.
