# Repository boundaries (local × Git × npm)

Agent Kit separates session state from product code. Session scratch stays off remotes; the public remote and the npm package only carry product code and documentation.

**Target topology (Fase 7):** see [topology-private-public.md](topology-private-public.md) - public becomes the **canonical registry**; private keeps CLI/core and promotes mature artifacts.

## Cheat sheet: three layers

Mental shorthand: **local = scratch · private = factory · public = storefront · sync = truck** (the truck never loads scratch).

| Layer | What lives here | Git? | Sync to public? |
|-------|-----------------|------|-----------------|
| **Local scratch** | `HANDOFF.md`, `.cursor/plans/**/*.plan.md`, active context packs, `.env`, `.cursor/mcp.json`, personal notes | gitignored / never tracked | **Never** (gitignore + CI guard + sync prohibit) |
| **Private repo** (`origin` → `agent-kit-dev`) | CLI, sync tooling, docs, Phase A `registry/**`, dogfood `.cursor/memory/` | staging → prod | Only **allowlist** paths in `scripts/public-sync.manifest` |
| **Public repo** (`public` / community → `agent-kit`) | Product surface: registry (SoT after Phase B), docs consumers need, L0 samples, LICENSE/README | PRs → `main` | N/A (destination) |

```text
Local scratch ──✗──► Private Git (factory) ──allowlist+guards──► Public (storefront)
```

**Quick checks on a maintainer clone**

1. Remotes: `origin` = `agent-kit-startup/agent-kit-dev`, optional `public` = `agent-kit-startup/agent-kit`.
2. `git check-ignore -v .cursor/HANDOFF.md` and a `.cursor/plans/*.plan.md` file both match `.gitignore`.
3. `.cursor/memory/**` may be tracked on **private** for kit dogfood; it must stay out of public sync (`!.cursor/memory/**` in the manifest + prohibit patterns in `sync-public.mjs`). Consumer projects keep memory local-only.

Do not `git add -f` session paths. Contributions after Phase B: registry PRs go to **public**; CLI/sync changes stay on **private**. See [topology-private-public.md](topology-private-public.md).

## Repositories (canonical)

| Role | Repository | Git remote | Notes |
|------|------------|------------|-------|
| **Private** | [agent-kit-startup/agent-kit-dev](https://github.com/agent-kit-startup/agent-kit-dev) | `origin` | Core product SoT (CLI, feats, sync). Phase A also authors registry. |
| **Public** | [agent-kit-startup/agent-kit](https://github.com/agent-kit-startup/agent-kit) | sync / community PRs | Phase A: allowlist mirror. Phase B: **registry SoT** + contribution surface. |
| **npm** | `@agent-kit/cli` | Publish on `v*` tags when `NPM_TOKEN` is configured | Dist only |

## Flow: `git staging` → `git prod` → public

1. **`git staging`** - PR to `staging` on the **private** repo (`agent-kit-dev`). Everything committed goes to private.
2. **`git prod`** - `staging` → `main` on **private**; push `origin main`.
3. **Public mirror (integrated into `git prod`)** - With a `public` remote pointing at the public GitHub repo and `gh` authenticated, after pushing `main` run **`pnpm git:trigger-public-sync`** (or `bash scripts/trigger-public-sync-after-prod.sh`): triggers the **CI** workflow on **origin** with *Sync to public repo* → CI runs **build** and opens a sync PR on public (requires `PUBLIC_REPO_TOKEN` on private). See step 12 of "Prompt: git prod" in `autogit/gitupdate.md`.
4. **Alternatives** (release or fallback): SemVer `v*` tag on private; manual *workflow_dispatch* in Actions; `node scripts/sync-public.mjs` with URL/token in the environment.

Without `PUBLIC_REPO_TOKEN` configured on the **private** GitHub repo, the sync job pushes nothing; the rest of CI still runs normally.

### Public launch checklist

1. Ensure the public repository is empty (no initial README if you want history only from first sync).
2. Create a fine-grained token limited to the public repository, with `Contents: write`, `Pull requests: write` and `Workflows: write`; save as `PUBLIC_REPO_TOKEN`.
3. Optional: `git remote add public https://github.com/agent-kit-startup/agent-kit.git` in the clone for local tests.
4. Run sync: `v*` tag or *workflow_dispatch* per the workflow.
5. README, license, and PR policy on the **public** repository (external issues/PRs; sensitive patches only on private).

## Two remotes - private and public

**Phase A (legacy):** private authors product + registry; public is an allowlist mirror (append-only sync). ⚠️ **Being phased out**

**Phase B (manifest cutover landed):** public owns `registry/**`; private syncs CLI/docs/L0 samples only and **consumes** the public registry URL. Private `registry/` edits no longer sync to public.

```
Phase A: Local → agent-kit-dev → sync-public → agent-kit (incl. registry)
Phase B: Local → agent-kit-dev → sync-public → agent-kit (excl. registry)
         Fleet / private CLI ──install/add──► agent-kit registry (canonical)
         promote / contribute ──PR──► agent-kit
```

| Surface | What goes in | What stays out |
|---------|--------------|----------------|
| **Local working tree** | Cursor plans, `HANDOFF.md`, active context packs, secrets | Anything that must never leave the machine |
| **Private repo** | CLI, feats, sync scripts, dogfood memory; Phase A also registry | Session HANDOFF/plans (gitignored) |
| **Public repo** | Allowlist (`scripts/public-sync.manifest`); Phase B + community PRs on registry | Session state, credentials, private memory, private-only tooling |
| **npm (`@agent-kit/cli`)** | Only `packages/cli/dist` (`files` in `package.json`) | Monorepo templates and `.cursor/` are not in the tarball |

### Phase B cutover (ops) ✅ DONE

**Manifest exclude landed.** Private `registry/` no longer syncs; public is SoT for registry. Contribute surfaces point public-first. Leak audit + public-URL dogfood closed 2026-07-19.

**Completed:**
1. [x] Registry freeze messaging on private.
2. [x] Cutover docs for Phase B.
3. [x] Final sync ensuring public `registry/**` matches private (2026-07-19; private `main` `9f6c717`; CI run [29695424400](https://github.com/agent-kit-startup/agent-kit-dev/actions/runs/29695424400); public PR [#8](https://github.com/agent-kit-startup/agent-kit/pull/8) merged as `b28cf16`).
4. [x] Exclude `registry/**` from `scripts/public-sync.manifest` (`!registry/**`; include removed).
5. [x] Point `agent-kit contribute` / CONTRIBUTING at public PRs.
6. [x] Leak audit + private dogfood: `install`/`update`/`status` against public URL (`https://github.com/agent-kit-startup/agent-kit` `@ main`); contribute gate rejects `.cursor/HANDOFF.md`. Evidence: `node scripts/sync-public.mjs --dry-run` exit 0; Guard public tree pass; smoke install wrote 24 L0 files including `.cursor/hooks.json`.

### How sync works

1. **Manifest** - `scripts/public-sync.manifest` lists allowed globs (positive allowlist).
2. **Script** - `scripts/sync-public.mjs` reads the manifest, filters `git ls-files`, checks no forbidden path slipped through, and opens an append-only PR against public `main` (default). Head branch is semantic (`sync/vX.Y.Z-<shortsha>`); re-runs update the same head and close superseded `sync/*` PRs. `--direct` is migration-only; `--force-snapshot` rewrites public history. See [public-launch.md](public-launch.md).
3. **CI** - the `sync-public` job in `.github/workflows/ci.yml` runs the script on `v*` tags or via `workflow_dispatch` (no `run_id` branch names).

### Required CI secrets (on the private `agent-kit-dev` repository)

| Secret | Purpose |
|--------|---------|
| `PUBLIC_REPO_TOKEN` | Fine-grained token limited to the public repo, with `Contents: write`, `Pull requests: write`, and `Workflows: write` (required when the sync tree includes `.github/workflows/`) |
| `NPM_TOKEN` | Token to publish to the npm registry |

Optional repository variable `PUBLIC_REPO_URL` overrides the default public Git URL without embedding credentials.

### External contributions

- **Phase A (legacy):** external PRs on public; maintainers merge and, if needed, promote-back into private before the next sync overwrites registry paths. ⚠️ **Being phased out**
- **Phase B (complete):** registry PRs must target public; private registry sync no longer publishes; contribute surfaces are public-first.

## Why

- Plans and handoff are **session state** - they change per conversation and agent; versioning them on the public remote clutters history and can leak internal drafts.
- Memory (`.cursor/memory/`) holds decisions and fixes. On **this** private repo it is dogfood history (tracked, never synced). On consumer projects it stays local. It never belongs on the public mirror.
- CI fails if `.cursor/HANDOFF.md` or `.cursor/plans/**/*.plan.md` are tracked (guard in `.github/workflows/ci.yml`).
- Relying only on `.gitignore` + human review is fragile (`git add -f`, new paths, old history). The **positive allowlist** is the main defense.

## Contributing

Respect `.gitignore` and do not use `git add -f` to bypass these paths. See also [CONTRIBUTING.md](CONTRIBUTING.md).
