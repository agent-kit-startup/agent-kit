# Command: /run-plan-loop

## Goal

Run the **active plan** in a continuous loop within this session, without asking for `/continue-plan` or a new conversation between phases.

Each tick:
1. Reads state (HANDOFF + plan)
2. Executes **one** to-do (or the current phase's pair)
3. **Updates status** in the plan's frontmatter (`pending` -> `in_progress` -> `completed`) so the user can follow along in the plan panel
4. Updates `.cursor/HANDOFF.md`
5. If there is a commitable diff, runs **`/git-staging`** (authorized by the loop)
6. Schedules the next tick (Loop skill) or stops

**Never** `/git-prod` in the loop; production only with explicit confirmation (HITL).

## When to Use

- The user asked for a loop / continuous run / "run it to the end"
- They want automatic staging per phase (1 topic ~= 1 MR)

Manual mode (`/continue-plan`) is still valid outside the loop.

## Precondition

- A plan exists in `.cursor/plans/` with to-dos in the frontmatter
- No plan: create one via `/start-project` / plan-routine **before** entering the loop; Agent Kit **starts from the plan**

## Continuous mode (override)

While the loop is active, it **overrides** the "1 phase = 1 chat / ask for a new conversation" rule. Still required:

1. Update the plan's to-dos on every state change (visible in the Cursor panel)
2. Update `.cursor/HANDOFF.md` at the end of **every** tick/phase
3. Memory WRITE for non-obvious decisions/errors
4. Stop and ask on risk (prod, PII, ambiguous scope, secrets)

## Tick (one iteration)

### 1. Read state

- `.cursor/HANDOFF.md` (required)
- Active plan in `.cursor/plans/` (frontmatter `todos`)
- Context Pack `.cursor/context/current/` if it exists
- Memory CHECK if the phase touches a known error/decision

### 2. Choose the next to-do

Frontmatter order. Skip `completed` / `cancelled`.

Optional per-to-do fields (budget, see `autogit/plan-routine.md` section 6): if `max_ticks` exists and is reached on this to-do, HANDOFF and ask for a new conversation, even in loop mode.

When chosen: mark the to-do as `in_progress` in the plan **before** implementing (the user sees the status change).

**Stop the loop (do not schedule the next wake) if:**

| Condition | Action |
|-----------|--------|
| Next to-do is an external **blocker** with no versionable workaround | HANDOFF + clear message; `git staging` only if there is a diff |
| All implementable to-dos are `completed` | Final HANDOFF; suggest `/git-prod` if staging is ahead of `main` |
| The user asked to stop / "stop the loop" | Do not reschedule |
| Diff requires a human decision (scope, prod risk, PII) | Pause and ask, do not guess |

### 3. Execute only this to-do / phase

- Do not stack the next phase in the same tick
- Follow the repo's skills/rules
- Keep hygiene: technical commits, no transient content in the repo

### 4. Review + improvement (optional, if the plan has it)

| Prefix | What to do |
|--------|------------|
| `review-*` | Review deliverables: gaps, security, contracts vs docs. Findings go in the HANDOFF / memory if there is a tradeoff |
| `improvement-*` | Apply only objective improvements from the review. No cosmetic refactors |

If the review finds nothing: mark `improvement-*` as `completed` with a note in the HANDOFF and move on.

### 5. Close the tick: status + staging

1. Mark the tick's to-do(s) as `completed` in the plan's frontmatter
2. Update `.cursor/HANDOFF.md` (include `Mode: continuous-loop`)
3. If `git status` has commitable changes **and** it is not just a trivial HANDOFF/memory update:
   - Run the `/git-staging` routine **without asking for confirmation** (authorized by the loop)
   - 1 MR/PR -> staging branch -> merge
4. No commitable diff: just HANDOFF + plan status

### 6. Reschedule or stop

- There is still an implementable to-do: schedule the next wake (Loop skill / short delay) with the prompt below
- Stopped (blocker / done / stop): **do not** reschedule; report the reason

## Wake prompt

```text
/run-plan-loop - next tick. Read HANDOFF + plan. Mark the next to-do in_progress. Execute only that to-do. On close: completed in the plan + HANDOFF + git staging if there is a diff. Stop on external blocker or exhausted plan. Do not ask the user for /continue-plan. Never git prod.
```

## Response to the user (per tick)

Short, trackable:

> Tick: [to-do id]. Done: .... Plan: [N completed / total]. Staging: [PR #N / no diff]. Next: ... | **Loop stopped:** [reason]

## Stop

User: "stop the loop" / "stop" -> do not reschedule; HANDOFF with current state.

## External orchestrator mode (`scripts/plan-loop.sh`)

When the tick arrives via `plan-loop.sh` (the prompt identifies itself), each tick runs in a **fresh headless agent** (clean context window) and the rescheduling is done by the shell script, not the session:

- **Do not** use the Loop skill / do not reschedule internally; execute one to-do and finish.
- End the response with exactly one line: `LOOP_TICK_RESULT: continue` or `LOOP_TICK_RESULT: stop - <reason>`.
- Everything else still applies: one to-do per tick, plan status, HANDOFF, `/git-staging` if there is a diff, **never** `/git-prod`.
- Stop the shell mid-run: `touch .cursor/loop.stop` or Ctrl+C.
