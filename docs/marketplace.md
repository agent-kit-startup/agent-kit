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
| `commands` | `.cursor/commands` | 31 consumer/L0 slash commands (factory tree has 35 files; `/public-issue-triage`, `/public-inbound-radar`, `/kit-staging`, and `/kit-prod` are not consumer L0) |
| `hooks` | `.cursor/hooks.json` | Thin adapters; every one is fail-open, and `sessionStart` surfaces the degraded-mode diagnostic (see "Hook resolution boundary" below) |
| `logo` | `dashboard/logo-marketplace.svg` | 512×512 SVG (1:1), transparent canvas, rounded plate `#0b0e14`, Bare Metal skin stroke mark from `logo-bare-metal.svg` centered (~10% padding). Chrome keeps unplated `logo.svg` (Legacy helmet) and `logo-bare-metal.svg` (Bare Metal, 16px header). Must sit on a path inside `scripts/public-sync.manifest`. `assets/**` is **not** synced in general (only `assets/production/*.png` is, for the README screenshots — see readme-public-hero-badges Phase 2); a link/image into any other `assets/` path now fails `check:public-deny-links` instead of silently dropping. Production copies of the three marks live under `assets/production/` (private SVGs; not public-synced, `logo-marketplace.svg` above is generated from the same art at the `dashboard/` path instead) |

#### Hook resolution boundary

All five hook adapters (`sessionStart`, `preCompact`, `beforeShellExecution`, `afterFileEdit`, `beforeSubmitPrompt`) resolve the CLI via `.cursor/hooks/agent/resolve-agent-kit.sh` (order: `AGENT_KIT_HOOK_BIN` → `<root>/node_modules/.bin/agent-kit` → `node <root>/packages/cli/dist/index.js` → `PATH`, so the project's pinned CLI wins over a global one) and are **fail-open by design**: they must never block shell, edit, prompt, or compact flows, so an unresolved CLI makes them exit 0 with no effect. That degradation is the **accepted boundary** for the four non-sessionStart hooks: `after-edit-schema`, `secrets-prompt`, and `pre-compact` emit a no-op payload, and `guard-shell` returns `permission: allow` with `agent_message: "agent-kit guard inactive: CLI unresolved"` so the agent sees the guard is not running.

The same fail-open applies when the CLI resolves but needs a missing `node` (a `packages/cli/dist` script or a `#!/usr/bin/env node` shim, common when the IDE starts without the shell's nvm PATH): `run_agent_kit` returns 1 instead of exec, `guard-shell` answers `agent_message: "agent-kit guard inactive: node not found for the resolved CLI"`, and `session-start` says node is not on PATH. The Claude Code SessionStart command prints its own degraded text in both cases.

`sessionStart` is the one hook that can surface text into the session, so it carries the diagnostic for all five: when resolution fails, `.cursor/hooks/agent/session-start.sh` emits (exit 0) an `additional_context` JSON payload stating that hooks are in degraded fail-open mode, which surfaces are inactive (hook-provided context, shell guard, schema check, secrets scan), and the fix (`npm i -D @dadado/agent-kit-cli` or set `AGENT_KIT_HOOK_BIN`). Emission is stateless per session — no marker files.

**Verify:** `node --test scripts/hook-session-start-diagnostic.test.mjs` exercises both branches (resolvable → valid JSON from the real CLI; unresolvable → exit 0 + degraded-mode diagnostic). Manually: run `sh .cursor/hooks/agent/session-start.sh </dev/null` from the repo root (resolvable here via `packages/cli/dist`); smoke procedure in [plugin-smoke-checklist.md](plugin-smoke-checklist.md) section 4.

`author` is an **object** (`{ "name": … }`), not a string. Rules, agents, skills, and commands all need YAML frontmatter; command frontmatter carries `name` (kebab-case, matching the filename slug) plus `description`.

`displayName` (currently `"Mission Kit"`) is **not** in Cursor's documented plugin manifest schema. Kept deliberately as a listing-friendly name distinct from the package-style `name`; unknown keys have not been observed to fail manifest validation. Drop it only if a future submission attempt reports it as rejected by validation.

Editing any file under `.cursor/{agents,skills,commands}/` (or a registry skill's `SKILL.md`) changes its consumer-overlay hash: run `pnpm overlay:hashes` (root; or `npm run overlay:hashes` from `packages/cli`) in the same commit to append the new hashes to `KNOWN_SHIPPED_OVERLAY_HASHES` (`packages/cli/src/lifecycle/overlay-known-hashes.ts`). The helper is append-only — prior entries are never removed or reordered — and `pnpm overlay:hashes:check` lists missing hashes (exit 1) without writing. Without the append, an unedited consumer copy is misread as customized and never refreshed. The "KNOWN_SHIPPED_OVERLAY_HASHES coverage" tests in `packages/cli/src/lifecycle/overlay.test.ts` enforce this for every L0 overlay artifact and every registry skill `SKILL.md` (core + community).

### Submission checklist (publisher HITL)

Cursor reviews the **public** repo, so the manifest must have reached public `main` first: `/git-prod` → annotated `vX.Y.Z` tag → `sync-public` PR. Submit `https://github.com/agent-kit-startup/agent-kit` at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). No agent performs this step.

License: the kit is Apache-2.0 (`LICENSE`, `NOTICE`, `TRADEMARKS.md`). The earlier PolyForm Noncommercial blocker clears once the first Apache-2.0 release is on public `main`. Check `gh api repos/agent-kit-startup/agent-kit/contents/LICENSE` before submitting.

### Public promote sequence (operator, in order)

The promotion path is ready only when the evidence gate is green; each step below is operator-owned (HITL):

1. **Evidence gate green:** `npm run evidence:knowledge-classification:check` passes on the staging tip being promoted. The ledger (`docs/evidence/knowledge-classification.json`) is gitignored since 2026-10-19: the check validates a fresh census, so there is nothing to regenerate or commit. Note: the check recomputes from the working tree, so uncommitted `_index.md` rows pointing at untracked `plan-monitor-*.md` files fail it locally; verify at committed HEAD content (e.g. a clean worktree) when audit WIP is present.
2. **Merge pending staging PRs** in stack order (operator merge gate).
3. **`/git-prod`** (never agent-initiated) → annotated `vX.Y.Z` tag → `sync-public` PR, per the submission checklist above.
4. **Public mirror recheck:** verify the public repo exposes `.cursor-plugin/plugin.json` at the released version with explicit component paths. Rechecked live 2026-08-24 (`gh api repos/agent-kit-startup/agent-kit/contents/.cursor-plugin/plugin.json`): public manifest is **5.6.0**, matches the private manifest field-for-field — object `author`, explicit `rules` / `skills` / `agents` / `commands` / `hooks` / `logo` / `homepage`. The `/git-prod` → tag → `sync-public` chain has run multiple times since the 2026-08-14 recheck (5.2.0 → 5.6.0); no schema or path gap remains on the mirror side. Re-verify at the version about to be submitted before the actual publisher HITL step.
5. **Post-promote plugin smoke:** rerun the local-plugin smoke checklist ([plugin-smoke-checklist.md](plugin-smoke-checklist.md)) against the public ref before submitting.

## Vendor listings

Where Mission Kit is listed, and the IDs to quote when a listing needs follow-up. Every submission is made by the operator with the publisher account (no agent submits). Plan `distribution-zero-mkt-2026-10-22`, to-do d2.

| Channel | Install line / URL | State (2026-10-24) |
|---------|--------------------|--------------------|
| Claude Code marketplace (this repo) | `/plugin install agent-kit --marketplace agent-kit-startup/agent-kit` (Claude Code 2.1.275+); older: `/plugin marketplace add agent-kit-startup/agent-kit` + `/plugin install agent-kit@agent-kit` | Live from the public repo. `claude plugin validate --strict` passes on the public tree. |
| Anthropic plugin directory | submit at [claude.ai/directory/manage](https://claude.ai/directory/manage), source: the public repo's generated `claude-directory/` subfolder ("Plugin in a subfolder or on another branch?" in step 1) | Not submitted. Operator. The directory takes scripts, package-manager files, unknown config fields and non-standard frontmatter keys only from Verified organizations, so the repository root is refused (2 blocking issues on public `main` b56a3bc, 2026-11-17) and the v6.19.0 package was refused for the kit's own frontmatter keys (`audience` first; validation of public `main` a0e3e3d, 2026-11-18). From 6.19.1 `claude-directory/` is a store package (see [Store packages](#store-packages)): the items of `scripts/lib/claude-directory-profile.json` only, with the profile's descriptions and standard Claude Code frontmatter, `.claude-plugin/plugin.json` (release version, profile description, `skills: ./skills`), `README.md` by stage; no hooks, no scripts. `scripts/lib/claude-directory-package.mjs` fails the sync on any other file kind or on a profile item without a source. Check a tag with `claude plugin validate --strict --profile directory claude-directory` on a clone; the portal also checks frontmatter keys, which that command does not. Still held for manual review on 6.19.0: a credential-store command read across the plugin's surfaces and the name `agent-kit` close to an existing listing. The directory takes the listing icon from the manifest only on the first save or submission (`.claude-plugin/icon.png`; regenerate with `rsvg-convert -w 1024 -h 1024 dashboard/logo-marketplace.svg -o .claude-plugin/icon.png`). |
| Cursor Marketplace (curated) | [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) | Submitted 2026-08-14 (see Acceptance below), no listing URL or submission ID recorded: resubmit, record the ID here. Operator. |
| cursor.directory | [cursor.directory](https://cursor.directory) | Not submitted. Submit the same day as the Cursor resubmission. Operator. |
| HOL Registry | [hol.org/registry/plugins/agent-kit-startup/agent-kit](https://hol.org/registry/plugins/agent-kit-startup%2Fagent-kit) | Live. |

Cursor publisher terms require a plugin to be free, with no direct or indirect charge. Checked 2026-10-24: `.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `.codex-plugin/plugin.json` carry no price, upsell or Colony mention; the plugin is Apache-2.0. Keep paid offers (seats, cloud, paid MCP) out of plugin copy.

## Store packages

A store or directory that needs another shape gets its own generated package, built from the kit at public sync and documented here. The kit's own commands, agents and skills do not change to fit one store: no single package tries to satisfy every store.

| Store | Package | Profile | What differs from the full kit |
|-------|---------|---------|--------------------------------|
| Anthropic plugin directory | `claude-directory/` (public repo) | `scripts/lib/claude-directory-profile.json` | Curated items by stage (plan, build, review, ship, keep), store descriptions, standard frontmatter only, no hooks or scripts |
| Agent Plugins 1.0 (awesome-copilot) | `skills/` (public repo root) | none (all core skills) | See [Agent Plugins 1.0 package](#agent-plugins-10-package) |

A store profile lists each item by kind and name with its stage and a description that says, in user terms, what the item does and when to use it. Internal, meta, deprecated, Cursor-only and third-party integration items stay out of store packages; they remain in the full kit. Changing what a store shows is an edit of its profile, reviewed like any other change.

## Agent Plugins 1.0 package

The public repository is also an [Agent Plugins 1.0](https://agent-plugins.org/specification) package, so one tree serves GitHub Copilot (VS Code, Copilot CLI, the Copilot app and the awesome-copilot marketplace), Codex portable discovery and Antigravity. Anthropic is not in the spec: `.claude-plugin/` stays separate, as do `.cursor-plugin/` and `.codex-plugin/`.

| Path (public tree) | Source |
|--------------------|--------|
| `plugin.json` | tracked at the repo root: `$schema` `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, `name` `agent-kit` (same name as the Claude plugin). The tracked file has no `version`, so it is not a seventh manifest to bump; `scripts/sync-public.mjs` writes `version` (the `packages/cli/package.json` version) into the public copy, because the awesome-copilot intake requires it. |
| `skills/<name>/` | **generated by `scripts/sync-public.mjs`** from `.cursor/skills/core/<name>/`; never tracked in the private tree (sync refuses a tracked `skills/` file). Relative Markdown links in the copies are rewritten: a link to a file in the same skill folder stays relative, any other link becomes a `https://github.com/agent-kit-startup/agent-kit/blob/main/...` URL (a skill may reference by path only files inside its own folder). |
| `mcp.json` | none yet (no kit MCP server) |

Only core skills whose `SKILL.md` frontmatter `name` equals the directory name and is a valid Agent Skills name, and whose frontmatter a strict YAML loader accepts (an unquoted value with `: ` or ` #` in it is rejected), are copied; clients skip the others anyway. Every core skill qualifies today, a test fails when one stops qualifying, and the sync log lists any skipped one. Rules: `scripts/lib/agent-plugin-layout.mjs`, tests in `scripts/lib/agent-plugin-layout.test.mjs` (including every link of the real copies). Preview: `node scripts/sync-public.mjs --dry-run` lists the files, `node scripts/sync-public.mjs --out <new folder>` writes the tree without pushing.

### awesome-copilot intake gates

The awesome-copilot intake is an issue (form [External plugin submission](https://github.com/github/awesome-copilot/issues/new?template=external-plugin.yml)), not a PR. Its workflow runs five gates on the submitted ref (`.github/scripts/external-plugins/external-plugin-quality-gates.mjs` in `github/awesome-copilot`): manifest spec compliance (`version` and `description` are required there), version match (form version == `plugin.json` version at the ref and at the SHA), ref and SHA name the same commit, `@microsoft/vally` lint of `skills/` (strict YAML frontmatter; file references only inside the skill folder) and an install smoke with the Copilot CLI.

Checked 2026-11-11 with those gate functions and `@microsoft/vally` 0.20.0, run locally:

| Tree | Spec compliance | Version match | Ref / SHA | vally lint | Install smoke |
|------|-----------------|---------------|-----------|------------|---------------|
| public `v6.16.1` (`39bbde4f`) | fail (no `version`) | fail (no `version`) | pass | fail, 7 of 10 skills (6 with links outside the skill folder, `clean-code` frontmatter) | pass (Copilot CLI 1.0.109, 10 skills) |
| `sync-public --out` tree with the three rules above | pass | pass | pass | pass, 10 of 10 | not rerun (install path unchanged) |

So the intake issue must pin the first public tag that carries these rules; an issue pinned to `v6.16.1` or earlier fails three gates. Before opening it, repeat the check on that tag: clone `github/awesome-copilot`, `npm ci --ignore-scripts`, and call `inspectAgentPluginSpecCompliance`, `runVersionMatchGate`, `runRefShaConsistencyGate` and `runVallyLintGate` on a clone of the public tag.

Form values: plugin name `agent-kit`, repository `agent-kit-startup/agent-kit`, plugin path empty (the plugin is the repository root; a `/` path fails the install), ref `v<version>`, SHA the full 40-character commit of that public tag (`gh api repos/agent-kit-startup/agent-kit/git/ref/tags/v<version> --jq .object.sha`), version `<version>`, license `Apache-2.0`, author `agent-kit-startup`, homepage `https://missionkit.io/`, keywords from `plugin.json`.

Hooks are not part of the format, so this package carries no HITL guard hooks (the Cursor and Claude plugins and `agent-kit install` still do). Say so in any listing made from it (the OpenAI directory rejects plugins with hooks; upload the skills-only package).

Operator steps, after a release has synced this layout to public `main`: open the awesome-copilot intake issue with a pinned tag (see the gates above); upload the skills-only package to the OpenAI directory. Public PR #95 was closed as superseded on 2026-11-07.

Gemini CLI gallery: the `gemini-cli-extension` topic alone lists nothing. The gallery crawls tagged public repositories that carry the topic and a `gemini-extension.json` at the repository root (Gemini CLI `docs/extensions/releasing.md`, read 2026-11-11), and the public tree has no such file. Adding that manifest is an open decision, not a submission step.

## Listing UX (CLI)

```bash
# Install by id from remote registry
npx @dadado/agent-kit-cli add n8n-workflows --url https://github.com/agent-kit-startup/agent-kit --ref main

# Inspect catalog locally
node -e "console.log(JSON.stringify(require('./registry/registry.json').skills,null,2))"
```

Future nicety (not required for this to-do): `agent-kit search <query>` over `registry.json`.

## Community incentive extension (paper)

Featured listing, Verified Author badge, and a pre-committed 85/15 paid-listing term (0% under a lifetime threshold) live in factory product-context paper. That paper does not mark the marketplace gate green.

## Acceptance (`f7-marketplace`)

- [x] Skill frontmatter `version` + `category` in registry SoT
- [x] Builder emits version/category into `registry.json`
- [x] CONTRIBUTING quality gate documented
- [x] This marketplace doc + plugin.json thesis/version note
- [x] Live Cursor Marketplace submission (publisher ops / HITL) - operator submitted 2026-08-14. Packaging ready at **5.2.0** on the public mirror (explicit component paths). Listing may still be pending Cursor review; no listing URL or submission id recorded yet.
- [x] Phase B cutover so public catalog is not overwritten by private sync
