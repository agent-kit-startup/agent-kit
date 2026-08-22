# Claude CLI kit-load pack

Thin markdown adapters so Claude Code CLI (including a session started in Cursor's terminal) can load Agent Kit / Mission Control context without rediscovering the repository. Cursor agents already receive that context via `sessionStart` and always-apply rules. Claude does not.

**Decision:** ADR `.cursor/memory/decisions/2026-08-13_claude-cli-kit-load-bootstrap.md` (thin auto-load `CLAUDE.md` plus manual `/agent-kit` refresh), amended 2026-08-21 to sanction two further opt-in surfaces: a CLI-emitted SessionStart context hook and generated `.claude/commands/*.md` pointer adapters (see `claude-code-consumer-adapters.plan.md`; delivery details for those surfaces live outside this always-on kit-load pack).

This page is the pack contract. The generator in `packages/cli/src/generator/` must emit the snippets below (skip if the target already exists). Docs here are indicative; delivery truth is generator output plus tests.

## Surfaces

| File | Role | Load behavior |
|------|------|----------------|
| `CLAUDE.md` (repository root) | Always-on pointers | Claude Code loads this every session. Keep short. Scanner already treats this path as agent guidance. |
| `.claude/commands/agent-kit.md` | Slash `/agent-kit` | Manual refresh. Frontmatter `disable-model-invocation: true` so it does not auto-inject a second copy of the same pack. |

Do not emit `.claude/CLAUDE.md` as the primary file: the scanner only lists root `CLAUDE.md`.

## Shared SoT (read these; do not duplicate)

The pack points at existing files. It does not copy Cursor rules, hooks, or slash commands into a Claude dialect.

| Pointer | Why |
|---------|-----|
| `AGENTS.md` | Cross-IDE contract |
| `.cursor/project-context.md` | Derived repository facts |
| `.cursor/HANDOFF.md` | Active plan, queue, next to-do (gitignored session state; read when present) |
| `.cursor/commands/` | L0 slash command index (Cursor chat). In Claude Code, treat the filenames as the command catalog and follow the same HITL prose. |
| `.cursor/memory/decisions/` | Accepted tradeoffs |
| `autogit/gitupdate.md` | Staging to production spine |

Use backticked paths in `CLAUDE.md`. Do **not** use Claude `@path` imports for these files: imports expand at launch and would recreate Cursor always-on bulk.

## HITL in Claude Code

Cursor **Ask questions** is an IDE tool. Claude Code in the terminal does not have it.

When a kit command says to Ask, Claude Code must present the **same option labels** as a numbered list, wait for a reply (number, label, or a typed Other), and treat skip/cancel as stop. CLI wizards (`agent-kit init`) stay on `@clack/prompts`. Never invent a second confirmation dialect.

`/git-prod` remains explicit operator confirmation. Kit-load must not promote to `main`.

## Readiness

`/agent-kit-onboard` (and `agent-kit doctor`) remain the readiness path. Missing a legacy `onboarded` marker must not block unrelated work. Essential unreadiness: surface the first check and offer onboard. Non-essentials are advisory.

## Non-goals (must appear in the emitted pack)

These lines are part of the generated `CLAUDE.md` so a Claude session does not invent adjacent scope:

- Not multi-IDE generator parity (Windsurf `.windsurfrules` / VS Code instructions). That is Action A7 in [cursor-native-audit.md](cursor-native-audit.md).
- Not opt-in **audits** / external plan review (`docs/external-plan-review.md`, `/plan-external-review`). Session kit-load is not that backend.
- Not `agent-kit run-plan --backend claude` tick-runner parity (`packages/cli/src/plan-loop/backends.ts`).
- Not a Claude copy of Cursor hooks beyond the opt-in SessionStart context adapter (`agent-kit hook session-start --format claude`, CLI-owned, fail-open; sanctioned by the 2026-08-21 amendment to ADR `2026-08-13_claude-cli-kit-load-bootstrap.md`, mechanism per ADR `2026-07-29_cli-invariants-thin-hook-adapters.md`). Other Cursor hook types (`preCompact`, shell/edit/prompt guards) stay Cursor-only; `.claude/rules/` mirrors of `.cursor/rules` and `.claude/agents/` generated from the registry stay closed. Invariants stay in the CLI; hooks and adapters both stay thin.

## Generator wiring

- Emit on install/personalization **always**, same as `AGENTS.md`, not gated on `detectIde`. Claude CLI inside Cursor is the target.
- Skip each target independently if it already exists (`skipped-customized`).
- Register both paths on `protectedPaths`.
- Call from `applyPersonalization` and from `generateFromProfile` (compat `init` path).
- Do not add `.claude/` to scanner `CONTEXT_PATHS`; root `CLAUDE.md` is enough for honesty.
- Factory dogfood: commit the same two files in this repository so a Claude Code session here loads the pack without running install.

## Canonical `CLAUDE.md`

```markdown
# Agent Kit (Claude Code)

This repository uses Agent Kit / Mission Control. Before rediscovering the tree, read the shared sources of truth (paths below are pointers; do not treat this file as a second rulebook).

## Read first

1. `AGENTS.md` - cross-IDE contract
2. `.cursor/project-context.md` - verified repository facts (derived; prefer code, tests, SHAs when docs conflict)
3. `.cursor/HANDOFF.md` - if present: active plan, next to-do, queue fields
4. `.cursor/commands/` - slash catalog (Cursor). Follow the same HITL contracts here.

Mid-session refresh: `/agent-kit`.

## HITL

Cursor Ask questions is not available in this CLI. When a command requires a choice, list the same labels as a numbered list and wait. Skip or cancel means stop. Never `/git-prod` without an explicit operator yes.

## Non-goals

- Not Action A7 (Windsurf / VS Code generator parity)
- Not Claude external plan-review audits (`/plan-external-review`)
- Not `--backend claude` plan-loop ticks
- Not a copy of Cursor hooks beyond the opt-in SessionStart context adapter (`agent-kit hook session-start --format claude`); no `.claude/rules/` mirrors, no `.claude/agents/` generated from the registry
```

## Canonical `.claude/commands/agent-kit.md`

```markdown
---
description: Load Agent Kit session context (HANDOFF, project-context, commands). Manual refresh only.
disable-model-invocation: true
---

Read these files if they exist, then summarize the active plan, next to-do, and any Gaps. Do not scan the whole repository first.

1. `AGENTS.md`
2. `.cursor/project-context.md`
3. `.cursor/HANDOFF.md`
4. The plan file named in HANDOFF `- **Plan:**` under `.cursor/plans/`

If HANDOFF is missing, say so and point at `/agent-kit-onboard` or `/start-project` rather than inventing a plan.

HITL: numbered-list fallback for Ask questions labels. Never `/git-prod` from this skill.

Non-goals: not audits / `/plan-external-review`, not `--backend claude` ticks, not A7, not Cursor hook clones.
```

## Opt-in surfaces: command adapters and the SessionStart hook

Everything above is always-on kit-load. Two more surfaces are **opt-in only** (`install --claude`; default install output is unchanged without the flag) — see `claude-code-consumer-adapters.plan.md` and the 2026-08-21 amendment on ADR `2026-08-13_claude-cli-kit-load-bootstrap.md` for the full decision trail.

### `.claude/commands/<name>.md` pointer adapters

- Generator: `packages/cli/src/generator/claude-command-adapters.ts` (`generateClaudeCommandAdapters`).
- One adapter per installed `.cursor/commands/*.md` — filename + frontmatter `description:` read from the source, body is a fixed "read the SoT and follow it" pointer plus the same HITL adapter rules as `.claude/commands/agent-kit.md`. No command prose is copied. A command the consumer did not install gets no adapter.
- Reserved: the `agent-kit` name is always skipped — it is the kit-load refresh command above, not a command adapter.
- Overlay, not write-once: `.claude/commands/` is a `CONSUMER_OVERLAY_PREFIXES` entry (`lifecycle/overlay.ts`), sharing the managed-hash ledger with `.cursor/agents|skills|commands`. An adapter that still matches its last-managed body refreshes when the source description changes; a hand-edited adapter is preserved, never clobbered. (Write-once was rejected here: unlike `CLAUDE.md`, each adapter mirrors a live source that can change and the installed command set can grow across updates.)

### SessionStart hook (`.claude/settings.json`)

- Generator: `packages/cli/src/generator/claude-session-start-hook.ts` (`writeClaudeSessionStartHook`).
- Idempotent JSON merge into `.claude/settings.json`, touching only `hooks.SessionStart` — every other key and hook type in the file is preserved untouched. A marker substring in the generated command (`hook session-start --format claude`) makes the entry findable for refresh-in-place and prevents duplicates on re-run.
- Command line: `. "${CLAUDE_PROJECT_DIR}/.cursor/hooks/agent/resolve-agent-kit.sh" 2>/dev/null && resolve_agent_kit && exec $AGENT_KIT_RESOLVED hook session-start --format claude; printf '%s' '<degraded-mode text>'` — reuses the existing L0 resolver (env override → PATH → `node_modules/.bin/agent-kit` → factory dist fallback) rather than a new `.claude/hooks/` script. `exec` on success replaces the shell process; the trailing `printf` only runs when resolution or exec itself fails, so the command's own exit status is always 0.
- If an existing `.claude/settings.json` cannot be parsed as JSON, nothing is written — `install` prints the hook entry as copy-paste JSON instead (never guess at repairing a file the kit cannot parse).
- Not `.claude/settings.local.json`: that file is routinely auto-created by Claude Code itself on the first permission approval and is conventionally gitignored, so a skip-if-exists write there would silently no-op for most real users and would not ship as a team default.

### `agent-kit hook session-start --format claude`

- `packages/cli/src/commands/hook.ts` / `packages/cli/src/generator/format-session-start.ts`. `--format cursor` (default) is byte-identical to today's `{"additional_context": "..."}` JSON; `--format claude` emits the same context as plain stdout text — Claude Code's SessionStart hooks inject plain stdout directly, no JSON wrapper needed, so the consumer command needs no `node -e` unwrapper. Fail-open: any internal error degrades to a short diagnostic in the requested format instead of throwing; exit is always 0.

## Related

- Operator path: [Getting Started](getting-started.md#claude-code-cli-session-kit-load)
- ADR `2026-08-13_claude-cli-kit-load-bootstrap.md`
- ADR `2026-07-29_cli-invariants-thin-hook-adapters.md`
- ADR `2026-07-20_optional-claude-code-plan-review.md`
- [External plan review](external-plan-review.md) (audits only)
- [Cursor-native audit](cursor-native-audit.md) Action A7
