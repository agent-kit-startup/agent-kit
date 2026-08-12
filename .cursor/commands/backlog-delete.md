---
name: backlog-delete
description: Remove a plan from the HANDOFF Backlog and move the file to .cursor/plans/archive/.
---

# Command: /backlog-delete

## Goal

Remove a plan from the HANDOFF Backlog list and dispose the file by moving it to `.cursor/plans/archive/` (same archive convention as `/archive-plan`, different source list).

## When to Use

- A backlog-listed plan should leave the live portfolio
- You want dispose-to-archive, not a soft cancel (see `/backlog-cancel`)

## Usage

```
/backlog-delete <plan-file>
```

Examples:

- `/backlog-delete old-experiment.plan.md`
- `/backlog-delete old-experiment`

## Preconditions

- `.cursor/HANDOFF.md` exists
- Plan file exists at `.cursor/plans/<plan-file>` (not already under `archive/`)
- Prefer plans listed under `- **Backlog plans:**` / `- **Backlog:**`
- If the plan is the **active** HANDOFF `- **Plan:**` entry, **stop**. Park or finish it first; do not delete the live active plan via this command.
- If the plan is only on **Parked plans**, stop and point to `/archive-plan` instead.

## What to Do

1. **Normalize** the basename to end in `.plan.md`.

2. **Confirm with Ask questions** before mutating:
   > "Delete `[plan-file]` from backlog? This removes it from HANDOFF Backlog and moves it to `.cursor/plans/archive/`."

   Options: `Delete [plan-file] from backlog` / `Cancel`

   **Fallback:** numbered list in chat when Ask questions is unavailable.

3. **Cancel / skipped:** stop. No edits.

4. **On confirm:**
   1. Ensure `.cursor/plans/archive/` exists (see `archive/README.md`).
   2. Move `.cursor/plans/<plan-file>` → `.cursor/plans/archive/<plan-file>` (do not overwrite an existing archive file without asking).
   3. Edit HANDOFF: remove the plan from `- **Backlog plans:**` (or `- **Backlog:**`). If the list becomes empty, set `none` (or equivalent empty form used in the file).
   4. Do **not** change active `- **Plan:**`, Parked list, Run queue, or Queue cursor unless they only referenced this basename as backlog metadata. Do **not** call `.cursor/scripts/run-plan-all-consolidate.sh` to rewrite queue fields.
   5. Do not hard-unlink the file. Do not invent Field Report cards.

5. **Respond:**
   > "Removed `[plan-file]` from backlog → `.cursor/plans/archive/`. HANDOFF Backlog updated."

## Hard stops

1. Never delete/archive the active HANDOFF plan with this command.
2. Never use this for parked-only rows (`/archive-plan`).
3. Never `/git-prod`.
4. Skipped/cancelled Ask → stop.

## Boundaries

| Command | Difference |
|---------|------------|
| `/archive-plan` | Source list is Parked plans. |
| `/backlog-cancel` | Soft cancel: keep file under `.cursor/plans/`, mark open to-dos `cancelled`. |

## Ask questions requirement

Confirmation before delete **must** use Ask questions per `.cursor/rules/hitl-ask-questions.mdc`.

## Related

- ADR: `.cursor/memory/decisions/2026-07-26_backlog-crud-commands-contract.md`
- `/archive-plan` for parked dispose
