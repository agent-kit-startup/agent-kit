# npm publish checklist (`@dadado/agent-kit-cli`)

Human-in-the-loop gate before the first npm publish or any publish that changes the live registry version. CI can publish automatically when a `v*` tag is pushed; treat tag creation and secret configuration as production actions.

## Preconditions

- [ ] Release content is on `origin/main` (promote via `git prod` from `origin/staging` when the release is not already on `main`).
- [ ] Root `package.json` `version`, `packages/cli/package.json` `version`, and the dated section in `CHANGELOG.md` match the intended release (currently aligned at **4.2.1**).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` succeed on the commit you intend to tag.
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
| Repository root | `package.json` → `version` | Target release (e.g. `4.2.1`) |
| CLI package | `packages/cli/package.json` → `version` | Same as root |
| Changelog | Latest dated `[x.y.z]` section | Same version and date |

Do not tag or publish if any of these diverge.

## CI secret (`NPM_TOKEN`)

- [ ] On the **private** GitHub repository (`agent-kit-dev`), configure Actions secret **`NPM_TOKEN`**: an npm automation or granular publish token with permission to publish `@dadado/agent-kit-cli` (public access).
- [ ] Token is stored only in GitHub Secrets, not in the repo, chat, or CI logs.

### Behavior when the token is missing

The `publish-npm` job in `.github/workflows/ci.yml` runs on **`v*` tags** only. If `NPM_TOKEN` is unset, the Publish step prints `NPM_TOKEN not configured — skipping npm publish.` and exits **0** (green job, no upload). Do not rely on a missing token as a safety gate: pushing a new `v*` tag still runs the job and will publish once the secret exists.

## Tag strategy and CI

- [ ] Tags use the form **`vMAJOR.MINOR.PATCH`** (e.g. `v4.2.1`).
- [ ] **Existing tags on `origin`:** `v4.0.0`, `v4.0.1`, `v4.1.0`, `v4.2.0`, `v4.2.1`. Pushing a **new** `v*` tag (or re-running CI for a tag) triggers `publish-npm` after `build` succeeds.
- [ ] Tag the commit on `main` that matches the release version; do not tag staging-only commits unless that is an explicit exception documented in the release notes.
- [ ] **Integrated with `/git-prod`**: Annotated tags are created automatically when absent during `/git-prod` workflow (step 9.5 in `autogit/gitupdate.md`). Manual tag creation via `git push origin vX.Y.Z` or GitHub Releases UI is fallback only.

## Local dry-run (no upload)

Run from the monorepo root after `pnpm build`:

```bash
pnpm --filter @dadado/agent-kit-cli publish --dry-run --access public
```

- [ ] Review the tarball file list (only `packages/cli/dist` and declared `files`; no `.cursor/`, secrets, or private memory).
- [ ] Confirm reported version matches `packages/cli/package.json`.

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

- [ ] `npm view @dadado/agent-kit-cli version` matches the release.
- [ ] Smoke install: `npx @dadado/agent-kit-cli@<version> --help` (or `pnpm dlx`).
- [ ] GitHub Actions `publish-npm` job for the tag shows publish success (not skip), when using CI.

## Related docs

- Boundaries and secrets table: [repository-boundaries.md](repository-boundaries.md)
- Public mirror launch (separate from npm): [public-launch.md](public-launch.md)
- CI workflow: `.github/workflows/ci.yml` (`publish-npm` job)
