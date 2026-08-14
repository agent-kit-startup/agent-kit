# Development (factory and maintainers)

This guide is for people working **on** Agent Kit (CLI, L0, sync, dogfood), not for end-user install into an application repo. Consumer install stays in the root [README](../README.md) and [getting-started.md](getting-started.md).

## Two repositories, one product

Name repos by URL and role. Do not write "this repo is `agent-kit-dev`" in allowlist-synced docs (the same markdown ships to both remotes).

| Repo | Role |
|------|------|
| [agent-kit-dev](https://github.com/agent-kit-startup/agent-kit-dev) (private) | Factory: CLI, sync tooling, dogfood. Daily flow: `git staging` → `git prod` → allowlist sync. |
| [agent-kit](https://github.com/agent-kit-startup/agent-kit) (public) | Storefront and **canonical registry** (`registry/**`). Consumers install from here; registry PRs land here. |

Projects that install Agent Kit receive only `.cursor/` + `autogit/` + the manifest, never the whole monorepo.

**Three layers:** local scratch (HANDOFF/plans, gitignored) · private Git (factory) · public (storefront + registry SoT). Cheat sheet: [repository-boundaries.md](repository-boundaries.md#cheat-sheet-three-layers). Topology phases: [topology-private-public.md](topology-private-public.md).

## Local monorepo setup

```bash
pnpm install
pnpm lint
pnpm test
```

Contributor PR checklist and registry paths: [CONTRIBUTING.md](CONTRIBUTING.md).

### Installing the local CLI into a test project

```bash
# install from local CLI with public registry
pnpm --filter @dadado/agent-kit-cli start -- install \
  --cwd /path/to/your-project \
  --url https://github.com/agent-kit-startup/agent-kit \
  --ref main

# or install from local CLI with local registry source
pnpm --filter @dadado/agent-kit-cli start -- install \
  --cwd /path/to/your-project \
  --registry /path/to/agent-kit
```

Other local CLI commands follow the same pattern:

```bash
pnpm --filter @dadado/agent-kit-cli start -- status --cwd /path/to/your-project
```

### Factory self-consumer (local apply loop)

A factory checkout can act as its own consumer to validate L0 changes before a public release. This is distinct from the public consumer update-check and from the public sync mirror.

1. **Build the CLI** from the current source:
   ```bash
   pnpm --filter @dadado/agent-kit-cli build
   ```
2. **First seed** (only when `.cursor/agent-kit.managed-hashes.json` is absent):
   ```bash
   pnpm --filter @dadado/agent-kit-cli start -- update --cwd . --seed-overlay
   ```
3. **Subsequent local refreshes**:
   ```bash
   pnpm --filter @dadado/agent-kit-cli start -- update --cwd .
   ```

Do not use this path in a public consumer project; consumers rely on the public release tag and `/update` HITL. Decision record: `decisions/2026-07-31_factory-pseudo-consumer-local-apply.md` (private memory).

### Mission Control from a kit tree

When the working tree includes `dashboard/`:

```bash
npm run dashboard
# or: node dashboard/start.mjs
# Explicit consumer snapshot while serving from the kit tree:
# MISSION_CONTROL_REPO_ROOT=/path/to/consumer npm run dashboard

npm run dashboard:broadcast
npm run start:dashboard   # foreground serve only
```

Published CLI packs `dashboard/**` from 4.8.2 onward; consumers normally run `agent-kit dashboard` without a kit checkout.

## Public sync awareness

- Allowlist: `scripts/public-sync.manifest` (positive globs + exclusions).
- Root `README.md` is the **consumer storefront** (synced). Maintainer depth belongs here and in [CONTRIBUTING.md](CONTRIBUTING.md), not in the root README body.
- `docs/**` syncs except private exclusions (evidence ledgers, paid MCP documentation, and others listed with `!` in the manifest).
- `.cursor/memory/**` stays private (`!.cursor/memory/**`).
- Registry SoT is public after Phase B; do not re-add `registry/**` to the private→public allowlist. See [topology-private-public.md](topology-private-public.md).

Release and sync ops: [public-launch.md](public-launch.md), [npm-publish-checklist.md](npm-publish-checklist.md).

## Mission Kit / Agent Kit / Mission Control naming

Public marketing uses **Mission Kit** / **MissionKit** (missionkit.io hero, README first screen, consumer product-family prose). Install and runtime identifiers stay **Agent Kit** / `agent-kit`. **Mission Control** is the dashboard shell and tabs only. Blind find-replace either way breaks install truth, storefront positioning, or dashboard voice.

| Surface | Prefer | Notes |
|---------|--------|-------|
| missionkit.io hero / SEO | Mission Kit | External design SoT; do not hand-edit `landing-missionkit/remote/` |
| Root README storefront | Mission Kit framing | Keep install/CLI names as Agent Kit / `agent-kit` |
| Consumer docs | Mission Kit for the product family; Agent Kit when naming the CLI or pack | One sentence can introduce both |
| npm / CLI / npx | `@dadado/agent-kit-cli`, `agent-kit` | Never rename in docs alone |
| Slash commands, `.cursor/agent-kit.json`, agent pack | Agent Kit identifiers | Literal command, file, and pack names |
| Dashboard shell and tabs | Mission Control | Never use Mission Control as the product or CLI name |
| Commercial contact | `sales@missionkit.io` | PolyForm Noncommercial path |
| Legacy `agent.startupkit.com.br`, `landing-agentkit/` | Historical / rollback-only | Qualify when linked |

Storefront README must not link private memory ADRs or dump dual-name legal essays. Private decision record (factory only): `2026-08-06_mission-kit-vs-agent-kit-naming.md` under `.cursor/memory/decisions/`. Public vs maintainer README split: `2026-08-02_public-vs-dev-readme-separation.md` in the same folder.

## Related docs

- [CONTRIBUTING.md](CONTRIBUTING.md) - setup, standards, registry contributions
- [repository-boundaries.md](repository-boundaries.md) - local / private / public / npm
- [topology-private-public.md](topology-private-public.md) - Phase A/B/C
- [contribute-upstream.md](contribute-upstream.md) - `agent-kit contribute` from a consumer
