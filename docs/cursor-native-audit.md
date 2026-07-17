# Cursor-native audit — Agent Kit harness

Audit of Cursor-specific artifacts in the Agent Kit repository: what exists, what is missing, and how VS Code and Windsurf compare. Output of plan to-do `f0-audit-native`.

## Summary

| Area | Status | Notes |
|------|--------|-------|
| `.cursor/rules/` | Present (23 files) | 7 core rules `alwaysApply: true`; stack rules use globs |
| `.cursor/skills/` | Present (7 skills) | Partial overlap with `registry/skills/` |
| `.cursor/agents/` | Present (13 agents) | Mix of core and stack subagents |
| `.cursor/commands/` | Present (9 commands) | DevOps spine + handoff commands |
| `.cursor/hooks/` (shell) | Present | Git pre-commit + edit validators; not wired to Cursor agent events |
| `.cursor/hooks.json` | **Absent** | Native Cursor hook manifest not versioned |
| `.cursor-plugin/plugin.json` | Present | Metadata only; no bundled rules/skills manifest |
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

**Gap:** Plugin packaging and Marketplace submission flow are not documented end-to-end in `docs/getting-started.md`. Fase 3 covers install paths.

---

## Rules — modes and coverage

**Location:** `.cursor/rules/*.mdc` (23 files)

### alwaysApply: true (core — structural)

These run on every agent turn in Cursor:

| Rule | Role |
|------|------|
| `agent-output-hygiene.mdc` | Chat ≠ repo; no metalinguagem in artifacts |
| `context-guardian.mdc` | Context window warning + handoff trigger |
| `cursor-plan-handoff.mdc` | Plan phases, HANDOFF.md, `/continuar-plano` |
| `cursor-skills-general.mdc` | General coding + git flow conventions |
| `cursor-skills-git-workflow.mdc` | Staging → prod spine; blocks direct main |
| `docs-professional-standard.mdc` | Herdável docs standard |
| `memory-loop.mdc` | `.cursor/memory/` errors and decisions |

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

### Anomaly

| Rule | Issue |
|------|-------|
| `ux-tone.mdc` | **No YAML frontmatter** — no `alwaysApply` or `globs`. Cursor may not load it consistently. Should get `alwaysApply: true` (core, chat-only scope) in Fase 1 coherence. |

### Rule-mode compliance vs tese

- Stack/product rules (ClickUp, n8n) correctly use `alwaysApply: false` per decision `2026-07-09_structural-harness-vs-stack`.
- Language CURSOR-SKILLS rules are stack-on-demand via globs — acceptable for dev ergonomics; not structural core.
- CLI generator (`packages/cli/src/generator/cursor.ts`) produces a **minimal** rule set (3–4 files) for new projects — does not copy the full 23-rule workspace. Intentional for Fase 2 Core Pack; document parity gap.

---

## Hooks — shell vs native

### Shell hooks (`.cursor/hooks/`)

| Path | Trigger | Class |
|------|---------|-------|
| `pre-commit/pre-commit` | Git pre-commit (manual install to `.git/hooks/`) | Core orchestrator |
| `pre-commit/check-secrets.sh` | Staged files | Core — security |
| `pre-commit/validate-all-json.sh` | Staged JSON | Core |
| `pre-edit/validate-json.sh` | Manual / legacy edit hook | Core |
| `post-edit/validate-n8n.sh` | n8n workflow edits | Stack |
| `lib/json-validator.js` | Shared | Core |
| `lib/n8n-checker.js` | Shared | Stack |

**Install model:** Documented copy-to-`.git/hooks/pre-commit`. CLI `generateGitHooks` writes a **simpler** secrets-only hook — not the full `.cursor/hooks/pre-commit/` chain.

### Native Cursor hooks (`.cursor/hooks.json`)

**Status: absent.**

Cursor agent events (e.g. `beforeShellExecution`, `afterFileEdit`, `beforeSubmitPrompt`) are not configured. See Cursor hooks schema (`version: 1`, event → command list).

**Recommended mapping (Fase 2 — after Fase 1 coherence):**

| Native event | Candidate script | Purpose |
|--------------|------------------|---------|
| `beforeShellExecution` | gate `git push origin main` | Enforce staging→prod spine |
| `afterFileEdit` | `validate-json.sh` / n8n validator | Post-edit validation by glob |
| `beforeSubmitPrompt` | secrets pattern check | Block prompts with obvious secrets |

Shell git hooks and native hooks serve different layers: git hooks = commit time; native hooks = agent runtime.

### Repo-level git hook

| File | Purpose |
|------|---------|
| `git-hooks/prepare-commit-msg` | Remove `Co-authored-by: Cursor` from commit messages |

Separate from `.cursor/hooks/`; optional hygiene for teams that reject bot co-authorship.

---

## Agents and commands (Cursor-native)

### Agents (`.cursor/agents/` — 13)

Cursor subagent definitions. Consumed via Task tool / Agents Window. Full classification in [coherence-inventory.md](coherence-inventory.md).

### Commands (`.cursor/commands/` — 9)

Slash commands in Cursor:

| Command | Spine |
|---------|-------|
| `/continuar-plano` | Handoff resume |
| `/handoff` | Save HANDOFF |
| `/git-staging`, `/git-homolog`, `/git-prod` | DevOps spine |
| `/iniciar-projeto` | Bootstrap |
| `/context-status` | Context pack status |
| `/resumo`, `/dicas` | UX helpers |

Commands are **Cursor-only**. VS Code/Windsurf have no equivalent slash-command files; parity relies on `AGENTS.md` and IDE-specific instruction files.

---

## CLI generators — multi-IDE parity

**Entry:** `packages/cli/src/generator/index.ts`

| IDE | Generator | Artifacts | Parity vs Cursor workspace |
|-----|-----------|-----------|----------------------------|
| Cursor | `cursor.ts` | `.cursor/rules/` (3–4 rules), optional agent, `/agent-kit-status` | Low — subset only |
| VS Code | `vscode.ts` | `.vscode/settings.json`, `.github/copilot-instructions.md`, optional `.agent.md` | Low — no handoff commands, no hooks |
| Windsurf | `windsurf.ts` | `.windsurfrules` (short bullet list) | Minimal |
| Cross-IDE | `agents-md.ts` | `AGENTS.md` | Medium — flow summary, no full rule corpus |
| Git | `git-hooks.ts` | `.git/hooks/pre-commit` (rg secrets) | Simpler than repo's `.cursor/hooks/` |

**Templates:** `templates/cursor/`, `templates/vscode/`, `templates/windsurf/` — README stubs only; generators inline strings, not template files.

---

## VS Code — gaps

| Cursor capability | VS Code equivalent | Agent Kit today |
|-------------------|-------------------|-----------------|
| `.cursor/rules/*.mdc` | Copilot instructions, `.github/copilot-instructions.md` | Generated minimal copilot-instructions |
| Slash commands | None native | Not portable — document manual prompts |
| Subagents / Task | Copilot custom agents (`.agent.md`, Pro) | One optional `security-review.agent.md` |
| HANDOFF + plans | `AGENTS.md` + repo files | Generated `AGENTS.md` only |
| Native hooks | None | N/A |
| MCP | VS Code MCP (when supported) | Not generated |
| `/worktree`, `/best-of-n` | N/A | Mentioned in generated AGENTS.md (Cursor-centric) |

**Gap priority:** Expand `AGENTS.md` generator with handoff spine and git flow; add Windsurf/VS Code docs mirroring `docs/cursor-3-features.md`.

---

## Windsurf — gaps

| Cursor capability | Windsurf equivalent | Agent Kit today |
|-------------------|---------------------|-----------------|
| Rules | `.windsurfrules` | Short generated file |
| Cascade modes | Windsurf-native | Not referenced in generator |
| Commands / agents | Limited | Not generated |
| HANDOFF | File-based (works) | Same as any IDE if user follows docs |

**Gap priority:** `.windsurfrules` should include handoff + git spine bullets; link to `AGENTS.md` for shared context.

---

## Dogfood gaps (this repository)

The Agent Kit repo uses the full Cursor workspace but does **not**:

1. Version `.cursor/hooks.json`
2. Include root `AGENTS.md` (cross-IDE contract)
3. Auto-install git hooks on clone (documented manual copy)
4. Ship `mcp.json` for optional MCP servers

These are acceptable for private SoT during Fase 0–1; Fase 2 Core Pack should decide minimum dogfood set before public sync.

---

## Action items (by phase)

| ID | Phase | Action |
|----|-------|--------|
| A1 | Fase 1 | Fix `ux-tone.mdc` frontmatter |
| A2 | Fase 1 | Complete [coherence-inventory.md](coherence-inventory.md) |
| A3 | Fase 2 | Design and add `.cursor/hooks.json` (native agent hooks) |
| A4 | Fase 2 | Align CLI git-hooks with `.cursor/hooks/pre-commit/` chain |
| A5 | Fase 2 | Add root `AGENTS.md` to agent-kit repo (dogfood) |
| A6 | Fase 3 | Document Marketplace plugin path + VS Code/Windsurf install |
| A7 | Fase 3 | Expand generators or template files for multi-IDE parity |

---

## References

- [Cursor 3.0 Features](cursor-3-features.md)
- [Coherence inventory](coherence-inventory.md)
- Plan: `.cursor/plans/agent_kit_public_harness.plan.md` — `f0-audit-native`, `f1-coherence-*`, `f2-hooks-native`
- Decision: `.cursor/memory/decisions/2026-07-09_structural-harness-vs-stack.md`
