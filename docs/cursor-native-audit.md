# Cursor-native audit - Agent Kit harness

Audit of Cursor-specific artifacts in the Agent Kit repository: what exists, what is missing, and how VS Code and Windsurf compare. Living audit; last refreshed **2026-09-16** (changelog keep-up: Aug 17–Sep 10 surfaces plus desktop 3.20.x classify; plugin pin 5.9.0). A6/A7 status lines re-verified true at HEAD.

**Awareness check (advisory):** `agent-kit cursor-awareness --check` and `/cursor-update-awareness` diff Cursor changelog signals against this inventory without mutating it. The check reports open Action items, a version-number delta, and a **feature-keyword digest** (changelog headings and slash commands missing from this file or `docs/cursor-3-features.md`). Version-prose and Marketplace packaging were refreshed on 2026-08-05; only the live submission stays on the Marketplace plan (publisher HITL). See [cursor-update-awareness.md](cursor-update-awareness.md) and [`docs/research/cursor-changelog-keep-up-2026-09.md`](research/cursor-changelog-keep-up-2026-09.md).

## Summary

| Area | Status | Notes |
|------|--------|-------|
| `.cursor/rules/` | Present (25 files) | 10 rules `alwaysApply: true` (8 structural + `hitl-ask-questions` + `git-secrets-safety`); stack rules use globs |
| `.cursor/skills/` | Present (12 `SKILL.md`) | Disk: `core/` 3 + `community/` 8 + `domain/` 1. Plugin discovery is `.cursor/skills/core` only. See Skills-on-demand |
| `.cursor/agents/` | Present (14 agents) | Mix of core and stack subagents; EN pack ids |
| `.cursor/commands/` | Present (30 commands) | DevOps spine + handoff + orchestration + backlog/dashboard + kit landing + public-issue-triage |
| `.cursor/hooks/` (shell) | Present | Git pre-commit + edit validators; not wired to Cursor agent events |
| `.cursor/hooks.json` | **Present (L0)** | 5 events (`sessionStart`, `preCompact`, `beforeShellExecution`, `afterFileEdit`, `beforeSubmitPrompt`); no `stop` hook |
| `.cursor-plugin/plugin.json` | Present | Marketplace-ready at **5.9.0**, aligned with `KIT_VERSION`; declares explicit component paths |
| Plan Mode | Absorbed (docs + HITL pointer) | Kit `.cursor/plans/*.plan.md` stay SoT. Copy a native plan, then Gate A. ADR `2026-09-15_kit-plans-sot-over-host-plan-mode.md` |
| Skills-on-demand | Complement (no kit loader) | Cursor loads `SKILL.md` when relevant. Kit does not wrap that loader. |
| `git-hooks/prepare-commit-msg` | Present | Strips coding-agent signatures and session links (Cursor, Claude Code, Copilot, peers); `--check` mode for the staging/prod gate |
| `AGENTS.md` (dogfood) | **Present** | Root cross-IDE contract; points at `.cursor/project-context.md` |
| `mcp.json` | Absent | No project-level MCP config in core |
| Cursor Projects (beta, 2026-09-10) | Not integrated (Cursor-native only) | Cloud coordinator + subagents, synced project files, Slack/schedule/PR subscriptions. ADR `2026-09-12_cursor-projects-thin-adapter.md`: no structural change. See [cursor-3-features.md](cursor-3-features.md) and [research/cursor-projects-study.md](research/cursor-projects-study.md) |
| Custom modes (2026-08-19) | Not integrated (thin-adapter) | Pin a skill as an always-on chat mode. Kit `agentPersona` stays chat chrome only. |
| `/goal` / `/loop` (2026-08-19) | Not integrated (thin-adapter) | Native long-lived objective and recurring check-ins. Do not replace kit plan to-dos or `/run-plan`. |
| Origin / start from scratch, without a repo (2026-08-17 / 2026-08-27) | Not integrated (Cursor-native only) | Origin Repos; Bring your GitHub repos; Pull requests; Agents in every repo; App extensions for Cursor repos; live preview; Vercel publish. Not the kit git spine. |
| Self-hosted machines (2026-09-02) | Not integrated (Cursor-native only) | My Machines, team pools, dynamic pool scheduling, run on your sandboxes, computer use on Linux and Mac. Operator infra. Cloud Agents stay audits-only. |
| Steering / Automations / subagents on their own machines | Not integrated (Cursor-native only) | IDE follow-up UX, scheduled-agent UI, cloud-isolated subagents. No kit hook or third `BackendId`. |

---

## Plugin (`.cursor-plugin/`)

**File:** `.cursor-plugin/plugin.json`

| Field | Value |
|-------|-------|
| name | `agent-kit` |
| version | `5.9.0` (pinned to `KIT_VERSION` by `packages/cli/src/lifecycle/l0.test.ts`; verified 2026-09-15 against root `package.json`, `packages/cli/package.json`, and npm `dist-tags.latest`) |
| description | HITL framework for AI-assisted IDEs (plan, handoff, staging→prod, memory loop, anti-slop) |
| components | `rules`, `skills`, `agents`, `commands`, `hooks` declared explicitly |

**Findings:**

- Plugin manifest exists for Marketplace distribution path (install port A).
- Manifest is no longer metadata-only. The plugin root is the parent of `.cursor-plugin/`, and Cursor's default discovery reads `rules/`, `skills/`, `agents/`, `commands/`, `hooks/hooks.json` at that root - paths this repo does not use. Without explicit entries the plugin would list with **zero** components. Packaging contract: [marketplace.md](marketplace.md).
- `skills` points at `.cursor/skills/core`, not `.cursor/skills`: discovery matches direct children holding a `SKILL.md`, and `core/`/`community/` are one level too shallow. On 2026-09-15 that core tree has three skills (`clean-code`, `docs-repo`, `hitl-gates`). Community and domain stay off Marketplace discovery (`agent-kit add` / project-owned).
- CLI `init` does **not** write `.cursor-plugin/plugin.json` into target projects; no generator under `packages/cli/src/generator/` references it. (Corrected 2026-08-05; the earlier claim was stale.)

**Gap:** Plugin packaging and Marketplace submission flow are not documented end-to-end in `docs/getting-started.md`. See [marketplace.md](marketplace.md) and Phase B registry cutover plan. Live submission stays publisher HITL. This tree's manifest is **5.9.0**. Live Marketplace listing is publisher HITL and may lag the repo pin.

---

## Rules - modes and coverage

**Location:** `.cursor/rules/*.mdc` (25 files)

### alwaysApply: true (core - structural)

These run on every agent turn in Cursor:

| Rule | Role |
|------|------|
| `agent-output-hygiene.mdc` | Chat ≠ repo; no meta-language in artifacts |
| `context-guardian.mdc` | Context window warning + handoff trigger |
| `cursor-plan-handoff.mdc` | Plan phases, HANDOFF.md, `/continue-plan` |
| `cursor-skills-general.mdc` | General coding + git flow conventions |
| `cursor-skills-git-workflow.mdc` | Staging → prod spine; blocks direct main |
| `docs-professional-standard.mdc` | Inheritable docs standard |
| `memory-loop.mdc` | `.cursor/memory/` errors and decisions |
| `ux-tone.mdc` | Chat tone only; `alwaysApply: true` (fixed 2026-07-19) |
| `hitl-ask-questions.mdc` | Kit-wide Ask questions; numbered fallback is path 1 |
| `git-secrets-safety.mdc` | Never stage `.env` or credential files |

### alwaysApply: false + globs (stack / language)

| Rule | Globs (summary) |
|------|-----------------|
| `cursor-skills-clickup.mdc` | agent-requestable only (no globs) |
| `cursor-skills-n8n.mdc` | n8n workflows, `*workflow*.json` |
| `cursor-skills-api.mdc` | api paths, OpenAPI, GraphQL |
| `cursor-skills-devops.mdc` | Docker, CI, k8s, Terraform |
| `cursor-skills-groovy.mdc` | `*.groovy` |
| `cursor-skills-integrations.mdc` | integrations, webhooks |
| `cursor-skills-json.mdc` | `*.json` |
| `cursor-skills-mobile.mdc` | mobile paths |
| `cursor-skills-node.mdc` | JS/TS |
| `cursor-skills-php.mdc` | `*.php` |
| `cursor-skills-prompts.mdc` | prompt markdown |
| `cursor-skills-python.mdc` | `*.py` |
| `cursor-skills-sql.mdc` | `*.sql` |
| `cursor-skills-testing.mdc` | test/spec paths |
| `cursor-skills-webdesign.mdc` | HTML/CSS/Vue/Svelte |

### Anomalies (resolved)

| Rule | Was | Now |
|------|-----|-----|
| `ux-tone.mdc` | Missing YAML frontmatter | ✅ `alwaysApply: true` with description (2026-07-19) |

### Rule-mode compliance

- Stack/product rules (ClickUp, n8n) correctly use `alwaysApply: false` per decision `2026-07-09_structural-harness-vs-stack`.
- Language CURSOR-SKILLS rules are stack-on-demand via globs - acceptable for dev ergonomics; not structural core.
- CLI generator (`packages/cli/src/generator/cursor.ts`) produces a **minimal** rule set (3–4 files) for new projects; it does not copy the full 25-rule workspace. Intentional L0 subset; document parity gap in Phase B cutover.

---

## Hooks - shell vs native

### Shell hooks (`.cursor/hooks/`)

| Path | Trigger | Class |
|------|---------|-------|
| `pre-commit/pre-commit` | Git pre-commit (manual install to `.git/hooks/`) | Core orchestrator |
| `pre-commit/check-secrets.sh` | Staged files | Core - security |
| `pre-commit/validate-all-json.sh` | Staged JSON | Core |
| `lib/json-validator.js` | Shared (pre-commit) | Core |
| `lib/n8n-checker.js` | Manual / stack skill | Stack |

**Removed:** unwired `pre-edit/validate-json.sh` and `post-edit/validate-n8n.sh` (never attached to Cursor agent events). JSON validation stays on git pre-commit; HANDOFF/plan schema is advisory via `afterFileEdit` → `agent-kit validate after-edit`.

**Install model:** Documented copy-to-`.git/hooks/pre-commit`. CLI `generateGitHooks` writes a **simpler** secrets-only hook - not the full `.cursor/hooks/pre-commit/` chain.

### Native Cursor hooks (`.cursor/hooks.json`)

**Status: present (L0).** Thin shell adapters shell out to `packages/cli` (SoT). No `python3` requirement for these events. No `stop` hook.

| Event | Adapter | CLI SoT |
|-------|---------|---------|
| `sessionStart` | `.cursor/hooks/agent/session-start.sh` | `agent-kit hook session-start` |
| `preCompact` | `.cursor/hooks/agent/pre-compact.sh` | `agent-kit hook pre-compact` |
| `beforeShellExecution` | `.cursor/hooks/agent/guard-shell.sh` | `agent-kit guard shell --json` |
| `afterFileEdit` | `.cursor/hooks/agent/after-edit-schema.sh` | `agent-kit validate after-edit` (advisory) |
| `beforeSubmitPrompt` | `.cursor/hooks/agent/secrets-prompt.sh` | `agent-kit guard prompt --json` (advisory fail-open) |

Hooks may deny or annotate only; they never speak or decide. `agent-kit doctor` reports `hooks: active | degraded`. Selection for bare `/plan-review-triage` is `agent-kit monitors --untriaged --json` (never newest-mtime-wins). ADR: `2026-07-29_cli-invariants-thin-hook-adapters`.

Shell git hooks and native hooks serve different layers: git hooks = commit time; native hooks = agent runtime.

### Repo-level git hook

| File | Purpose |
|------|---------|
| `git-hooks/prepare-commit-msg` | Remove coding-agent co-author trailers, session-link trailers and "Generated with <agent>" lines from commit messages (Cursor, Claude Code, Copilot, peers); human co-authors kept |

Separate from `.cursor/hooks/`; optional hygiene for teams that reject bot co-authorship.

---

## Agents and commands (Cursor-native)

### Agents (`.cursor/agents/` - 14)

Cursor subagent definitions. Consumed via Task tool / Agents Window. Full classification in [coherence-inventory.md](coherence-inventory.md).

### Commands (`.cursor/commands/` - 31)

Slash commands in Cursor. Counted from `ls .cursor/commands/*.md` on 2026-09-17. Every file carries `name` + `description` frontmatter (required by the Marketplace submission checklist; `name` matches the filename slug, so nothing was renamed).

| Command | Spine |
|---------|-------|
| `/continue-plan` | Handoff resume |
| `/handoff` | Save HANDOFF |
| `/run-plan`, `/run-plan-all` | Continuous run / multi-plan queue (no `/git-prod`) |
| `/run-plan-loop`, `/run-plan-orchestrated` | Deprecated aliases forcing one strategy |
| `/git-staging`, `/git-prod` | DevOps spine |
| `/kit-staging`, `/kit-prod` | Factory files; not consumer L0. Landing wrap of native git |
| `/start-project`, `/agent-kit-onboard`, `/hotfix` | Bootstrap and narrow-change entry |
| `/backlog-add`, `/backlog-edit`, `/backlog-cancel`, `/backlog-delete`, `/archive-plan` | Plan queue management |
| `/plan-external-review`, `/plan-review-triage`, `/field-report-resolve` | Audits and residual triage |
| `/dashboard`, `/dashboard-broadcast` | Mission Control |
| `/context-status`, `/update`, `/cursor-update-awareness`, `/dogfood`, `/qa` | Lifecycle, awareness, and release/bug claim verification |
| `/public-issue-triage` | Public issue intake |
| `/summary`, `/tips` | UX helpers |

Commands are **Cursor-only**. VS Code/Windsurf have no equivalent slash-command files; parity relies on `AGENTS.md` and IDE-specific instruction files.

---

## Plan Mode (host vs kit plans)

Cursor Plan Mode can hold a native plan in the host UI. That document is not Gate A.

| Rule | Behavior |
|------|----------|
| SoT | Kit `.cursor/plans/*.plan.md` (frontmatter to-dos) plus HANDOFF machine fields |
| Host Plan Mode | Does not replace Gate A or Gate B |
| Already in Plan Mode | Copy the native plan into `.cursor/plans/` as kit-shaped markdown, then run Gate A |
| L0 size | Pointers live in hitl-gates and `/start-project`. `/run-plan` procedure stays under 80 lines |

ADR: `2026-09-15_kit-plans-sot-over-host-plan-mode.md`. Do not reopen superseded Mission Control protocol-open (`2026-07-24_mission-control-cursor-native-open.md`) or the Projects thin-adapter (`2026-09-12_cursor-projects-thin-adapter.md`).

---

## Skills-on-demand

Cursor loads Agent Skills when a `SKILL.md` is in a discovered skills path and the turn matches. The kit does not wrap or replace that loader.

| Tree | Count (2026-09-15) | How it ships |
|------|--------------------|--------------|
| `.cursor/skills/core/` | 3 (`clean-code`, `docs-repo`, `hitl-gates`) | L0 overlay. Plugin `skills` points here |
| `.cursor/skills/community/` | 8 | `agent-kit add` |
| `.cursor/skills/domain/` | 1 (`llm-security-ops`) | Project-owned; not contributeable upstream |
| Manifest `skills[]` | 9 ids | Install index. Does not list L0 `hitl-gates` or domain `llm-security-ops` |

Total `SKILL.md` files on disk: 12. Registry `core/` used to be two skills; `hitl-gates` is the third (L0, 2026-09-15).

---

## CLI generators - multi-IDE parity

**Entry:** `packages/cli/src/generator/index.ts`

| IDE | Generator | Artifacts | Parity vs Cursor workspace |
|-----|-----------|-----------|----------------------------|
| Cursor | `cursor.ts` | `.cursor/rules/` (3–4 rules), optional agent, `/agent-kit-status` | Low - subset only |
| VS Code | `vscode.ts` | `.vscode/settings.json`, `.github/copilot-instructions.md`, optional `.agent.md` | Low - no handoff commands, no hooks |
| Windsurf | `windsurf.ts` | `.windsurfrules` (short bullet list) | Minimal |
| Cross-IDE | `agents-md.ts` | `AGENTS.md` | Medium - flow summary, no full rule corpus |
| Git | `git-hooks.ts` | `.git/hooks/pre-commit` (rg secrets) | Simpler than repo's `.cursor/hooks/` |

**Templates:** `templates/cursor/`, `templates/vscode/`, `templates/windsurf/` - README stubs only; generators inline strings, not template files.

---

## VS Code - gaps

| Cursor capability | VS Code equivalent | Agent Kit today |
|-------------------|-------------------|-----------------|
| `.cursor/rules/*.mdc` | Copilot instructions, `.github/copilot-instructions.md` | Generated minimal copilot-instructions |
| Slash commands | None native | Not portable - document manual prompts |
| Subagents / Task | Copilot custom agents (`.agent.md`, Pro) | One optional `security-review.agent.md` |
| HANDOFF + plans | `AGENTS.md` + repo files | Generated `AGENTS.md` only |
| Native hooks | None | N/A |
| MCP | VS Code MCP (when supported) | Not generated |
| `/worktree`, `/best-of-n` | N/A | Mentioned in generated AGENTS.md (Cursor-centric) |

**Gap priority:** Expand `AGENTS.md` generator with handoff spine and git flow; add Windsurf/VS Code docs mirroring `docs/cursor-3-features.md`.

---

## Windsurf - gaps

| Cursor capability | Windsurf equivalent | Agent Kit today |
|-------------------|---------------------|-----------------|
| Rules | `.windsurfrules` | Short generated file |
| Cascade modes | Windsurf-native | Not referenced in generator |
| Commands / agents | Limited | Not generated |
| HANDOFF | File-based (works) | Same as any IDE if user follows docs |

**Gap priority:** `.windsurfrules` should include handoff + git spine bullets; link to `AGENTS.md` for shared context.

---

## Dogfood gaps (this repository)

The Agent Kit repo uses the full Cursor workspace and **does**:

1. Version `.cursor/hooks.json` (`sessionStart` / `preCompact`)
2. Include root `AGENTS.md` (cross-IDE contract)

Still open dogfood gaps:

1. Auto-install git hooks on clone (documented manual copy)
2. Ship `mcp.json` for optional MCP servers

Acceptable for private SoT until Phase B registry cutover defines minimum dogfood before public sync.

---

## Action items

| ID | Status | Action |
|----|--------|--------|
| A1 | ✅ Done | Fix `ux-tone.mdc` frontmatter |
| A2 | ✅ Done | Refresh [coherence-inventory.md](coherence-inventory.md) + [drift-inventory.md](drift-inventory.md) (2026-07-19) |
| A3 | ✅ Done | `.cursor/hooks.json` + agent scripts (`sessionStart` / `preCompact`) |
| A4 | ✅ Done | Factory tracked `git-hooks/pre-commit` chains main-guard first, then `.cursor/hooks/pre-commit/` JSON + secrets (`validate-all-json.sh` then `check-secrets.sh`) via `git rev-parse --show-toplevel`. Consumer clones without that directory still get the main-guard. Alternate Cursor-native copy lacks the main-guard. CLI generator still skips if a hook exists. Install/reinstall remains HITL. |
| A5 | ✅ Done | Root `AGENTS.md` present (dogfood cross-IDE contract) |
| A6 | Partial | Marketplace plugin path documented ([marketplace.md](marketplace.md) packaging contract, 2026-08-05); VS Code/Windsurf install still open |
| A7 | Open | Expand generators or template files for multi-IDE parity (scoped: Windsurf `.windsurfrules` handoff/git bullets + VS Code instruction parity with [cursor-3-features.md](cursor-3-features.md); not Marketplace submit). Claude CLI session kit-load (`CLAUDE.md` / `/agent-kit`) is a separate surface: [claude-cli-kit-load.md](claude-cli-kit-load.md). |

---

## References

- [Cursor Native Features](cursor-3-features.md)
- [Cursor update awareness](cursor-update-awareness.md)
- [Coherence inventory](coherence-inventory.md)
- [Cursor changelog keep-up (2026-09)](research/cursor-changelog-keep-up-2026-09.md)
- [Cursor Projects study](research/cursor-projects-study.md); ADR `2026-09-12_cursor-projects-thin-adapter.md`
- Plan Mode vs kit plans: ADR `2026-09-15_kit-plans-sot-over-host-plan-mode.md`
- Mission Control protocol-open (superseded, do not reopen): ADR `2026-07-24_mission-control-cursor-native-open.md`
- Decision: structural harness vs stack (maintainers' decision log, private repo)
