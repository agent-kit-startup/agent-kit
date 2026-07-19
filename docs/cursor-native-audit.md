# Cursor-native audit - Agent Kit harness

Audit of Cursor-specific artifacts in the Agent Kit repository: what exists, what is missing, and how VS Code and Windsurf compare. Living audit; last refreshed **2026-07-19** (post EN sweep on staging).

## Summary

| Area | Status | Notes |
|------|--------|-------|
| `.cursor/rules/` | Present (23 files) | 8 core rules `alwaysApply: true`; stack rules use globs |
| `.cursor/skills/` | Present (7 skills) | Install output from registry (`core/` + `community/`) |
| `.cursor/agents/` | Present (13 agents) | Mix of core and stack subagents; EN pack ids |
| `.cursor/commands/` | Present (10 commands) | DevOps spine + handoff + orchestration |
| `.cursor/hooks/` (shell) | Present | Git pre-commit + edit validators; not wired to Cursor agent events |
| `.cursor/hooks.json` | **Present (L0)** | `sessionStart` + `preCompact`; no `stop` hook |
| `.cursor-plugin/plugin.json` | Present | Metadata only; version `3.0.0` (drift vs product **3.5.1**) |
| `git-hooks/prepare-commit-msg` | Present | Strips Cursor co-author trailer |
| `AGENTS.md` (dogfood) | **Absent** | CLI generates it for target projects; this repo does not use its own cross-IDE file |
| `mcp.json` | Absent | No project-level MCP config in core |

---

## Plugin (`.cursor-plugin/`)

**File:** `.cursor-plugin/plugin.json`

| Field | Value |
|-------|-------|
| name | `agent-kit` |
| version | `3.0.0` |
| description | Multi-IDE bootstrapper (Cursor, VS Code, Windsurf) |

**Findings:**

- Plugin manifest exists for Marketplace distribution path (install port A).
- Manifest is metadata-only: no `rules`, `skills`, or `hooks` entries in the plugin schema used here.
- CLI `init` also writes `plugin.json` into target projects with equivalent fields.

**Gap:** Plugin packaging and Marketplace submission flow are not documented end-to-end in `docs/getting-started.md`. See [marketplace.md](marketplace.md) and Phase B registry cutover plan.

---

## Rules - modes and coverage

**Location:** `.cursor/rules/*.mdc` (23 files)

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
- CLI generator (`packages/cli/src/generator/cursor.ts`) produces a **minimal** rule set (3–4 files) for new projects - does not copy the full 23-rule workspace. Intentional L0 subset; document parity gap in Phase B cutover.

---

## Hooks - shell vs native

### Shell hooks (`.cursor/hooks/`)

| Path | Trigger | Class |
|------|---------|-------|
| `pre-commit/pre-commit` | Git pre-commit (manual install to `.git/hooks/`) | Core orchestrator |
| `pre-commit/check-secrets.sh` | Staged files | Core - security |
| `pre-commit/validate-all-json.sh` | Staged JSON | Core |
| `pre-edit/validate-json.sh` | Manual / legacy edit hook | Core |
| `post-edit/validate-n8n.sh` | n8n workflow edits | Stack |
| `lib/json-validator.js` | Shared | Core |
| `lib/n8n-checker.js` | Shared | Stack |

**Install model:** Documented copy-to-`.git/hooks/pre-commit`. CLI `generateGitHooks` writes a **simpler** secrets-only hook - not the full `.cursor/hooks/pre-commit/` chain.

### Native Cursor hooks (`.cursor/hooks.json`)

**Status: present (L0).**

| Event | Script | Role |
|-------|--------|------|
| `sessionStart` | `.cursor/hooks/agent/session-plan-guard.py` | Inject HANDOFF excerpt + manual one-phase hard rules (incl. HITL slash commands keep the turn) |
| `preCompact` | `.cursor/hooks/agent/precompact-handoff.py` | User-visible handoff hint when context compacting |

No `stop` follow-up: it stole the agent turn from `/git-staging` / `/git-prod` confirmation waits. Phase/HITL stay in sessionStart + soft rules; native hooks stay for context injection, handoff on compact, and (later) security checks. See memory `2026-07-19_stop-hook-no-hitl-interference`.

Optional later: `beforeShellExecution` gate for `git push origin main`; `afterFileEdit` JSON/n8n validators; `beforeSubmitPrompt` secrets pattern check.

Shell git hooks and native hooks serve different layers: git hooks = commit time; native hooks = agent runtime.

### Repo-level git hook

| File | Purpose |
|------|---------|
| `git-hooks/prepare-commit-msg` | Remove `Co-authored-by: Cursor` from commit messages |

Separate from `.cursor/hooks/`; optional hygiene for teams that reject bot co-authorship.

---

## Agents and commands (Cursor-native)

### Agents (`.cursor/agents/` - 13)

Cursor subagent definitions. Consumed via Task tool / Agents Window. Full classification in [coherence-inventory.md](coherence-inventory.md).

### Commands (`.cursor/commands/` - 10)

Slash commands in Cursor:

| Command | Spine |
|---------|-------|
| `/continue-plan` | Handoff resume |
| `/handoff` | Save HANDOFF |
| `/run-plan-loop`, `/run-plan-orchestrated` | Continuous loop / worker delegation (no `/git-prod`) |
| `/git-staging`, `/git-prod` | DevOps spine |
| `/start-project` | Bootstrap (two HITL gates) |
| `/context-status` | Context pack status |
| `/summary`, `/tips` | UX helpers |

Commands are **Cursor-only**. VS Code/Windsurf have no equivalent slash-command files; parity relies on `AGENTS.md` and IDE-specific instruction files.

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

Still open dogfood gaps:

2. Include root `AGENTS.md` (cross-IDE contract)
3. Auto-install git hooks on clone (documented manual copy)
4. Ship `mcp.json` for optional MCP servers

Acceptable for private SoT until Phase B registry cutover defines minimum dogfood before public sync.

---

## Action items

| ID | Status | Action |
|----|--------|--------|
| A1 | ✅ Done | Fix `ux-tone.mdc` frontmatter |
| A2 | ✅ Done | Refresh [coherence-inventory.md](coherence-inventory.md) + [drift-inventory.md](drift-inventory.md) (2026-07-19) |
| A3 | ✅ Done | `.cursor/hooks.json` + agent scripts (`sessionStart` / `preCompact`) |
| A4 | Open | Align CLI git-hooks with `.cursor/hooks/pre-commit/` chain |
| A5 | Open | Add root `AGENTS.md` to agent-kit repo (dogfood) |
| A6 | Open | Document Marketplace plugin path + VS Code/Windsurf install |
| A7 | Open | Expand generators or template files for multi-IDE parity |

---

## References

- [Cursor 3.0 Features](cursor-3-features.md)
- [Coherence inventory](coherence-inventory.md)
- Decision: structural harness vs stack (maintainers' decision log, private repo)
