---
name: archive-plan
description: Archive a parked plan: drop it from the HANDOFF parked list and move the file into .cursor/plans/archive/.
---

# Command: /archive-plan

## Goal

Archive a parked plan file: remove it from the HANDOFF parked-plans list and move the plan into `.cursor/plans/archive/`. Copy-only from Mission Control (paste into chat); the agent turn performs the filesystem and HANDOFF edits.

## When to Use

- A plan is listed under HANDOFF `- **Parked plans:**` and no longer needs to stay in the live portfolio
- Mission Control surfaces a completed or parked plan you want off the parked list
- After an exhausted plan has been staged and residuals (if any) are handled elsewhere

## Usage

```
/archive-plan <plan-file>
```

Examples:

- `/archive-plan mission-control-hardening.plan.md`
- `/archive-plan dashboard-field-report-and-skins.plan.md`

`<plan-file>` is the basename under `.cursor/plans/` (with or without `.plan.md`).

## Preconditions

- `.cursor/HANDOFF.md` exists
- The plan file exists at `.cursor/plans/<plan-file>` (not already under `archive/`)
- The plan is referenced on the HANDOFF parked-plans line (or nested parked list), or the user explicitly confirms archival anyway

If the plan is the **active** HANDOFF `- **Plan:**` entry, **stop** and say so. Park or finish that plan first; do not archive the live active plan via this command.

## What to Do

1. **Normalize the file name** to a basename ending in `.plan.md`.

2. **Confirm with Ask questions** before mutating:
   > "Archive `[plan-file]`? This removes it from HANDOFF parked plans and moves it to `.cursor/plans/archive/`."

   Options: `Archive [plan-file]` / `Cancel`

   **Fallback:** if Ask questions is unavailable, present the same options as a numbered list in chat.

3. **On Cancel or skipped answer:** stop. No edits.

4. **On confirm:**
   1. Ensure `.cursor/plans/archive/` exists (create if missing; see `archive/README.md` for local-history convention).
   2. Move `.cursor/plans/<plan-file>` → `.cursor/plans/archive/<plan-file>` (do not overwrite an existing archive file without asking).
   3. Edit `.cursor/HANDOFF.md`:
      - Remove that plan from `- **Parked plans:**` (inline backtick list or nested bullet list).
      - If the parked list becomes empty, set `- **Parked plans:** none` (or remove the nested bullets and leave `none`).
      - Do **not** change `- **Plan:**`, mode, phase, or next to-dos unless they only referenced the archived file as parked metadata.
   4. Do not commit unless the user asks (`/git-staging` if there is a diff they want staged).

5. **Respond:**
   > "Archived `[plan-file]` → `.cursor/plans/archive/`. HANDOFF parked list updated."

## Hard stops

1. **Copy-only surface:** Mission Control (or any panel) may only offer **Copy** `/archive-plan <file>` into chat. No in-panel mutation, no server-side archive API.
2. **Never archive the active HANDOFF plan** without an explicit separate park/finish step.
3. **Never `/git-prod`** from this command.
4. **No product code edits** beyond the plan move and HANDOFF parked-list cleanup.

## Ask questions requirement

Confirmation before archive **must** use Ask questions per `.cursor/rules/hitl-ask-questions.mdc`. Chat fallback only when the tool is missing from the session.

## Related

- Parked plans stay listed until archived; Mission Control may classify parked + zero-open todos as completed while `parked: true` metadata remains.
- Local archive convention: `.cursor/plans/archive/README.md`
