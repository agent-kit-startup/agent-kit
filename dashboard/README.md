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
