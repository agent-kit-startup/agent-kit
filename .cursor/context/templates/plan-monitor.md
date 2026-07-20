# Monitor log — {plan-slug}

**Plan:** [`{plan-filename}.plan.md`](../plans/{plan-filename}.plan.md)
**Monitor started:** {YYYY-MM-DD} (session `/loop`, dynamic self-pacing)
**Purpose:** independent check, per tick, of what the plan's to-do asked for vs what the executing agent actually shipped (commit / PR / HANDOFF / plan frontmatter). Read this file to see prior monitor verdicts before trusting a to-do's `completed` status at face value.

## Method

- A "tick" = one `/run-plan` or `/continue-plan` cycle that closes with a plan-frontmatter status change + `.cursor/HANDOFF.md` update (per `run-plan.md` §"Tick contract").
- Each entry below: **Plan asked** (to-do content + `worker_contract`) vs **Agent did** (commit/PR diff, HANDOFF) vs **Verdict**.
- **WIP is expected and not an alarm.** A to-do mid-`max_ticks` with a partial diff and no HANDOFF/plan-status change yet is logged as `WIP - no verdict`, not a failure. A verdict (`PASS` / `GAP` / `FAIL`) is only assigned once the to-do's status flips to `completed` (or the agent explicitly stops on it).
- `GAP` = shipped and directionally correct, but a named requirement (usually in `worker_contract`) has no visible evidence either way — noted so it isn't silently lost, not treated as a defect.
- `FAIL` = plan requirement contradicted or missing from the shipped diff.
- This file is append-only per tick; the final section ("Full review") is written once when the plan reaches a terminal state (all to-dos completed/cancelled, blocked, or user-stopped).

---

## Baseline (monitor arm time)

- Observed `HEAD` at arm time: `{git-sha}` (PR #{number} merged), plan frontmatter: {initial-status}, HANDOFF said "{initial-handoff-state}".
- [Record any execution that moved between arm and first full check]

---

## Tick {N} — `{to-do-id}` (Phase {N})

- **Status observed:** `{completed/in_progress}` in plan frontmatter; HANDOFF: "{phase-status}"; commit `{git-sha}` ("{commit-message}"), merged via PR #{number} (`{merge-sha}`).
- **Plan asked (to-do + Phase {N} section):**
  - {requirement-1}
  - {requirement-2}
  - `worker_contract`: "{contract-text}"
- **Agent did (verified against `git show {git-sha}`):**
  - {evidence-1} — **matches**
  - {evidence-2} — **matches**
  - {gap-or-issue} — **gap/issue description**
- **Gap:** {description-of-any-gaps}
- **Verdict: {PASS/GAP/FAIL} [{reason}]**

---

[Additional ticks follow same pattern...]

---

## Standing finding — not owned by any remaining to-do (flag for the final review)

{Description of any issues that span multiple phases or aren't explicitly owned by remaining to-dos}

---

## Full review — plan termination ({YYYY-MM-DD HH:MM}, HEAD `{git-sha}`)

**Outcome:** {high-level-summary-of-plan-execution}

### Acceptance checklist vs actual shipped state

| Acceptance item | Status | Evidence |
|---|---|---|
| {requirement-1} | **Met/Partial/Not met** | {evidence} |
| {requirement-2} | **Met/Partial/Not met** | {evidence} |

### Residual items for human attention (none are severe; none block using the shipped behavior)

1. {residual-item-1-description}
2. {residual-item-2-description}

### On the monitor's own method

{reflection-on-monitor-accuracy-and-false-alarms}

**Monitor status:** ended at Full review — `{plan-name}` terminal. No further ticks on that plan.

---

## Current state ({YYYY-MM-DD ~HH:MM}) — agent briefing

{brief-summary-for-next-agent}

### Do not do

- Do **not** continue `{plan-name}` (exhausted; PRs #{list}).
- Do **not** re-plan items closed by follow-up work.
- Do **not** `/git-prod` without explicit human yes.
- Do **not** broad-`git add` this monitor file into unrelated staging PRs.

### Closed (trust these)

| Item | Evidence |
|------|----------|
| {closed-item-1} | {evidence} |
| {closed-item-2} | {evidence} |

### Still open (only these)

| ID | What | Suggested action |
|----|------|------------------|
| A | {open-item-1} | {suggested-action} |
| B | {open-item-2} | {suggested-action} |

### HANDOFF pointer

Active exhausted plan in HANDOFF: `{plan-filename}` ({status}). Instruction there matches this briefing.

**Monitor status (now):** plan terminal from a monitor POV. No further ticks required unless the human asks to watch a new plan or to fix remaining items.

## Staging hygiene note

**IMPORTANT:** Do not `git add` this monitor file into unrelated PRs. Use add-by-name (`git add specific-files`) rather than broad staging (`git add .` or `git add -A`) to prevent sweep of monitor WIP into product commits. See `worktree-concurrency` memory entries for context.