# npm publish checklist (`@dadado/agent-kit-cli`)

Human-in-the-loop gate before the first npm publish or any publish that changes the live registry version. CI can publish automatically when a `v*` tag is pushed; treat tag creation and secret configuration as production actions.

## Preconditions

- [ ] Release content is on `origin/main` (promote via `git prod` from `origin/staging` when the release is not already on `main`).
- [ ] Root `package.json` `version`, `packages/cli/package.json` `version`, and the dated section in `CHANGELOG.md` match the intended release. **Tree today:** root + CLI + `CHANGELOG` `[5.0.0]` are aligned at **5.0.0**. **Registry today:** `npm view @dadado/agent-kit-cli version` is still **4.8.9** until `v5.0.0` publishes. Do not treat tree SemVer as live npm `latest`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` succeed on the **exact commit you intend to tag** (CI-green-at-tagged-SHA; see `.cursor/memory/decisions/2026-08-02_npm-5.0-go-no-go.md`). A later green SHA does not repair a red tagged commit.
- [ ] Public sync and other post-`git prod` steps are done or explicitly deferred per [repository-boundaries.md](repository-boundaries.md).

## Registry state (before first publish)

- [ ] Confirm the package is not on npm yet:

  ```bash
  npm view @dadado/agent-kit-cli
  ```

  Expect **404 Not Found** until the first successful publish.

- [ ] After a publish, the same command must return the version and metadata you expect.

## Version alignment

| Source | Field | Must match |
|--------|--------|------------|
| Repository root | `package.json` → `version` | Target release (e.g. `5.0.0`) |
| CLI package | `packages/cli/package.json` → `version` | Same as root |
| Changelog | Latest dated `[x.y.z]` section | Same version and date |

Do not tag or publish if any of these diverge.

## CI secret (`NPM_TOKEN`)

- [ ] On the **private** GitHub repository (`agent-kit-dev`), configure Actions secret **`NPM_TOKEN`**: an npm automation or granular publish token with permission to publish `@dadado/agent-kit-cli` (public access).
- [ ] Token is stored only in GitHub Secrets, not in the repo, chat, or CI logs.

### Behavior when the token is missing

The `publish-npm` job in `.github/workflows/ci.yml` runs on **`v*` tags** only. If `NPM_TOKEN` is unset, the Publish step prints `NPM_TOKEN not configured — skipping npm publish.` and exits **0** (green job, no upload). Do not rely on a missing token as a safety gate: pushing a new `v*` tag still runs the job and will publish once the secret exists.

## Tag strategy and CI

- [ ] Tags use the form **`vMAJOR.MINOR.PATCH`** (e.g. `v4.8.9`).
- [ ] **Existing tags on `origin`:** `v3.0.0` through `v4.8.9` (35 tags; full series: v3.0.0, v3.5.0, v3.5.1, v4.0.0, v4.0.1, v4.1.0, v4.2.0–v4.2.4, v4.3.0, v4.4.0–v4.4.7, v4.5.0–v4.5.1, v4.6.0, v4.7.0–v4.7.2, v4.8.0–v4.8.9). Next: `v5.0.0`. Pushing a **new** `v*` tag (or re-running CI for a tag) triggers `publish-npm` after `build` succeeds.
- [ ] Tag the commit on `main` that matches the release version; do not tag staging-only commits unless that is an explicit exception documented in the release notes.
- [ ] **Integrated with `/git-prod`**: Annotated tags are created automatically when absent during `/git-prod` workflow (step 9.5 in `autogit/gitupdate.md`). Manual tag creation via `git push origin vX.Y.Z` or GitHub Releases UI is fallback only.

## Local dry-run (no upload)

Run from the monorepo root after `pnpm build`:

```bash
pnpm --filter @dadado/agent-kit-cli publish --dry-run --access public
```

- [ ] Review the tarball file list (only `packages/cli/dist`, `packages/cli/dashboard/**` after Path C, and declared `files`; no `.cursor/`, secrets, or private memory).
- [ ] Confirm reported version matches `packages/cli/package.json`.
- [ ] Path C pack gate (no live npm tag required): `node scripts/verify-cli-dashboard-pack.mjs` exits 0 (`dashboard/start.mjs` + `start-broadcast.mjs` present). Version bump for the publish that first ships Path C remains `/git-prod` HITL (R3); do not bump from the verify script.
- [ ] Before Path C promote / publish: run `node scripts/sync-cli-dashboard.mjs` so `packages/cli/dashboard/` matches `dashboard/` SoT (Crew Monitor and other panel changes ship in the tarball).

Dry-run does not replace registry verification; it does not contact npm to confirm 404 vs published state.

## Explicit human confirmation (required)

**Do not** run `npm publish`, push a new `v*` tag, or add or rotate `NPM_TOKEN` for publish until a maintainer explicitly approves in a tracked channel (e.g. release thread, issue, or documented go/no-go).

Checklist for the approver:

- [ ] I confirm version alignment (root, CLI, CHANGELOG).
- [ ] I confirm `npm view @dadado/agent-kit-cli` state (404 for first publish, or expected version for upgrade).
- [ ] I have reviewed dry-run output for this version.
- [ ] I confirm `NPM_TOKEN` is configured if CI should publish on tag push.
- [ ] **Yes, proceed** with tag push (and thus CI publish) **or** with a one-off manual publish (only if deliberately chosen over CI).

If the answer is not an explicit **yes**, stop. No tag push, no token change for publish, no manual publish.

## After publish (verification)

These rows are **post-publish** only. Do not mark them Met from pre-tag mechanism review while registry `latest` is still behind the tree.

- [ ] `npm view @dadado/agent-kit-cli version` matches the release (for 5.0: expect `5.0.0`, not residual `4.8.9`).
- [ ] Smoke install: `npx @dadado/agent-kit-cli@<version> --help` (or `pnpm dlx`).
- [ ] Blank-folder dogfood: `npx @dadado/agent-kit-cli@5.0 install` (or `@5.0.0`) plus five assertions (`--version`, manifest pin, `hooks.json`, dashboard invoke, no nested `agent-kit/` folder). Owned after publish; blocked while `latest` is 4.8.9.
- [ ] Public GitHub Release Latest and public storefront label resolve to 5.0 (after tag + sync-public), not pre-tag mechanism-only checks.
- [ ] Scoped Path C smoke (blank folder): install the published package under `node_modules/@dadado/agent-kit-cli` and confirm `agent-kit dashboard` returns HTTP 200 on loopback (required after Path C / detach-start changes; also a `/git-prod` §12.5 row).
- [ ] GitHub Actions `publish-npm` job for the tag shows publish success (not skip), when using CI.

## Cross-lens go/no-go (before tagging)

Use this matrix with dogfood / `/git-prod` Step 12.5. Cite `.cursor/memory/` when a row fails.

| Lens | Check | Pass criteria | Known footguns / memory |
|------|-------|---------------|-------------------------|
| Externals | Public sync allowlist + denylist | `sync-cli-dashboard.mjs` + `verify-cli-dashboard-pack.mjs` allowlisted; denylist does not scrub required Path C assets | `errors/2026-07-25_public-sync-dashboard-allowlist-gap.md`, `errors/2026-07-25_public-sync-denylist-false-positive.md` |
| DevSecOps | Secrets / private paths out of tarball | Dry-run / pack list has no `.env`, credentials, `.cursor/memory`, private `config.json` | this checklist, `docs/repository-boundaries.md` |
| Cyber | Mission Control bind | Default `/dashboard` loopback; LAN broadcast requires token; no silent non-loopback | ADR opt-in LAN broadcast; Path C bundled host still respects bind rules |
| DevOps | Tag CI publish path | `publish-npm` runs pack verify before publish; Biome/pnpm/setup-node/`typecheck` green on tag | `errors/2026-07-21_ci-biome-blocked-440-publish.md`, `errors/2026-07-23_biome-format-blocked-446-tag-ci.md`, `errors/2026-07-29_tag-ci-typecheck-blocked-481-publish.md` |
| Git | Promote immutability | Four manifests match SemVer; never force-move pushed `v*`; Step 12.5 requires **merged** sync PR | `decisions/2026-07-28_git-prod-version-manifest-parity.md`, `errors/2026-07-28_public-sync-pr-unmerged-skips-release.md` |
| Product | Consumer install honesty | Dual-audience README; Port A/B leave `hooks.json`; Path C dashboard without kit checkout after publish | `errors/2026-07-19_consumer-install-missing-hooks-json.md`, `errors/2026-07-20_consumer-install-footguns.md` |
| Hygiene | Monitor staging | Untracked `plan-monitor-*.md` staged add-by-name only; tree clean before `/git-prod` validation | ADR R14/R15 staging hygiene |

## Partial acceptance rows

When a checklist or monitor acceptance box is only partly true, do **not** mark `[x]` alone:

- Prefer splitting into separate rows (one Met, one Still open), or
- Use `[~]` / label the row **Partial** and keep the caveat in the same cell or an adjacent table.

Downstream scans should not treat Partial as Met.

## Related docs

- Boundaries and secrets table: [repository-boundaries.md](repository-boundaries.md)
- Public mirror launch (separate from npm): [public-launch.md](public-launch.md)
- CI workflow: `.github/workflows/ci.yml` (`publish-npm` job)
- `/git-prod` routine: `autogit/gitupdate.md` (Prompt: git prod, §2 pre-tag gate, §12.5)
