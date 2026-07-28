# Command: /backlog-edit

## Goal

Edit an existing plan file's body and/or frontmatter (to-dos, overview, phases) without activating it, parking another plan, or touching Field Report.

## When to Use

- A backlog-listed (or other non-active) plan needs scope, to-do, or acceptance tweaks
- You want a dedicated mutate path with explicit confirm before write

## Usage

```
/backlog-edit <plan-file>
```

Examples:

- `/backlog-edit mission-control-empty-state-section-icons.plan.md`
- `/backlog-edit mission-control-cursor-astronaut-logo`

`<plan-file>` is the basename under `.cursor/plans/` (with or without `.plan.md`).

## Preconditions

- Plan file exists at `.cursor/plans/<plan-file>` (not under `archive/`)
- Prefer targets listed under HANDOFF `- **Backlog plans:**` (or `- **Backlog:**`). If the plan is not backlog-listed, warn once and Ask whether to edit anyway.
- If the plan is the **active** HANDOFF `- **Plan:**` entry, you may still edit the file after confirm, but do **not** change HANDOFF active cursor, mode, or queue unless the operator separately asks.

## What to Do

1. **Normalize** the basename to end in `.plan.md`.

2. **Resolve intent:** if the user did not specify the edit in the same message, ask what to change (Ask questions or short clarify). Do not invent scope.

3. **Confirm with Ask questions** before mutating:
   > "Edit `[plan-file]` (plan markdown / to-dos only; active plan and queue unchanged)?"

   Options: `Edit [plan-file]` / `Cancel`

   **Fallback:** numbered list in chat when Ask questions is unavailable.

4. **Cancel / skipped:** stop. No edits.

5. **On confirm:** apply only plan-file edits (frontmatter + body). Do not:
   - Swap `- **Plan:**` or park/activate
   - Reorder Run queue / Queue cursor (do not call `.cursor/scripts/run-plan-all-consolidate.sh`)
   - Create Field Report cards
   - Edit product code or docs-of-record in this turn

6. **Respond:** brief summary of what changed in the plan file. Suggest `/continue-plan` only if the operator wants to run a unit next (not automatic).

## Hard stops

1. Skipped/cancelled Ask → stop.
2. Never `/git-prod`.
3. No Field Report noise for routine edits.
4. Do not steal `/start-project` Gate A/B or `/run-plan-all` queue ownership.

## Ask questions requirement

Confirmation before mutate **must** use Ask questions per `.cursor/rules/hitl-ask-questions.mdc`.

## Related

- `/backlog-add`, `/backlog-delete`, `/backlog-cancel`
- ADR: `.cursor/memory/decisions/2026-07-26_backlog-crud-commands-contract.md`
