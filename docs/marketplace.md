# Marketplace catalog - registry as a living catalog

How Agent Kit skills and packs are discovered, versioned, and listed for `agent-kit add` and (optionally) the Cursor Marketplace. Depends on [topology-private-public.md](topology-private-public.md) Phase B for a stable public SoT.

## Surfaces

| Surface | Role |
|---------|------|
| `registry/registry.json` | Machine catalog (schemaVersion 2) - skills + packs + artifacts |
| `agent-kit add` / `install` | Install from local checkout or remote git URL/ref |
| `.cursor-plugin/plugin.json` | Cursor plugin manifest for Marketplace listing of the Core Pack shell |
| GitHub public repo | Human browsing + PRs (gate in CONTRIBUTING) |

The **CLI catalog** is the registry index. The **Cursor Marketplace** is a distribution channel for the plugin wrapper - it does not replace `agent-kit add` for stack skills.

## Versioning per artifact

### Skills

Frontmatter on `registry/skills/{core|community}/<id>/SKILL.md`:

```yaml
---
name: clean-code
description: …
version: 0.1.0
category: quality
---
```

`node scripts/build-registry.mjs` copies `version` and `category` into `registry.json`. Bump **semver** when behavior changes; patch for docs-only.

### Packs

`registry/packs/<id>/pack.json` already has `version`. Bump when membership or member contracts change.

### Pinning (fleet)

Consumers pin via manifest `registry.ref` (tag or branch):

```json
"registry": { "url": "https://github.com/agent-kit-startup/agent-kit", "ref": "v3.1.0" }
```

## Quality gate (PR entry)

Same rules as `agent-kit contribute` (see [contribute-upstream.md](contribute-upstream.md) and CONTRIBUTING):

1. No session/L3 paths (HANDOFF, plans, memory, context).
2. No secrets / private keys / PATs.
3. No agent metalinguage or chat-transient wording.
4. Skill has frontmatter: `name`, `description`, `version`, `category`.
5. `node scripts/build-registry.mjs` run; `registry.json` committed if changed.
6. Stack skills stay under `community/`; structural under `core/` only with maintainer review.

## Cursor Marketplace

1. Keep `.cursor-plugin/plugin.json` version aligned with product releases.
2. Plugin ships the **structural** experience (rules/commands samples); stack skills remain `agent-kit add`.
3. Submission / listing follows Cursor’s publisher flow for the public repo - do not document third-party gateways.
4. After Phase B cutover, Marketplace updates track **public** tags, not private history.

### Packaging contract

The plugin root is the **parent of `.cursor-plugin/`** - the repo root. Cursor's default component discovery reads `rules/`, `skills/`, `agents/`, `commands/`, `hooks/hooks.json` at that root. Agent Kit keeps every component under `.cursor/`, so the manifest **must** declare each path explicitly. A metadata-only manifest validates but ships an empty plugin.

| Manifest key | Value | Why |
|--------------|-------|-----|
| `rules` | `.cursor/rules` | 25 `.mdc`; 10 `alwaysApply: true` structural, the rest glob-gated per stack |
| `skills` | `.cursor/skills/core` | **Core only.** Discovery matches direct children holding a `SKILL.md`, so `.cursor/skills` (whose children are `core/` and `community/`) would find nothing. Pointing at `core/` also encodes the thesis: stack skills stay on `agent-kit add` |
| `agents` | `.cursor/agents` | 14 subagent definitions |
| `commands` | `.cursor/commands` | 27 slash commands |
| `hooks` | `.cursor/hooks.json` | Thin adapters; every one is fail-open, and `sessionStart` surfaces the degraded-mode diagnostic (see "Hook resolution boundary" below) |
| `logo` | `dashboard/logo-marketplace.svg` | 512×512 SVG (1:1), transparent canvas, rounded plate `#0b0e14`, Cursor-skin stroke mark from `logo-cursor.svg` centered (~10% padding). Chrome keeps unplated `logo.svg` (legacy helmet) and `logo-cursor.svg` (16px header). Must sit on a path inside `scripts/public-sync.manifest`. `assets/**` is **not** synced and would be dropped from the public mirror without failing anything. Production copies of the three marks live under `assets/production/` (private; not public-synced) |

#### Hook resolution boundary

All five hook adapters (`sessionStart`, `preCompact`, `beforeShellExecution`, `afterFileEdit`, `beforeSubmitPrompt`) resolve the CLI via `.cursor/hooks/agent/resolve-agent-kit.sh` (order: `AGENT_KIT_HOOK_BIN` → `PATH` → `<root>/node_modules/.bin/agent-kit` → `node <root>/packages/cli/dist/index.js`) and are **fail-open by design**: they must never block shell, edit, prompt, or compact flows, so an unresolved CLI makes them exit 0 with no effect. That silent degradation is the **accepted boundary** for the four non-sessionStart hooks — `guard-shell`, `after-edit-schema`, `secrets-prompt`, and `pre-compact` emit nothing when resolution fails.

`sessionStart` is the one hook that can surface text into the session, so it carries the diagnostic for all five: when resolution fails, `.cursor/hooks/agent/session-start.sh` emits (exit 0) an `additional_context` JSON payload stating that hooks are in degraded fail-open mode, which surfaces are inactive (hook-provided context, shell guard, schema check, secrets scan), and the fix (`npm i -D @dadado/agent-kit-cli` or set `AGENT_KIT_HOOK_BIN`). Emission is stateless per session — no marker files.

**Verify:** `node --test scripts/hook-session-start-diagnostic.test.mjs` exercises both branches (resolvable → valid JSON from the real CLI; unresolvable → exit 0 + degraded-mode diagnostic). Manually: run `sh .cursor/hooks/agent/session-start.sh </dev/null` from the repo root (resolvable here via `packages/cli/dist`); smoke procedure in [plugin-smoke-checklist.md](plugin-smoke-checklist.md) section 4.

`author` is an **object** (`{ "name": … }`), not a string. Rules, agents, skills, and commands all need YAML frontmatter; command frontmatter carries `name` (kebab-case, matching the filename slug) plus `description`.

Editing any file under `.cursor/{agents,skills,commands}/` (or a registry skill's `SKILL.md`) changes its consumer-overlay hash: run `pnpm overlay:hashes` (root; or `npm run overlay:hashes` from `packages/cli`) in the same commit to append the new hashes to `KNOWN_SHIPPED_OVERLAY_HASHES` (`packages/cli/src/lifecycle/overlay-known-hashes.ts`). The helper is append-only — prior entries are never removed or reordered — and `pnpm overlay:hashes:check` lists missing hashes (exit 1) without writing. Without the append, an unedited consumer copy is misread as customized and never refreshed. The "KNOWN_SHIPPED_OVERLAY_HASHES coverage" tests in `packages/cli/src/lifecycle/overlay.test.ts` enforce this for every L0 overlay artifact and every registry skill `SKILL.md` (core + community).

### Submission checklist (publisher HITL)

Cursor reviews the **public** repo, so the manifest must have reached public `main` first: `/git-prod` → annotated `vX.Y.Z` tag → `sync-public` PR. Submit `https://github.com/agent-kit-startup/agent-kit` at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). No agent performs this step.

### Public promote sequence (operator, in order)

The promotion path is ready only when the evidence gate is green; each step below is operator-owned (HITL):

1. **Evidence gate green:** `npm run evidence:knowledge-classification:check` passes on the staging tip being promoted. The shared ledger (`docs/evidence/knowledge-classification.json`) has **one regeneration owner** — the ship-5.0 evidence closeout (clean-tree regen guard + regen shipped in the PR #719–#725 stack). Marketplace-side plans record the dependency and never regenerate the ledger themselves. Note: the check recomputes from the working tree, so uncommitted `_index.md` rows pointing at untracked `plan-monitor-*.md` files fail it locally; verify at committed HEAD content (e.g. a clean worktree) when audit WIP is present.
2. **Merge pending staging PRs** in stack order (operator merge gate).
3. **`/git-prod`** (never agent-initiated) → annotated `vX.Y.Z` tag → `sync-public` PR, per the submission checklist above.
4. **Public mirror recheck:** verify the public repo exposes `.cursor-plugin/plugin.json` at the released version with explicit component paths. Owned by `submit-cursor-marketplace.plan.md` (`recheck-public-mirror`), alongside the publisher HITL submission gate. Rechecked 2026-08-14: public manifest is **5.2.0** with explicit `rules` / `skills` / `agents` / `commands` / `hooks`.
5. **Post-promote plugin smoke:** rerun the local-plugin smoke checklist ([plugin-smoke-checklist.md](plugin-smoke-checklist.md)) against the public ref before submitting.

## Listing UX (CLI)

```bash
# Install by id from remote registry
npx @dadado/agent-kit-cli add n8n-workflows --url https://github.com/agent-kit-startup/agent-kit --ref main

# Inspect catalog locally
node -e "console.log(JSON.stringify(require('./registry/registry.json').skills,null,2))"
```

Future nicety (not required for this to-do): `agent-kit search <query>` over `registry.json`.

## Acceptance (`f7-marketplace`)

- [x] Skill frontmatter `version` + `category` in registry SoT
- [x] Builder emits version/category into `registry.json`
- [x] CONTRIBUTING quality gate documented
- [x] This marketplace doc + plugin.json thesis/version note
- [ ] Live Cursor Marketplace submission (publisher ops / HITL) - packaging ready at **5.2.0** on the public mirror (explicit component paths). Submit remains operator HITL; this box stays unchecked until a real submission.
- [x] Phase B cutover so public catalog is not overwritten by private sync
