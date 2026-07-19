# Command: /run-plan-orchestrated

## Goal

Run the **active plan** with a **thin main window** (orchestrator) plus **workers** that implement. The main window does not write code; it only reads state, dispatches, reviews, writes the HANDOFF, and runs staging.

This solves what the loop does not: ticks in the same session **bloat** the window. Here the heavy work happens in the worker (fresh context); the main window only orchestrates.

**Never** `/git-prod` in this mode; production only with explicit confirmation (HITL).

## When to Use

- Long / multi-phase plans where the session window cannot accumulate implementation
- IDE with subagent/Task support (e.g. Cursor)
- Want automatic staging per to-do (1 topic ~= 1 MR), without the orchestrator cluttering the transcript

## Precondition

- A plan in `.cursor/plans/` with to-dos in the frontmatter
- No plan: create one via `/start-project` / plan-routine **first**

## Fallback (IDE without Task / subagents)

If the **Task** tool (or an equivalent worker mechanism) is **not available**:

1. Tell the user: *"Orchestrated mode needs workers. Without Task, degrading."*
2. Offer and follow one of these modes:
   - **`/run-plan-loop`** — cadence in the same session (accepts a growing window)
   - **`/continue-plan`** — manual, 1 phase ~= 1 chat
3. Do not fake orchestration by implementing in the main window.

An **external** headless orchestrator (`scripts/plan-loop.sh`) is another path: each tick is a fresh agent via shell. Do not mix it with this command (see `/run-plan-loop`, external orchestrator section).

## Roles

| Role | Does | Does not |
|------|------|----------|
| **Orchestrator** (main window) | Reads HANDOFF/plan; picks the to-do; marks `in_progress`; dispatches worker; reviews summary; marks `completed`; HANDOFF; `/git-staging` if there is a diff | Implement code; dump diffs/logs; `/git-prod` |
| **Worker** (Task) | Executes **only** the to-do; respects `read_scope` if it exists; returns the summary contract | Ask the user for `/continue-plan`; `/git-prod`; stack the next to-do |

## Tick (one orchestrator iteration)

### 1. Read state (main window)

- `.cursor/HANDOFF.md` (required)
- Active plan (frontmatter `todos`)
- Context Pack `.cursor/context/current/` if it exists
- Memory CHECK if the phase touches a known error/decision

### 2. Choose the next to-do

Frontmatter order. Skip `completed` / `cancelled` / continuous `dogfood-poc` unless it is this tick's focus.

Mark `in_progress` in the plan **before** dispatching.

**Stop (do not dispatch / do not reschedule) if:**

| Condition | Action |
|-----------|--------|
| External blocker with no versionable workaround | HANDOFF + message; staging only if there is a diff |
| Implementable to-dos exhausted | Final HANDOFF; suggest `/git-prod` if staging is ahead of `main` |
| The user asked to stop | Do not reschedule |
| Human decision needed (scope, PII, prod risk) | Pause and ask |

### 3. Dispatch the worker

Use the **Task** tool (or an equivalent subagent) with a **self-contained** prompt; the worker does **not** inherit the main window's transcript.

#### Worker routing table

Resolve `subagent_type` in this order:

1. Explicit `worker_type` on the to-do (see `autogit/plan-routine.md`)
2. Else match the to-do signal below
3. Else `generalPurpose`

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

Include in the prompt:

1. Repo path and plan path
2. A useful excerpt from the HANDOFF (phase, next to-do)
3. The to-do's `id` + `content`
4. If present in the to-do's frontmatter (`autogit/plan-routine.md` budget section): `read_scope`, `worker_contract`, `max_ticks`, `worker_type`
5. Chosen `subagent_type` and, on fallback, the skill path to follow
6. The output contract below
7. Rules: one to-do only; hygiene; never `/git-prod`; do not reschedule the loop

**Worker prompt template:**

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

Prefer `run_in_background: false` so the orchestrator can review the return in the same tick. Set Task `subagent_type` from the routing table (or `worker_type`); do not default every tick to `generalPurpose` when a clearer match exists.

### 4. Review the return (main window)

- Does the summary match the format? Any blocking gaps?
- If the worker failed or went out of scope: fix it with **one** focused re-dispatch, or pause and ask; do not implement in the main window
- Count ticks for this to-do; if `max_ticks` exists and is reached, HANDOFF + ask for a new conversation (`/continue-plan`), even in orchestrated mode

### 5. Close the tick: status + staging

1. Confirm the to-do is `completed` in the frontmatter
2. Update `.cursor/HANDOFF.md` (`Mode: orchestrated`)
3. If `git status` has a commitable diff (not just a trivial HANDOFF/memory update):
   - `/git-staging` **without asking for confirmation** (authorized by this mode)
4. Memory WRITE for non-obvious decisions/errors

### 6. Reschedule or stop

- Implementable to-dos remain and the main window is **not** bloated: next tick (dispatch again, or Loop skill with the wake prompt)
- Main window bloated / context critical: HANDOFF + ask for a new conversation with `/continue-plan` or `/run-plan-orchestrated`
- Stopped: report the reason; **do not** reschedule

## Wake prompt (next tick in the same session)

```text
/run-plan-orchestrated - next tick. Read HANDOFF + plan. Mark the next to-do in_progress. Dispatch a worker (Task) with a self-contained prompt; DO NOT implement in the main window. Review the summary; completed + HANDOFF + git staging if there is a diff. Stop on blocker or exhausted plan. No Task: degrade to loop or manual. Never git prod.
```

## Response to the user (per tick)

Short:

> Orch: [to-do id]. Worker: [1-line summary]. Plan: [N completed / total]. Staging: [PR #N / no diff]. Next: ... | **Stopped:** [reason]

## Stop

User: "stop the orchestrator" / "stop" -> do not reschedule; HANDOFF with current state.

## HITL (invariants)

- `/git-prod` **never** in this mode
- Risk (PII, secrets, ambiguous scope): stop and ask
- Thin orchestrator: if the main window starts editing feature code, that is wrong; dispatch again or degrade
