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

## Repository layout

Root artifacts that are not self-explanatory, and why they are at the root rather than tucked away:

| Path | What it is |
| --- | --- |
| `cursor-handoff` | POSIX shell CLI for the file-based context memory system (`new`, `update`, `status`, `handoff`, `archive`, `resume`, `list-projects`). Extensionless and at the root because consumers invoke it as `./cursor-handoff` and the public sync manifest ships it by that exact path. |
| `install.md`, `install-prompt.md` | The Port B install contract an agent fetches by raw URL, and the prompt that drives it. Path-stable by design: `README.md` and external instructions link them. |
| `add-skills.md`, `categories.md`, `registry-schema.md` | Registry authoring contracts referenced from `docs/creating-skills.md` and the registry itself. |
| `skills-registry.json` | Legacy flat skill index kept for compatibility; `registry/registry.json` is the generated source of truth (`pnpm registry:build`). |
| `HANDOFF.md.example` | Template a consumer copies to `.cursor/HANDOFF.md` (the real one is gitignored). |
| `autogit/` | The git staging / production routines the kit commands cite as source of truth. |
| `_legacy/` | Frozen v2 tree. Historical reference only - never edit, and do not treat its copies of the root files as current. |
| `dogfood/` | Field reports and the ingest ritual (factory intake), not product code. |

`.cursor/` is the kit itself (commands, rules, skills, agents, plans, memory); `packages/cli` is the
published CLI; `dashboard/` is the Mission Control runtime; `registry/` is the skill/pack catalog.

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

### Ubuntu 24.04 bare-metal install helper

`scripts/install-ubuntu24-bare-metal.sh` automates the consumer recipe in [install-ubuntu24-bare-metal.md](install-ubuntu24-bare-metal.md) for provisioning a fresh Ubuntu 24.04 box with no Node.js and no terminal attached. It lives in the factory checkout only: it is not in `scripts/public-sync.manifest` and not in the npm tarball, so consumers follow the manual recipe and maintainers run the helper on their own hosts.

```bash
scripts/install-ubuntu24-bare-metal.sh --version x.y.z --target-dir /srv/your-project
```

What it does, in order: installs Node via the NodeSource setup script unattended (`sudo` unless already root), `git init`s an empty target directory so the project-root guard never needs an interactive answer, then runs `npx --yes @dadado/agent-kit-cli@<version> install --yes` with `npm_config_cache` pointed at a kit-managed directory (`--cache-dir`, `AGENT_KIT_NPM_CACHE_DIR`, default `~/.cache/agent-kit/npm-cache`, never `~/.npm/_cacache`). `--version` is required and always pinned; the helper never resolves `@latest`. The NodeSource line is separate from the CLI floor: a box with any Node 20+ on `PATH` skips the bootstrap, a box without one gets `22.x` by default (`--node-major <N>` or `AGENT_KIT_NODE_BOOTSTRAP_MAJOR`, refused below 20). Other flags: `--skip-node-bootstrap` (fail instead of bootstrapping when no Node 20+ is on `PATH`), `--dry-run` (prints every action, makes no network call, no `git init`, no `npx`), `--help`.

Exit codes: `0` installed; `1` usage error or Node bootstrap failure; `2` the npm-cache `EPERM` ownership-drift signature; `3` the swallowed non-interactive prompt that would otherwise surface as a bare `255`. Codes `2` and `3` print the recovery steps and the Port B pointer; an unrecognized failure propagates the raw npx status. The two signatures are the ones recorded in the kit's error memory for the 2026-08-02 non-interactive install failure.

The helper is built for a non-TTY run (cloud-init, `bash -c` over SSH), where both npx and the CLI switch to non-interactive mode on their own because stdin is not a terminal. It still passes `--yes` to both (npx's before the package, the CLI's after `install`), so the same invocation behaves identically from an interactive SSH session: no "Ok to proceed?" from npx, no install wizard from the CLI.

Tests: `pnpm test:factory-root-node` (arg parsing, dry-run guard and bootstrap-line logic, failure classification through the `--classify-failure` hook and a fake `npx` on `PATH`; no live box required, private-origin CI only). Validated on a real Ubuntu 24.04 host on 2026-09-12: the helper's dry-run and real run both completed clean (exit 0), `status` confirmed the install afterward. One caveat: the target host already had Node >=20 present via nvm, so the run took the "already satisfies >=20, skipping bootstrap" branch — the NodeSource unattended-install branch itself is still unexercised end-to-end. Full record in the plan file's Phase 3 hardware-validation section. Open decision: whether to publish the helper through `scripts/public-sync.manifest` so consumers can fetch it from the mirror (then this path becomes a link and the consumer page can point at it).

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

### Where Mission Control's tests live

`dashboard/**` has no test runner of its own: the suites for those modules are
`packages/cli/src/dashboard/*.test.ts`, importing the `.mjs` files directly so there is one
implementation under test rather than a copy. `dashboard/README.md` documents the layout.

## Public sync awareness

- Allowlist: `scripts/public-sync.manifest` (positive globs + exclusions).
- Root `README.md` is the **consumer storefront** (synced). Maintainer depth belongs here and in [CONTRIBUTING.md](CONTRIBUTING.md), not in the root README body.
- `docs/**` syncs except private exclusions (evidence ledgers, paid MCP documentation, and others listed with `!` in the manifest).
- `.cursor/memory/**` stays private (`!.cursor/memory/**`).
- Registry SoT is public after Phase B; do not re-add `registry/**` to the private→public allowlist. See [topology-private-public.md](topology-private-public.md).

### Public changelog

The private factory `CHANGELOG.md` may keep a full developer log. Public-sync copies a stripped excerpt: public GitHub `CHANGELOG.md`, GitHub Release notes, and the landing product-notes field must stay consumer and contributor product voice. Never publish CI/CD internals, landing staging/promote plumbing, Hostinger/deploy details, internal ADR chatter, or dogfood-only kit mechanics.

Fence factory-only bullets on their own lines:

```markdown
<!-- changelog-private -->
- Hostinger staging hop / landing:promote internals
<!-- /changelog-private -->
```

A `### Internal` heading is stripped until the next `##` / `###`. Preview:

```bash
node scripts/public-changelog.mjs                  # full public markdown
node scripts/public-changelog.mjs --version 5.6.0  # GitHub Release body (no ## [x.y.z] header)
node scripts/public-changelog.mjs --version 5.6.0 --blurb
# short publicNotesBlurb for:
#   pnpm landing:update-release -- --version 5.6.0 --notes "<blurb>"
# or --notes-file ./public-release-notes.txt
# Never pass CHANGELOG.md as --notes-file.
```

`--json` emits `{ version, date, notes, publicNotesBlurb }`. `notes` is the Keep-a-Changelog section body (GitHub Release). `publicNotesBlurb` is the landing stamp field (heading-free, under 1000 characters).

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

## Evidence artifacts

`docs/evidence/**` is private (excluded from the public sync manifest) and holds generated ledgers
plus hand-authored audit records. Which artifact is machine-reproducible, and which one CI actually
enforces, is not uniform: the matrix lives in `docs/evidence/README.md`. Two rules worth knowing
before you touch them:

- `evidence:file-ledger:check` is a **local replay** tool, not a CI gate - the census includes the
  working tree, stashes and ignored-operational files, so it only reproduces on the machine that
  generated it.
- `evidence:knowledge-classification` refuses a dirty tree, so a `.cursor/**` change ships as two
  commits: the change, then the regenerated artifact.

## Related docs

- [CONTRIBUTING.md](CONTRIBUTING.md) - setup, standards, registry contributions
- [repository-boundaries.md](repository-boundaries.md) - local / private / public / npm
- [topology-private-public.md](topology-private-public.md) - Phase A/B/C
- [contribute-upstream.md](contribute-upstream.md) - `agent-kit contribute` from a consumer
- [install-ubuntu24-bare-metal.md](install-ubuntu24-bare-metal.md) - consumer recipe the factory-only bare-metal helper automates
