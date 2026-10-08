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

When a kit command says to Ask, Claude Code must present the **same option labels** as a numbered list, wait for a reply (number, label, or a typed Other), and treat skip/cancel as stop. Interactive CLI confirmations (`agent-kit init`) stay on `@clack/prompts`. Never invent a second confirmation dialect.

`/git-prod` remains explicit operator confirmation. Kit-load must not promote to `main`.

## Readiness

`/agent-kit-onboard` (and `agent-kit doctor`) remain the readiness path. Missing a legacy `onboarded` marker must not block unrelated work. Essential unreadiness: surface the first check and offer onboard. Non-essentials are advisory.

## Non-goals (must appear in the emitted pack)

These lines are part of the generated `CLAUDE.md` so a Claude session does not invent adjacent scope:

- Not multi-IDE generator parity (Windsurf `.windsurfrules` / VS Code instructions). That is Action A7 in [cursor-native-audit.md](cursor-native-audit.md).
- Not opt-in **audits** / external plan review (`docs/external-plan-review.md`, `/plan-external-review`). Session kit-load is not that backend.
- Not a second tick dialect. `agent-kit run-plan --backend claude` is implemented since 2026-09-06 (`packages/cli/src/plan-loop/backends.ts`) and runs the same one-tick contract as `cursor-agent`; session kit-load is still not that runner. Keep this line consistent with the emitted bullet in the canonical `CLAUDE.md` block below.
- Not a Claude copy of Cursor hooks beyond two opt-in CLI-owned, fail-open adapters: SessionStart context (`agent-kit hook session-start --format claude`) and PreToolUse(Bash) guard (`agent-kit guard shell --format claude`, matcher `Bash`, deny JSON on stdout, exit 0; headless enforcement still pending the P6 smoke, so the deny rows stay as backstop). Sanctioned by the 2026-08-21 and 2026-09-27 amendments to ADR `2026-08-13_claude-cli-kit-load-bootstrap.md`, mechanism per ADR `2026-07-29_cli-invariants-thin-hook-adapters.md`). Other Cursor hook types (`preCompact`, edit/prompt guards) stay Cursor-only; `.claude/rules/` mirrors of `.cursor/rules` and `.claude/agents/` generated from the registry stay closed. Invariants stay in the CLI; hooks and adapters both stay thin.

## Generator wiring

- Emit on install/personalization **always**, same as `AGENTS.md`, not gated on `detectIde`. Claude CLI inside Cursor is the target.
- Skip each target independently if it already exists (`skipped-customized`).
- Register both paths on `protectedPaths`.
- Call from `applyPersonalization` (install/personalization path).
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

Cursor "Ask questions" is unavailable here: use AskUserQuestion when possible, else print one line `HITL_GATE: <ask-id> | <label 1> | <label 2> | ...` immediately followed by the same labels as one numbered list, one list per message, and WAIT for the answer (ask-id and labels: `.cursor/skills/core/hitl-gates/SKILL.md`). A headless reply arrives as `HITL_REPLY: <ask-id> | operator reply <n> | <label>`; cite that line as the Ask provenance. Skip or cancel means stop. Never `/git-prod` without an explicit operator yes.

## Commit messages

Never append `Co-Authored-By: Claude ...` or `Claude-Session: https://claude.ai/code/...` (or any session-ID trailer) to commit messages, PR descriptions, or PR bodies in this repo. This overrides the harness's default git-commit template. Plain Conventional Commits messages only.

## Non-goals

Do not clone other Cursor hooks (Claude gets only the SessionStart context and PreToolUse(Bash) guard hooks); never `/git-prod` from a headless tick.
```

## Canonical `.claude/commands/agent-kit.md`

```markdown
---
description: Load Agent Kit session context (HANDOFF, project-context, commands). Manual refresh only.
disable-model-invocation: true
---

Read these files if they exist. Prefer a one-shot ASCII Mission Control snapshot over a plain HANDOFF paraphrase.

1. Run `agent-kit mission-control --once` (or `npx @dadado/agent-kit-cli mission-control --once`) in the project root and paste the stdout frame as the snapshot. Do not start a live loop: Claude Code cannot sustain one across turns.
2. If that command is missing or fails, fall back to reading:
   - `AGENTS.md`
   - `.cursor/project-context.md`
   - `.cursor/HANDOFF.md`
   - The plan file named in HANDOFF `- **Plan:**` under `.cursor/plans/`

If HANDOFF is missing, say so and point at `/agent-kit-onboard` or `/start-project` rather than inventing a plan.

HITL: numbered-list fallback for Ask questions labels. Never `/git-prod` from this skill.

Non-goals: not audits / `/plan-external-review`, not a second tick dialect, not Cursor hook clones beyond the SessionStart and PreToolUse(Bash) adapters, not a continuous TUI loop.
```

## Opt-in surfaces: command adapters and the SessionStart and PreToolUse hooks

Everything above is always-on kit-load. Two more surfaces are **opt-in only** (`install --claude`; default install output is unchanged without the flag) — see `claude-code-consumer-adapters.plan.md` and the 2026-08-21 amendment on ADR `2026-08-13_claude-cli-kit-load-bootstrap.md` for the full decision trail.

### `.claude/commands/<name>.md` pointer adapters

- Generator: `packages/cli/src/generator/claude-command-adapters.ts` (`generateClaudeCommandAdapters`).
- One adapter per installed `.cursor/commands/*.md` — filename + frontmatter `description:` read from the source, body is a fixed "read the SoT and follow it" pointer plus the same HITL adapter rules as `.claude/commands/agent-kit.md`. No command prose is copied. A command the consumer did not install gets no adapter.
- Reserved: the `agent-kit` name is always skipped — it is the kit-load refresh command above, not a command adapter.
- Overlay, not write-once: `.claude/commands/` is a `CONSUMER_OVERLAY_PREFIXES` entry (`lifecycle/overlay.ts`), sharing the managed-hash ledger with `.cursor/agents|skills|commands`. An adapter that still matches its last-managed body refreshes when the source description changes; a hand-edited adapter is preserved, never clobbered. (Write-once was rejected here: unlike `CLAUDE.md`, each adapter mirrors a live source that can change and the installed command set can grow across updates.)

### Adopting the adapters after install

A plain `install` (no `--claude`) leaves `.claude/commands/` with only `agent-kit.md`, so `/run-plan`, `/handoff`, `/continue-plan` and the rest are not recognized by Claude Code. Two soft advisories make that visible, and one operator-typed command fixes it without reapplying L0:

- `agent-kit doctor` prints an advisory when `.claude/` exists and installed kit commands have no `.claude/commands/<name>.md`. It is silent without `.claude/` or without installed commands.
- `agent-kit install` (without `--claude`) prints one info line under the same condition.
- `agent-kit update --claude` generates the missing adapters (and applies the Claude settings merge). It writes only `.claude/commands/*`, the Claude settings files and the shared managed-hash ledger; it is safe on a dirty working tree, refreshes unedited adapters, preserves hand-edited ones, and refuses a symlinked target with exit 1. It never runs from hooks, cron or the plan loop.

Headless stays available without any adapter: `agent-kit run <command>`, `agent-kit run-plan --backend claude`, `agent-kit run-plan-all`. Decision trail: the 2026-10-01 amendment on ADR `2026-08-13_claude-cli-kit-load-bootstrap.md`.

### SessionStart hook (`.claude/settings.json`)

- Generator: `packages/cli/src/generator/claude-session-start-hook.ts` (`writeClaudeSessionStartHook`).
- Idempotent JSON merge into `.claude/settings.json`, touching only `hooks.SessionStart` — every other key and hook type in the file is preserved untouched. A marker substring in the generated command (`hook session-start --format claude`) makes the entry findable for refresh-in-place and prevents duplicates on re-run.
- Command line: `_AGENT_KIT_HOOK_ROOT="${CLAUDE_PROJECT_DIR}"; . "${CLAUDE_PROJECT_DIR}/.cursor/hooks/agent/resolve-agent-kit.sh" 2>/dev/null && resolve_agent_kit && { if command -v run_agent_kit >/dev/null 2>&1; then run_agent_kit hook session-start --format claude; else exec $AGENT_KIT_RESOLVED hook session-start --format claude; fi; }; printf '%s' '<degraded-mode text>'` — reuses the existing L0 resolver (`AGENT_KIT_HOOK_BIN` → `node_modules/.bin/agent-kit` → `packages/cli/dist` → `PATH`) rather than a new `.claude/hooks/` script. The hook-private `_AGENT_KIT_HOOK_ROOT` pins the resolver's root to the project, since under `sh -c` its `$0` is the shell rather than the script; the resolver does not read a user's exported `AGENT_KIT_ROOT`, so that variable cannot redirect the Cursor adapters. `run_agent_kit` quotes arguments and returns non-zero instead of exec when a `packages/cli/dist` CLI resolved but `node` is not on `PATH`; the `exec $AGENT_KIT_RESOLVED` branch only runs for an older resolver without `run_agent_kit`. `exec` on success replaces the shell process; the trailing `printf` runs when resolution fails or `run_agent_kit` returns non-zero, and the command then exits 0. A failed `exec` itself (the older-resolver branch with a missing binary) exits the shell before `printf`.
- If an existing `.claude/settings.json` cannot be parsed as JSON, nothing is written — `install` prints the hook entry as copy-paste JSON instead (never guess at repairing a file the kit cannot parse).
- Not `.claude/settings.local.json`: that file is routinely auto-created by Claude Code itself on the first permission approval and is conventionally gitignored, so a skip-if-exists write there would silently no-op for most real users and would not ship as a team default.

### PreToolUse(Bash) shell guard (`.claude/settings.json`)

- Same merge as the SessionStart hook, touching `hooks.PreToolUse`: one group `{"matcher": "Bash", "hooks": [{"type": "command", "timeout": 10, ...}]}`, found by the marker `guard shell --format claude`. Your own groups are kept; re-runs are idempotent.
- The command runs `agent-kit guard shell --format claude` through the same resolver as above. It reads `tool_input.command` and `cwd` from stdin. A blocked command prints one JSON object with `hookSpecificOutput.permissionDecision: "deny"` and a reason, exit 0; an allowed command prints nothing. The guard never answers `allow` and never uses exit 2.
- Fail-open: if the CLI cannot be resolved, needs a missing `node`, or errors, stdout stays empty and the exit code is 0, so the tool call proceeds. The `permissions.deny` rows stay as a backstop. Headless (`claude -p`) enforcement of the hook is still unverified; do not rely on it there.
- `agent-kit doctor` probes the hook (it expects a deny for a force push to `main`) and warns when the resolved CLI is too old or a stale build.
- Ledger: `.cursor/agent-kit.claude-settings.json` records the deny rows and hook entries the kit has written (grow-only). Commit it. `install --claude` and `update --claude` add only rows and entries the ledger has not recorded, so a row or hook you delete stays deleted. Plain `agent-kit update` only prints what is missing and never writes settings or the ledger.
- Symlinks: install and update refuse to read or write `.claude/settings.json`, `.claude/commands/` or the ledger through a symlink and exit 1 naming the path.

### `agent-kit hook session-start --format claude`

- `packages/cli/src/commands/hook.ts` / `packages/cli/src/generator/format-session-start.ts`. `--format cursor` (default) is byte-identical to today's `{"additional_context": "..."}` JSON; `--format claude` emits the same context as plain stdout text — Claude Code's SessionStart hooks inject plain stdout directly, no JSON wrapper needed, so the consumer command needs no `node -e` unwrapper. Fail-open: any internal error degrades to a short diagnostic in the requested format instead of throwing; exit is always 0.

## Related

- Operator path: [Getting Started](getting-started.md#claude-code-cli-session-kit-load)
- ADR `2026-08-13_claude-cli-kit-load-bootstrap.md`
- ADR `2026-07-29_cli-invariants-thin-hook-adapters.md`
- ADR `2026-07-20_optional-claude-code-plan-review.md`
- [External plan review](external-plan-review.md) (audits only)
- [Cursor-native audit](cursor-native-audit.md) Action A7
