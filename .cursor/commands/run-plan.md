# Command: /run-plan

## Goal

Run the **active plan** continuously until it is done or blocked. One command; the agent picks the execution strategy. The user should not have to choose between "loop" and "orchestrated": hit `/run-plan` and follow the plan panel.

**Never** `/git-prod` in this mode; production only with explicit confirmation (HITL).

## Strategy selection (automatic)

| Condition | Strategy |
|-----------|----------|
| Task / subagent support available (e.g. Cursor) | **Orchestrated** (default): thin main window dispatches workers; heavy work burns worker context, not the session |
| No Task support | **In-session loop**: the session agent implements each tick itself; warn the user the window will grow |
| Headless / CI / cron | **External runner** `agent-kit run-plan` (or `scripts/plan-loop.sh` wrapper): each tick is a fresh agent (see "Headless runner" below) |

Announce the chosen strategy in the first tick response. Do not ask the user to pick.

`/run-plan-loop` and `/run-plan-orchestrated` are **deprecated aliases**: they follow this command, forcing the in-session or orchestrated strategy respectively.

## When to Use

- The user asked for a continuous run / "run it to the end"
- They want automatic staging per to-do (1 topic ~= 1 MR)

Manual mode (`/continue-plan`) stays for one-phase-per-chat with a human gate between units.

## Precondition

- A plan exists in `.cursor/plans/` with to-dos in the frontmatter
- No plan: create one via `/start-project` / plan-routine **before** running; Agent Kit **starts from the plan**

## Continuous mode (override)

While `/run-plan` is active, it **overrides** the "1 phase = 1 chat / ask for a new conversation" rule. Still required:

1. Update the plan's to-dos on every state change (visible in the Cursor panel)
2. Update `.cursor/HANDOFF.md` at the end of **every** tick
3. Memory WRITE for non-obvious decisions/errors
4. Stop and ask on risk (prod, PII, ambiguous scope, secrets)

## Tick contract (all strategies)

### 1. Read state

- `.cursor/HANDOFF.md` (required)
- Active plan in `.cursor/plans/` (frontmatter `todos`)
- Context Pack `.cursor/context/current/` if it exists
- Memory CHECK if the phase touches a known error/decision

### 2. Choose the next to-do

Frontmatter order. Skip `completed` / `cancelled`. Mark the to-do `in_progress` in the plan **before** implementing or dispatching.

Optional per-to-do budget fields (`read_scope`, `worker_contract`, `max_ticks`, `worker_type`; see `autogit/plan-routine.md` section 6) apply in every strategy. If `max_ticks` is reached on a to-do: HANDOFF + ask for a new conversation, even mid-run. `max_ticks` exceeded does **not** authorize `/git-prod`.

**Stop (do not schedule the next tick) if:**

| Condition | Action |
|-----------|--------|
| Next to-do is an external **blocker** with no versionable workaround | HANDOFF + clear message; `/git-staging` only if there is a diff |
| All implementable to-dos are `completed` | Final HANDOFF; suggest `/git-prod` if staging is ahead of `main` |
| The user asked to stop | Do not reschedule |
| Diff requires a human decision (scope, prod risk, PII) | Pause and ask, do not guess |

### 3. Execute only this to-do

Per strategy (below). Never stack the next to-do in the same tick. Keep hygiene: technical commits, no transient content in the repo.

### 4. Review + improvement (optional, if the plan has it)

| Prefix | What to do |
|--------|------------|
| `review-*` | Review deliverables: gaps, security, contracts vs docs. Findings go in the HANDOFF / memory if there is a tradeoff |
| `improvement-*` | Apply only objective improvements from the review. No cosmetic refactors |

If the review finds nothing: mark `improvement-*` as `completed` with a note in the HANDOFF and move on.

### 5. Close the tick: status + staging

1. Mark the tick's to-do as `completed` in the plan's frontmatter
2. Update `.cursor/HANDOFF.md` (include `Mode: run-plan (<strategy>)`)
3. If `git status` has commitable changes **and** it is not just a trivial HANDOFF/memory update: run the `/git-staging` routine **without asking for confirmation** (authorized by this command); 1 MR/PR -> staging branch -> merge
4. No commitable diff: just HANDOFF + plan status

### 6. Reschedule or stop

- Implementable to-dos remain: schedule the next tick (Loop skill / short delay) with the wake prompt below
- In-session loop with a bloating window, or orchestrated with a bloated main window: HANDOFF + ask for a new conversation with `/continue-plan` or `/run-plan`
- Stopped (blocker / done / user stop): **do not** reschedule; report the reason

## Orchestrated strategy (default)

The main window is a **thin orchestrator**: it reads state, dispatches, reviews, writes the HANDOFF, and runs staging. It does **not** implement code or dump diffs/logs.

| Role | Does | Does not |
|------|------|----------|
| **Orchestrator** (main window) | Picks the to-do; marks `in_progress`; dispatches worker; reviews summary; marks `completed`; HANDOFF; `/git-staging` if there is a diff | Implement code; dump diffs/logs; `/git-prod` |
| **Worker** (Task) | Executes **only** the to-do; respects `read_scope` if it exists; returns the summary contract | Ask the user for `/continue-plan`; `/git-prod`; stack the next to-do |

### Worker routing table

Resolve `subagent_type` in this order: explicit `worker_type` on the to-do, else the signal match below, else `generalPurpose`.

| Signal (to-do content / paths) | Prefer `subagent_type` |
|--------------------------------|------------------------|
| Docs / README / ADR / `docs/` | `docs-repo` |
| Large refactor / deslop / clean-code | `cleancode-refactor` |
| Security audit / auth / PII | `security-reviewer` |
| Explore / map codebase (read-only) | `explore` |
| Shell-heavy (scripts, git plumbing, CI) | `shell` |
| n8n workflows | `n8n-workflows` |
| Postgres / SQL schema | `sql-schema` |
| ClickUp tasks (only if project uses it) | `clickup-tasks` |
| Tech decision / ADR tradeoff | `tech-lead` |
| Memory batch / dedupe | `memory-extractor` |
| Default implement | `generalPurpose` |
| Git promote as **sole** to-do | Main window, or `git-autogit` only if isolation is wanted. **Never** Task for `/git-prod` HITL |

**Fallback:** if the preferred domain agent is **not** installed in this repo, use `generalPurpose` and tell the worker which **skill** to follow (path under `.cursor/skills/` or `registry/skills/`). Do not invent a `subagent_type`.

### Worker prompt template

Self-contained; the worker does **not** inherit the main window's transcript.

```text
You are an Agent Kit worker. Execute ONLY the to-do below and stop.

Repo: <path>
Plan: .cursor/plans/<file>
HANDOFF (summary): <phase / next>
To-do id: <id>
To-do: <content>
worker_type / subagent_type: <name>
skill fallback (if any): <path or "none">
read_scope (if any): <globs, read only what is necessary outside this>
max_ticks for this to-do (if any): <N>

Rules:
- Implement only this to-do; do not stack the next one
- Update the plan's frontmatter status (in_progress -> completed) if the orchestrator has not done it
- Hygiene: technical commits/docs; no transient content
- Never /git-prod
- Do not ask the user for /continue-plan

Return ONLY the summary contract (no diff/log dump):
## Worker summary
- Todo: <id>
- Changed: <paths or "none">
- Gaps: <none | short list>
- Staging ready: yes|no
- Notes: <1-2 optional sentences>
```

Prefer `run_in_background: false` so the orchestrator reviews the return in the same tick.

### Review the return

- Does the summary match the format? Any blocking gaps?
- Worker failed or went out of scope: fix with **one** focused re-dispatch, or pause and ask; do not implement in the main window
- Thin orchestrator invariant: if the main window starts editing feature code, that is wrong; dispatch again or degrade to the in-session loop

## In-session loop strategy (fallback)

Used when Task / subagents are not available. The session agent implements each tick itself; the window grows each tick (accepted cost, tell the user once). Everything else follows the tick contract above.

## Wake prompt (next tick in the same session)

```text
/run-plan - next tick. Read HANDOFF + plan. Mark the next to-do in_progress. Orchestrated: dispatch a worker (Task), do NOT implement in the main window. No Task: implement in-session. On close: completed in the plan + HANDOFF + git staging if there is a diff. Stop on external blocker or exhausted plan. Do not ask the user for /continue-plan. Never git prod.
```

## Response to the user (per tick)

Short, trackable:

> Run [strategy]: [to-do id]. Done: .... Plan: [N completed / total]. Staging: [PR #N / no diff]. Next: ... | **Stopped:** [reason]

## Stop

User: "stop" / "stop the run" -> do not reschedule; HANDOFF with current state.

## Headless runner (`agent-kit run-plan`)

For CI / cron / terminal runs. Canonical entrypoint: **`agent-kit run-plan`** (TypeScript CLI). `scripts/plan-loop.sh` is a thin wrapper that forwards to the CLI. Each tick runs in a **fresh headless agent** (clean context window); rescheduling is done by the runner, not the session:

- **Do not** use the Loop skill / do not reschedule internally; execute one to-do and finish.
- End the response with exactly one line: `LOOP_TICK_RESULT: continue` or `LOOP_TICK_RESULT: stop - <reason>`.
- Everything else in the tick contract applies: one to-do per tick, plan status, HANDOFF, `/git-staging` if there is a diff, **never** `/git-prod`.
- Stop mid-run: `touch .cursor/loop.stop` or Ctrl+C.
- Options: `--max-ticks N`, `--model M`, `--sleep S`, `--backend cursor-agent|claude`, `--dry-run`. Default backend is `cursor-agent` (`claude` reserved for a later wiring).

## HITL (invariants)

- `/git-prod` **never** from this command, any strategy
- Risk (PII, secrets, ambiguous scope): stop and ask
- Human gate between phases only in manual mode (`/continue-plan`); `/run-plan` is the explicit opt-out
