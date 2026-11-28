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

The same fail-open applies when the CLI resolves but needs a missing `node` (a `packages/cli/dist` script or a `#!/usr/bin/env node` shim, common when the IDE starts without the shell's nvm PATH): `run_agent_kit` returns 1 without running it, `guard-shell` answers `agent_message: "agent-kit guard inactive: node not found for the resolved CLI"`, and `session-start` says node is not on PATH.

**Resolved but broken.** A CLI can resolve and still not run. A mise shim on the IDE's PATH (`~/.local/share/mise/shims/agent-kit`) exits 1 with only `mise ERROR agent-kit is not provided by the active node@…` on stderr when the Node version active for the workspace has no agent-kit installed. `run_agent_kit` therefore runs the CLI instead of exec'ing it and captures stdout. When the CLI answers (exit 0, or any stdout), it prints that stdout byte for byte and exits with the CLI's status, as the exec did. When it exits non-zero with nothing on stdout, `run_agent_kit` returns 1 and each adapter prints its fail-open answer: `session-start` says the resolved CLI (named by path) exited with that status and how to fix it (install the CLI for the active Node, then `mise reshim` under mise, add it to the project, or set `AGENT_KIT_HOOK_BIN`); `guard-shell` answers `permission: allow` with `agent_message: "agent-kit guard inactive: the resolved CLI <path> exited 1 with no output"`; the other three print their no-op payload. A path that is not safe inside a JSON string is left out of the message. No probe runs per call: the check reads the exit status and stdout of the one CLI run.

The Claude Code SessionStart command prints its own degraded text in all three cases, followed by `Cause: <reason>.` when the resolver gave one. The Claude PreToolUse(Bash) command stays silent (empty stdout, exit 0): it never answers `allow` (ADR `2026-08-13_claude-cli-kit-load-bootstrap.md`, Amend 2026-09-27), so the SessionStart text carries the notice that the guard is inactive.

`sessionStart` is the one hook that can surface text into the session, so it carries the diagnostic for all five: when resolution fails, `.cursor/hooks/agent/session-start.sh` emits (exit 0) an `additional_context` JSON payload stating that hooks are in degraded fail-open mode, which surfaces are inactive (hook-provided context, shell guard, schema check, secrets scan), and the fix (`npm i -D @dadado/agent-kit-cli` or set `AGENT_KIT_HOOK_BIN`). Emission is stateless per session — no marker files.

**Verify:** `node --test scripts/hook-session-start-diagnostic.test.mjs` exercises the three branches (resolvable → valid JSON from the real CLI; unresolvable → exit 0 + degraded-mode diagnostic; resolved but broken → a fake `agent-kit` that exits 1 with stderr only, and all five adapters exit 0 with their fail-open answer). Manually: run `sh .cursor/hooks/agent/session-start.sh </dev/null` from the repo root (resolvable here via `packages/cli/dist`); smoke procedure in [plugin-smoke-checklist.md](plugin-smoke-checklist.md) section 4.

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

Every channel where a release can reach users, how a new version gets there, and the IDs to quote when a listing needs follow-up. The operator makes every submission and clicks every Submit, Publish or Update button on a third-party site with the publisher account; no agent submits or creates an account. Each row is dated by the evidence behind it; a row with no recheck keeps its older date.

### Update modes

| Mode | Meaning |
|------|---------|
| `automatic` | A tag CI job, or a client that reads the public repository, carries the release with no manual step. The check after a release is read-only. |
| `agentic-browser` | The listing is edited in a third-party web form. The agent fills it from a generated payload and stops before the Submit or Update button; the operator clicks, then the agent checks the public page. |
| `operator-manual` | The operator does the step (form, upload, package push). The agent prepares the values and checks the result. |
| `none` | Nothing is updated per release: no package exists, or the channel follows another channel by itself. |

### Channels

| Channel | Package source | Update mode | Listing status (dated) | ID / URL |
|---------|----------------|-------------|------------------------|----------|
| npm `@dadado/agent-kit-cli` | `packages/cli`, published by the public repo's `publish-npm` job on the public Release tag (trusted publishing, provenance) | `automatic` | 6.19.1 published 2026-11-18; read 2026-11-20 | [npmjs.com/package/@dadado/agent-kit-cli](https://www.npmjs.com/package/@dadado/agent-kit-cli) |
| Landing | Sites `agent` (agent.missionkit.io) and `missionkit` (missionkit.io, the suite home), stamped from the public Release Latest and deployed by the private `sync-landing` tag job (`scripts/sync-landing-release.mjs`) | `automatic` | agent.missionkit.io shows v6.19.1, read 2026-11-20; missionkit.io not checked (its version is not in the served HTML) | [agent.missionkit.io](https://agent.missionkit.io/), [missionkit.io](https://missionkit.io/) |
| Claude Code marketplace (this repo) | `.claude-plugin/` at the public repo root, carried by `sync-public` | `automatic` | Public `.claude-plugin/plugin.json` at 6.19.1, read 2026-11-20. `claude plugin validate --strict` passes on the public tree | `/plugin install agent-kit --marketplace agent-kit-startup/agent-kit` (Claude Code 2.1.275+); older: `/plugin marketplace add agent-kit-startup/agent-kit` + `/plugin install agent-kit@agent-kit` |
| Anthropic plugin directory | `claude-directory/` (public repo), generated at public sync from `scripts/lib/claude-directory-profile.json` | Open: the directory checks the tracked branch about every 6 hours; whether passing versions publish by themselves (`automatic`) or by an operator click (`operator-manual`) is an operator choice made after the reviewer's decision | In review, nothing published yet (2026-11-20): v6.19.1 at public `main` 4ba6d38 passed validation ("ready to publish") and its scan (with directory policy warnings: a download-and-run command in `commands/dashboard.md`, removed for the next release, and the `icon` field note, which needs no action). Still in review on 2026-11-22. Submitted 2026-11-18 by the operator, then noted as listed on Claude Code only; the plugin page read on 2026-11-20 shows "When listed: Claude Code, Cowork and Claude apps (web, desktop, mobile)". See [Anthropic plugin directory package](#anthropic-plugin-directory-package) | Submission `c75e890b-7460-450e-83bb-caf0c7dc10ed`, [claude.ai/directory/manage](https://claude.ai/directory/manage) |
| Cursor Marketplace (curated) | `.cursor-plugin/plugin.json` at the public repo root (see [Packaging contract](#packaging-contract)) | Unknown until listed: no listing exists to show how Cursor picks up a new version | Publisher form submitted again by the operator on 2026-11-18 (contact on the missionkit.io domain, description edited by the operator); no submission ID or listing URL from Cursor yet. First submission 2026-08-14, no ID recorded | [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) |
| cursor.directory | Listing edited by hand from the Anthropic directory store profile; the site's scanner reads only the repo root default folders (root `skills/`, the 10 core skills) and ignores subfolder URLs | `agentic-browser` | Live (2026-11-18): edited at `/plugins/mission-kit/edit` with 17 curated items (13 Command, 3 Agent, 1 Skill) from `claude-directory/` at public `main` 4ba6d383 and the plan, build, review, ship, keep description; the operator clicked Update; the public page showed Commands (13), Agents (3), Skills (1) | [cursor.directory/plugins/mission-kit](https://cursor.directory/plugins/mission-kit) |
| Agent Plugins 1.0 / awesome-copilot | Root `plugin.json` and generated root `skills/` (see [Agent Plugins 1.0 package](#agent-plugins-10-package)) | `operator-manual` (one intake issue per pinned tag) | Not listed (2026-11-20): no intake issue opened; the intake's own gates pass on public `v6.19.1` (`4ba6d38305bdafec170312ec0626ca155b7298aa`) | [intake form](https://github.com/github/awesome-copilot/issues/new?template=external-plugin.yml) |
| Codex / OpenAI directory | `.codex-plugin/plugin.json` (public, 6.19.1, read 2026-11-20); the OpenAI directory takes the skills-only package (no hooks) | `operator-manual` | Not submitted (2026-11-22). The directory wants square icons and logos: `interface.logo` now points at `assets/brand/mission-kit-icon-1024.png` (1024 x 1024, the operator's choice of 2026-11-21) instead of `assets/brand/mission-kit-logo.png` (151 x 150); public from the next tag. The HOL ADR (`2026-09-24_hol-registry-listing-and-mission-kit-launch`) records this manifest as where HOL gets the name and avatar, so the HOL avatar should become the square icon too (unverified until HOL reads the release). The other store icons were already square (`.claude-plugin/icon.png` 1024 x 1024, `dashboard/logo-marketplace.svg` 512 x 512) | none yet |
| HOL Registry | The public repository (the registry reads its plugin manifests) | `automatic` | Live since 2026-10-17. Not re-read on 2026-11-20 (the page refuses automated fetches); whether it shows each release is unverified | [hol.org/registry/plugins/agent-kit-startup/agent-kit](https://hol.org/registry/plugins/agent-kit-startup%2Fagent-kit) |
| AUR `agent-kit-cli` | `packaging/aur/agent-kit-cli/` (PKGBUILD and `.SRCINFO` pinned to 6.9.0, built and checked 2026-10-24) | `operator-manual` (version bump and push per release) | Not published (2026-11-20): the package name is free on the AUR | none yet |
| Homebrew tap | `packaging/homebrew/agent-kit.rb` (formula pinned to 6.9.0, not run here) | `operator-manual` (version and sha256 bump per release) | Not published (2026-11-20): the tap repository `agent-kit-startup/homebrew-tap` does not exist | none yet |
| mise registry | `packaging/mise/agent-kit.toml` (npm backend, no version pin) | `none` once registered (it follows npm) | Not registered (2026-11-20): no `registry/agent-kit.toml` in `jdx/mise`; npm weekly downloads 898 (2026-11-13 to 2026-11-19), under the 1000 that mise asks for. Until then, the working entry is `"npm:@dadado/agent-kit-cli" = { version = "latest", allow_low_downloads = true, minimum_release_age = "0s" }` (checked with mise 2026.11.10 on Linux; `agent-kit doctor` prints it) | none yet |
| Open VSX (Mission Control extension for Cursor) | Proposed: a generated `packages/` member published by a fail-closed tag job, version in lockstep with the kit release (ADR `2026-11-20_mission-control-cursor-extension-host.md`, point 6) | `automatic` | Not built (2026-11-21): the operator accepted the ADR on 2026-11-21, with the Open VSX namespace `missionkit`; no extension code yet | none yet |
| Gemini CLI gallery | Root `gemini-extension.json`, generated by `scripts/sync-public.mjs` from the root `plugin.json` and the release version, plus the generated root `skills/` (see [Gemini CLI extension](#gemini-cli-extension)) | `automatic` once listed (the gallery and `gemini extensions update` read the public repository) | Not live (2026-11-22): the manifest is generated from the next tag on; the `gemini-cli-extension` topic on the public repository is an operator step, and the gallery lists the repository after a tag that carries both | none yet |

Homepage values: the root `plugin.json`, `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` say `https://agent.missionkit.io/` (the Agent Kit site); `.cursor-plugin/plugin.json` says `https://github.com/agent-kit-startup/agent-kit`. Forms that ask for a homepage take the manifest value of the package they list.

### Store refresh checklist

After each release is done (`/kit-prod` Done: private `main`, npm, the merged public sync PR and public Release Latest on the same tag), the maintainer runs one check per channel and records one line per channel. These steps never gate the release and never reopen it: a red or pending row is a follow-up with the channel, the evidence and the next step, fixed outside the release, and never a reason for another tag (ADR `2026-11-20_store-packages-and-per-release-distribution`). A channel that is not live yet prints `not live (<date>): <reason>`, the reason taken from the Channels table above, so every release leaves a recorded state per channel. An `agentic-browser` routine runs only in a session the operator watches, and the operator clicks the final button; with no operator watching it is recorded as owed.

| Channel | Mode | Check per release |
|---------|------|-------------------|
| npm | `automatic` | Covered by the release verification (version and provenance); not repeated here |
| Landing | `automatic` | Covered by the release verification (`sync-landing` green, both sites stamped); not repeated here |
| Claude Code marketplace | `automatic` | `gh api -H "Accept: application/vnd.github.raw" repos/agent-kit-startup/agent-kit/contents/.claude-plugin/plugin.json` shows the tag version; the same for `claude-directory/.claude-plugin/plugin.json` |
| Anthropic plugin directory | Open | The operator reads the version on the plugin page at [claude.ai/directory/manage](https://claude.ai/directory/manage) against the tag. Not live while the submission is in review; the row gets its mode from the auto-publish choice made after the reviewer's decision |
| Cursor Marketplace | Unknown | Not live until Cursor lists the plugin; the mode follows from how the listing picks up a version |
| cursor.directory | `agentic-browser` | [cursor.directory refresh routine](#cursordirectory-refresh-routine): payload from `claude-directory/` at the tag, form filled up to `Update Plugin` (the operator clicks), then the public tab counts and description checked |
| Agent Plugins 1.0 / awesome-copilot | `operator-manual` | Once listed: one intake issue per pinned tag (see [awesome-copilot intake gates](#awesome-copilot-intake-gates)) |
| Codex / OpenAI directory | `operator-manual` | Once submitted: the operator uploads the skills-only package at the tag |
| HOL Registry | `automatic` (unverified) | The operator reads the listing's version (the page refuses automated fetches). If the listing's version turns out to be hand-entered, the row moves to `operator-manual` |
| AUR, Homebrew tap | `operator-manual` | Once published: bump the version (and the sha256 for Homebrew) under `packaging/` and push |
| mise registry | `none` | Once registered it follows npm |
| Open VSX | `automatic` | Once the extension ships, its tag job publishes the same version; the check reads the version on the Open VSX page |
| Gemini CLI gallery | `automatic` | Once listed: `gh api -H "Accept: application/vnd.github.raw" repos/agent-kit-startup/agent-kit/contents/gemini-extension.json` shows the tag version; until then `not live` with the reason from the Channels table |

#### cursor.directory refresh routine

cursor.directory's scanner reads only the repository root default folders (root `skills/`, the 10 core skills) and ignores subfolder URLs, so the listing's curated items are typed into its edit form. The payload comes from the store profile (`scripts/lib/claude-directory-profile.json`, the Anthropic directory profile, read as is) and from the `claude-directory/` package at the release tag. `scripts/store-listing-payload.mjs` runs on the factory checkout:

```bash
git clone --depth 1 --branch vX.Y.Z https://github.com/agent-kit-startup/agent-kit /tmp/agent-kit-vX.Y.Z
node scripts/store-listing-payload.mjs --store cursor-directory --version X.Y.Z \
  --dir /tmp/agent-kit-vX.Y.Z/claude-directory --format text
```

`--format json` prints the same payload as JSON. The script fails when the package carries another version, misses a profile item or holds an item the profile does not list. It never opens or submits the store page.

In a browser session the operator watches, signed in with the publisher account:

1. Open `https://cursor.directory/plugins/mission-kit/edit`.
2. Set the description from the payload, the number of components, and for each component in payload order its type (Command, Agent or Skill), name, description and body.
3. Stop before `Update Plugin`: the operator clicks it.
4. Check `https://cursor.directory/plugins/mission-kit`: the Commands, Agents and Skills tabs show the payload counts (13, 3 and 1 for 6.19.1) and the description matches.

Runs:

| Date | Version | How | Result |
|------|---------|-----|--------|
| 2026-11-18 | 6.19.1 | By hand, before the script: 17 items (13 Command, 3 Agent, 1 Skill) from `claude-directory/` at public `main` 4ba6d383 and the plan, build, review, ship, keep description | The operator clicked Update; the public page showed Commands (13), Agents (3), Skills (1) |

### Anthropic plugin directory package

The directory takes scripts, package-manager files, unknown config fields and non-standard frontmatter keys only from Verified organizations, so the repository root is refused (2 blocking issues on public `main` b56a3bc, 2026-11-17) and the v6.19.0 package was refused for the kit's own frontmatter keys (`audience` first; validation of public `main` a0e3e3d, 2026-11-18). From 6.19.1 `claude-directory/` is a store package (see [Store packages](#store-packages)): the items of `scripts/lib/claude-directory-profile.json` only, with the profile's descriptions and standard Claude Code frontmatter, `.claude-plugin/plugin.json` (release version, profile description, `skills: ./skills`), `README.md` by stage; no hooks, no scripts. `scripts/lib/claude-directory-package.mjs` fails the sync on any other file kind or on a profile item without a source. It also fails the sync when a package file documents a download-and-run command (`npx`, `pnpm dlx`, `yarn dlx`, `bunx`, `uvx`, `pipx run`, or a `curl`/`wget`/PowerShell download piped into a shell or interpreter): the directory can hold or refuse a version with such a command, even in documentation, from an organization that is not Verified, and asks to point to the tool's own install instructions instead. That was the Directory policy warning read on the v6.19.1 review page on 2026-11-22; the package at public `main` 4ba6d38 had `npx @dadado/agent-kit-cli dashboard` twice and one `curl` piped into `node` in `commands/dashboard.md`. This one is fixed in the command itself, not in store copy: `/dashboard` names `agent-kit dashboard` and the install instructions. The package reaches the directory clean with the release after 6.19.1. Submit at [claude.ai/directory/manage](https://claude.ai/directory/manage) with the public repo's `claude-directory/` subfolder as the source ("Plugin in a subfolder or on another branch?" in step 1). Check a tag with `claude plugin validate --strict --profile directory claude-directory` on a clone; the portal also checks frontmatter keys, which that command does not. One policy hold was left for the reviewer on 2026-11-18: the name `agent-kit` is close to an existing listing. The directory takes the listing icon from the manifest only on the first save or submission (`.claude-plugin/icon.png`; regenerate with `rsvg-convert -w 1024 -h 1024 dashboard/logo-marketplace.svg -o .claude-plugin/icon.png`).

Cursor publisher terms require a plugin to be free, with no direct or indirect charge. Checked 2026-10-24: `.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `.codex-plugin/plugin.json` carry no price, upsell or Colony mention; the plugin is Apache-2.0. Keep paid offers (seats, cloud, paid MCP) out of plugin copy.

## Store packages

A store or directory that needs another shape gets its own generated package, built from the kit at public sync and documented here. The kit's own commands, agents and skills do not change to fit one store: no single package tries to satisfy every store.

| Store | Package | Profile | What differs from the full kit |
|-------|---------|---------|--------------------------------|
| Anthropic plugin directory | `claude-directory/` (public repo) | `scripts/lib/claude-directory-profile.json` | Curated items by stage (plan, build, review, ship, keep), store descriptions, standard frontmatter only, no hooks or scripts |
| Agent Plugins 1.0 (awesome-copilot) | `skills/` (public repo root) | none (all core skills) | See [Agent Plugins 1.0 package](#agent-plugins-10-package) |
| Gemini CLI gallery | `gemini-extension.json` (public repo root) over the same `skills/` | none (name and description of the root `plugin.json`) | See [Gemini CLI extension](#gemini-cli-extension) |

A store profile lists each item by kind and name with its stage and a description that says, in user terms, what the item does and when to use it. Internal, meta, deprecated, Cursor-only and third-party integration items stay out of store packages; they remain in the full kit. Changing what a store shows is an edit of its profile, reviewed like any other change.

## Agent Plugins 1.0 package

The public repository is also an [Agent Plugins 1.0](https://agent-plugins.org/specification) package, so one tree serves GitHub Copilot (VS Code, Copilot CLI, the Copilot app and the awesome-copilot marketplace), Codex portable discovery and Antigravity. Anthropic is not in the spec: `.claude-plugin/` stays separate, as do `.cursor-plugin/` and `.codex-plugin/`.

| Path (public tree) | Source |
|--------------------|--------|
| `plugin.json` | tracked at the repo root: `$schema` `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, `name` `agent-kit` (same name as the Claude plugin). The tracked file has no `version`, so it is not a seventh manifest to bump; `scripts/sync-public.mjs` writes `version` (the `packages/cli/package.json` version) into the public copy, because the awesome-copilot intake requires it. |
| `skills/<name>/` | **generated by `scripts/sync-public.mjs`** from `.cursor/skills/core/<name>/`; never tracked in the private tree (sync refuses a tracked `skills/` file). Relative Markdown links in the copies are rewritten: a link to a file in the same skill folder stays relative, any other link becomes a `https://github.com/agent-kit-startup/agent-kit/blob/main/...` URL (a skill may reference by path only files inside its own folder). |
| `mcp.json` | none yet (no kit MCP server) |
| `gemini-extension.json` | **generated by `scripts/sync-public.mjs`**, never tracked (sync refuses a tracked copy); see [Gemini CLI extension](#gemini-cli-extension) |

Only core skills whose `SKILL.md` frontmatter `name` equals the directory name and is a valid Agent Skills name, and whose frontmatter a strict YAML loader accepts (an unquoted value with `: ` or ` #` in it is rejected), are copied; clients skip the others anyway. Every core skill qualifies today, a test fails when one stops qualifying, and the sync log lists any skipped one. Rules: `scripts/lib/agent-plugin-layout.mjs`, tests in `scripts/lib/agent-plugin-layout.test.mjs` (including every link of the real copies). Preview: `node scripts/sync-public.mjs --dry-run` lists the files, `node scripts/sync-public.mjs --out <new folder>` writes the tree without pushing.

### awesome-copilot intake gates

The awesome-copilot intake is an issue (form [External plugin submission](https://github.com/github/awesome-copilot/issues/new?template=external-plugin.yml)), not a PR. Its workflow runs five gates on the submitted ref (`.github/scripts/external-plugins/external-plugin-quality-gates.mjs` in `github/awesome-copilot`): manifest spec compliance (`version` and `description` are required there), version match (form version == `plugin.json` version at the ref and at the SHA), ref and SHA name the same commit, `@microsoft/vally` lint of `skills/` (strict YAML frontmatter; file references only inside the skill folder) and an install smoke with the Copilot CLI.

Checked 2026-11-11 with those gate functions and `@microsoft/vally` 0.20.0, run locally:

| Tree | Spec compliance | Version match | Ref / SHA | vally lint | Install smoke |
|------|-----------------|---------------|-----------|------------|---------------|
| public `v6.16.1` (`39bbde4f`) | fail (no `version`) | fail (no `version`) | pass | fail, 7 of 10 skills (6 with links outside the skill folder, `clean-code` frontmatter) | pass (Copilot CLI 1.0.109, 10 skills) |
| `sync-public --out` tree with the three rules above | pass | pass | pass | pass, 10 of 10 | not rerun (install path unchanged) |

So the intake issue must pin the first public tag that carries these rules; an issue pinned to `v6.16.1` or earlier fails three gates. Before opening it, repeat the check on that tag: clone `github/awesome-copilot`, `npm ci --ignore-scripts`, and call `inspectAgentPluginSpecCompliance`, `runVersionMatchGate`, `runRefShaConsistencyGate` and `runVallyLintGate` on a clone of the public tag.

Form values: plugin name `agent-kit`, repository `agent-kit-startup/agent-kit`, plugin path empty (the plugin is the repository root; a `/` path fails the install), ref `v<version>`, SHA the full 40-character commit of that public tag (`gh api repos/agent-kit-startup/agent-kit/git/ref/tags/v<version> --jq .object.sha`), version `<version>`, license `Apache-2.0`, author `agent-kit-startup`, homepage `https://agent.missionkit.io/` (the `plugin.json` value), keywords from `plugin.json`.

Hooks are not part of the format, so this package carries no HITL guard hooks (the Cursor and Claude plugins and `agent-kit install` still do). Say so in any listing made from it (the OpenAI directory rejects plugins with hooks; upload the skills-only package).

Operator steps, after a release has synced this layout to public `main`: open the awesome-copilot intake issue with a pinned tag (see the gates above); upload the skills-only package to the OpenAI directory. Public PR #95 was closed as superseded on 2026-11-07.

### Gemini CLI extension

The Gemini CLI reads the public repository as an extension: a root `gemini-extension.json` and skills from `skills/<name>/SKILL.md`, discovered without a manifest field (google-gemini/gemini-cli `docs/extensions/reference.md`, read 2026-11-22). The operator chose on 2026-11-21 to keep the channel with a generated manifest (`Criar o manifesto (Recommended)`).

- **Manifest:** `scripts/sync-public.mjs` writes `gemini-extension.json` beside the stamped `plugin.json` with three documented fields only: `name` and `description` from the tracked root `plugin.json`, `version` from `packages/cli/package.json` (the same number as the six release manifests, ADR `2026-11-20_store-packages-and-per-release-distribution` point 7). The root `plugin.json` is the source, not the Anthropic directory profile, because Gemini loads the Agent Plugins tree (the core skills) and the profile's copy names Claude Code. The name must be lowercase letters, digits and dashes, since the CLI expects it to match the installed directory (`agent-kit`, the repository name).
- **Check:** `scripts/lib/agent-plugin-layout.test.mjs` (CI, `test:factory-root-node`) asserts the generated name, version and description equal their sources and that no `gemini-extension.json` is tracked; `planAgentPluginSkills` fails the sync on a tracked copy. Preview with `node scripts/sync-public.mjs --out <new folder>`.
- **What it carries:** skills only. The public root has no `commands/`, `agents/`, `hooks/` or `GEMINI.md`, so the extension adds no slash commands, sub-agents, context file or HITL guard hooks; the full kit still installs with `agent-kit install`.
- **Listing:** the gallery crawls tagged public repositories that carry the `gemini-cli-extension` topic and a root `gemini-extension.json` (`docs/extensions/releasing.md`); the topic alone lists nothing. Operator step, after the first tag that carries the manifest: add the topic in the public repository's About settings. Install line once public: `gemini extensions install https://github.com/agent-kit-startup/agent-kit`.

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
- [x] Live Cursor Marketplace submission (publisher ops / HITL) - operator submitted 2026-08-14 and again 2026-11-18. No listing URL or submission ID from Cursor yet; current state in [Vendor listings](#vendor-listings).
- [x] Phase B cutover so public catalog is not overwritten by private sync
