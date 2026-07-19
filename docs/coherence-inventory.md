# Coherence inventory - rules, skills, hooks, agents, commands

Living inventory for internal coherence (`f6-coherence`). Classifies each artifact as **core** (structural harness), **stack** (on demand), **obsolete**, or **merge** (resolved).

**Checklist per artifact:** alwaysApply/globs · tese HITL · no transitório · nomenclatura · dedupe workspace ↔ registry.

**Status (2026-07-16):** Fase 6 pass complete for SoT. Registry is the skill SoT; workspace `.cursor/skills/{core,community}/` is install output from `agent-kit update`.

---

## Rules (`.cursor/rules/` - 23)

| File | Class | alwaysApply | Action |
|------|-------|-------------|--------|
| `agent-output-hygiene.mdc` | core | true | ✅ keep |
| `context-guardian.mdc` | core | true | ✅ keep |
| `cursor-plan-handoff.mdc` | core | true | ✅ keep (manual / loop / orquestrado) |
| `cursor-skills-general.mdc` | core | true | ✅ keep |
| `cursor-skills-git-workflow.mdc` | core | true | ✅ staging-first |
| `docs-professional-standard.mdc` | core | true | ✅ keep |
| `memory-loop.mdc` | core | true | ✅ keep (`globs: []` removed) |
| `ux-tone.mdc` | core | true | ✅ keep (chat only) |
| `cursor-skills-clickup.mdc` | stack | false | ✅ requestable; points at community skill |
| `cursor-skills-n8n.mdc` | stack | false | ✅ globs; skill path updated |
| `cursor-skills-api.mdc` | stack | false | ✅ keep |
| `cursor-skills-devops.mdc` | stack | false | ✅ keep |
| `cursor-skills-groovy.mdc` | stack | false | ✅ keep (community language) |
| `cursor-skills-integrations.mdc` | stack | false | ✅ keep |
| `cursor-skills-json.mdc` | stack | false | ✅ keep; pairs with `json-data-config` skill |
| `cursor-skills-mobile.mdc` | stack | false | ✅ keep |
| `cursor-skills-node.mdc` | stack | false | ✅ keep |
| `cursor-skills-php.mdc` | stack | false | ✅ keep |
| `cursor-skills-prompts.mdc` | stack | false | ✅ keep; pairs with `prompts-markdown` |
| `cursor-skills-python.mdc` | stack | false | ✅ keep |
| `cursor-skills-sql.mdc` | stack | false | ✅ keep; pairs with `sql-postgres` |
| `cursor-skills-testing.mdc` | stack | false | ✅ keep |
| `cursor-skills-webdesign.mdc` | stack | false | ✅ keep |

**Invariant:** no stack rule uses `alwaysApply: true`.

---

## Skills - registry SoT (`registry/skills/`)

| ID | Tier | Class | Notes |
|----|------|-------|-------|
| `clean-code` | core | core | Full body promoted from former `code-deslop`; alias in description |
| `docs-repo` | core | core | on demand |
| `git-workflow` | core | core | aligns with git-workflow rule |
| `ide-guide` | core | core | stub OK until expanded |
| `security-review` | core | core | pairs with security-reviewer agent |
| `clickup` | community | stack | full body from former `clickup-project-mgmt` |
| `jira` | community | stack | stub OK |
| `n8n-workflows` | community | stack | full body promoted |
| `sql-postgres` | community | stack | full body promoted |
| `json-data-config` | community | stack | **new** in registry (`f6`) |
| `prompts-markdown` | community | stack | **new** in registry (`f6`) |
| `ux-message-flows` | community | stack | **new** in registry (`f6`) |

Workspace layout after dogfood `update`: `.cursor/skills/core|community/<id>/SKILL.md` only - **no flat legacy dirs**.

---

## Hooks

| Path | Class | Action |
|------|-------|--------|
| `pre-commit/check-secrets.sh` | core | ✅ L0 + keep |
| `pre-commit/validate-all-json.sh` | core | ✅ keep |
| `pre-commit/pre-commit` | core | ✅ keep |
| `pre-edit/validate-json.sh` | core | ✅ keep |
| `post-edit/validate-n8n.sh` | stack | ✅ keep |
| `lib/json-validator.js` | core | ✅ keep |
| `lib/n8n-checker.js` | stack | ✅ keep |
| `.cursor/hooks.json` | core | ✅ present - sessionStart / preCompact (no stop follow-up) |
| `git-hooks/prepare-commit-msg` | core | ✅ documented via autogit |

---

## Agents (`.cursor/agents/` - 13)

Install path = pack/registry member, or dogfood-only / demoted (see [domain-packs.md](domain-packs.md)). Catalog label `core` ≠ L0 install layer.

| File | Catalog | Install path |
|------|---------|--------------|
| `git-autogit.md` | core (spine) | Dogfood-only; L0 = commands + `autogit/` |
| `docs-repo.md` | core | L1 `engenharia-arquitetura` (with docs-repo skill) |
| `cleancode-refactor.md` | core | L1 `clean-code` |
| `security-reviewer.md` | core | L1 `cybersec` |
| `context-librarian.md` | core | L1 `gestao-contexto` |
| `memory-extractor.md` | core | L1 `gestao-contexto` |
| `tech-lead.md` | core | L1 `engenharia-arquitetura` |
| `json-guardian.md` | stack | Demoted; prefer `json-data-config` skill |
| `prompts-agents.md` | stack | Demoted; prefer `prompts-markdown` skill |
| `n8n-workflows.md` | stack | Demoted; prefer `n8n-workflows` skill |
| `sql-schema.md` | stack | Demoted; prefer `sql-postgres` skill |
| `clickup-tasks.md` | stack | L1 `gestao-projeto` |
| `testes-roteiros.md` | stack | L1 `quality` |

---

## Commands (`.cursor/commands/`)

| File | Class | Action |
|------|-------|--------|
| `start-project.md` | core | ✅ keep |
| `continue-plan.md` | core | ✅ keep |
| `run-plan-loop.md` | core | ✅ L0; no prod |
| `run-plan-orchestrated.md` | core | ✅ L0; no prod |
| `handoff.md` | core | ✅ keep |
| `summary.md` | core | ✅ keep |
| `context-status.md` | core | ✅ keep (not L0 install list - project-local OK) |
| `git-staging.md` | core | ✅ L0 |
| `git-prod.md` | core | ✅ HITL confirmation |
| `tips.md` | core | ✅ optional UX |

---

## Autogit and docs

| Path | Class | Action |
|------|-------|--------|
| `autogit/gitupdate.md` | core | ✅ L0; staging → prod HITL |
| `autogit/plan-routine.md` | core | ✅ three modes + budget fields |
| `install.md` / `docs/bootstrap.md` | core | ✅ no nested folder copy |
| `docs/contribute-upstream.md` | core | ✅ `f5` return channel |
| `docs/CONTRIBUTING.md` | core | ✅ contribute gate link |
| `README.md` | core | ⏳ EN thesis polish → `f6-repo-publico` |

---

## Duplicate map - resolved (`f6`)

| Former A | Canonical B | Resolution |
|----------|-------------|------------|
| `.cursor/skills/code-deslop` | `registry/skills/core/clean-code` | Merged; workspace via install |
| `.cursor/skills/clickup-project-mgmt` | `registry/skills/community/clickup` | Merged |
| `.cursor/skills/n8n-workflows` (flat) | `registry/skills/community/n8n-workflows` | Merged |
| `.cursor/skills/sql-postgres` (flat) | `registry/skills/community/sql-postgres` | Merged |
| workspace-only json/prompts/ux skills | `registry/skills/community/*` | Promoted |

---

## Counts (after `f6`)

| Type | Total | core | stack | notes |
|------|-------|------|-------|-------|
| Rules | 23 | 8 | 15 | zero stack `alwaysApply: true` |
| Skills (registry) | 12 | 5 | 7 | SoT |
| Skills (workspace install) | 7 | 1 | 6 | dogfood manifest |
| Agents | 13 | 7 catalog-core | 6 stack | 8 pack-installable; 5 dogfood/demoted (see domain-packs) |
| Commands | 11 | 11 | 0 | - |

---

## Residual (not blocking)

1. **`.cursor/hooks.json`** - ✅ shipped (sessionStart / preCompact); optional later: shell gate for push to main, prompt secrets check.
2. **README EN thesis** - `f6-repo-publico` go/no-go.
3. **Stack language rules** (php/groovy/mobile/…) - keep as stack; no promotion to L0.
4. **`skills-registry.json` / `_legacy/v2`** - obsolete paths; do not resurrect flat skill ids.

Update this file when classifications change. Public sync still gated by `f6-repo-publico`.
