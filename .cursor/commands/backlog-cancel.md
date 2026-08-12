---
name: backlog-cancel
description: Soft-cancel a backlog plan: mark open to-dos cancelled and drop it from the Backlog, keeping the file.
---

# Command: /backlog-cancel

## Goal

Soft-cancel a backlog plan: mark open to-dos as `cancelled`, remove the plan from the HANDOFF Backlog list, and **keep** the file under `.cursor/plans/` (no archive move).

## When to Use

- The plan should leave the backlog queue but remain inspectable in place
- You do not want `/backlog-delete` archive dispose

## Usage

```
/backlog-cancel <plan-file>
```

Examples:

- `/backlog-cancel deferred-idea.plan.md`
- `/backlog-cancel deferred-idea`

## Preconditions

- Plan file exists at `.cursor/plans/<plan-file>` (not under `archive/`)
- Prefer HANDOFF Backlog-listed targets
- If the plan is the **active** HANDOFF `- **Plan:**` entry, **stop**. Park or finish first; do not soft-cancel the live active plan with this command.
- Parked-only plans: use `/archive-plan` (or park workflow), not this command.

## What to Do

1. **Normalize** the basename to end in `.plan.md`.

2. **Confirm with Ask questions** before mutating:
   > "Cancel `[plan-file]`? Open to-dos become `cancelled`, it leaves HANDOFF Backlog, and the file stays under `.cursor/plans/`."

   Options: `Cancel [plan-file] on backlog` / `Keep on backlog`

   **Fallback:** numbered list in chat when Ask questions is unavailable.

3. **Keep on backlog / skipped:** stop. No edits.

4. **On confirm:**
   1. In the plan frontmatter, set every to-do with `status: pending` or `status: in_progress` to `status: cancelled`. Leave `completed` and already-`cancelled` as-is.
   2. Optionally add a one-line note under the plan body Constraints or a short "Cancelled" subsection with the date (project voice; no chat meta).
   3. Remove the plan from HANDOFF `- **Backlog plans:**` / `- **Backlog:**`. Empty list → `none`.
   4. Do not move the file to `archive/`. Do not change active plan, Parked list, or Run queue blocks. Do not call `.cursor/scripts/run-plan-all-consolidate.sh`.
   5. Do not invent Field Report cards.

5. **Respond:**
   > "Cancelled `[plan-file]` on backlog (file kept). Open to-dos marked cancelled; HANDOFF Backlog updated."

## Hard stops

1. Never soft-cancel the active HANDOFF plan with this command.
2. Never `/git-prod`.
3. Skipped/cancelled Ask (or `Keep on backlog`) → stop.
4. Do not hard-delete or archive unless the operator switches to `/backlog-delete`.

## Boundaries

| Command | Difference |
|---------|------------|
| `/backlog-delete` | Removes from Backlog and moves file to `archive/`. |
| `/archive-plan` | Parked-list dispose to `archive/`. |

## Ask questions requirement

Confirmation before cancel **must** use Ask questions per `.cursor/rules/hitl-ask-questions.mdc`.

## Related

- ADR: `.cursor/memory/decisions/2026-07-26_backlog-crud-commands-contract.md`
