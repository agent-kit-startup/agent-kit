---
name: cancel-plan
description: Cancel the active plan: mark open to-dos cancelled and clear the HANDOFF active-plan fields, keeping the file.
---

# Command: /cancel-plan

## Goal

Cancel the **active** plan (HANDOFF `- **Plan:**`): open to-dos become `cancelled`, HANDOFF stops naming it as the active plan, the file **stays** under `.cursor/plans/` (no archive move), and the plan index is refreshed. Backlog rows use `/backlog-cancel`; parked plans use `/archive-plan`.

## When to Use

- The active plan should stop for good, but stay inspectable in place
- A host (Colony Mission card **Cancel**) needs one command for "drop the plan I am on"

## Usage

```
/cancel-plan [<plan-file>]
```

Examples:

- `/cancel-plan` (the active plan)
- `/cancel-plan colony-1.0-2026-10-31.plan.md`

## Preconditions (stop with no edits when one fails)

1. HANDOFF names an active plan (`- **Plan:**` is not `none`) and the file exists at `.cursor/plans/<plan-file>` (not under `archive/`).
2. A `<plan-file>` argument, normalized to end in `.plan.md`, equals the active plan. Otherwise stop and name the right command: `/backlog-cancel` for a Backlog row, `/archive-plan` for a parked plan.
3. **No run in flight for that plan.** Check both:
   - HANDOFF `- **Queue status:**` starts with `running` and `- **Run queue:**` lists the plan (a `/run-plan-all` queue).
   - A live `run-plan` or `run-plan-all` process of the Agent Kit CLI for this workspace: `ps -eo pid,args` lines matching `(agent-kit|index\.js) run-plan(-all)?( |$)` whose `--cwd` is this workspace root, or, without `--cwd`, whose working directory is (Linux: `readlink /proc/<pid>/cwd`). Colony's engine runs as `node .../engine/<version>/dist/index.js run-plan --cwd <root>`.

   Either hit: stop with "A run is going on `[plan-file]`. Stop it first (Colony Stop, `touch .cursor/loop.stop`, or Ctrl-C in its terminal), then run /cancel-plan again." When `ps` is not available, say so once and add "Confirm no run is going" to the Ask question text.
4. A to-do in `in_progress` alone is not a run (it may wait on an operator gate). It is cancelled like a `pending` one.

## What to Do

1. **Normalize** the basename and read the plan frontmatter. List the open to-do ids (`pending` and `in_progress`).

2. **Confirm with Ask questions** (ask-id `cancel-plan`) before mutating:
   > "Cancel the active plan `[plan-file]`? Open to-dos `[ids]` become `cancelled`, HANDOFF stops naming it as the active plan, and the file stays under `.cursor/plans/`."

   Options: `Cancel active plan [plan-file]` / `Keep the active plan`

   **Fallback:** numbered list in chat with the `HITL_GATE: cancel-plan | ...` line when Ask questions is unavailable.

3. **Keep the active plan / skipped / no answer:** stop. No edits.

4. **On confirm:**
   1. In the plan frontmatter, set every to-do with `status: pending` or `status: in_progress` to `status: cancelled`. Leave `completed` and already-`cancelled` as-is.
   2. Add a short `## Cancelled` section to the plan body: date, the cancelled to-do ids, and the Ask provenance (operator reply or the `HITL_REPLY` line). Project voice, no chat meta.
   3. HANDOFF: set `- **Plan:** none`. Fields that describe that plan's position (`- **Progress:**`, `- **Phase:**` / `- **Current phase:**`, `- **Next to-do:**` / `- **Next to-dos:**`) become `none`, or one line `Cancelled [plan-file] on <date> (/cancel-plan)` when the field also carries unrelated items (keep those). Set `- **Mode:**` to `STOPPED (active plan cancelled)`. Add one dated narrative line with the cancelled ids and the Ask provenance.
   4. Do not change `- **Backlog plans:**`, `- **Parked plans:**`, `- **Run queue:**`, `- **Queue cursor:**`, `- **Queue status:**` or `- **Queue outcomes:**`. Do not activate another plan or promote a Backlog row: the next plan starts with `/start-project` or `/run-plan-all`.
   5. Refresh the plan index: `agent-kit plan-index` (writes `.cursor/context/plan-index.json`). When the CLI is not installed, say so and leave the file as it is.
   6. Do not move the file to `archive/`. Do not invent Field Report cards. Do not run `/git-staging` from this command.

5. **Respond:**
   > "Cancelled the active plan `[plan-file]` (file kept). Open to-dos `[ids]` marked cancelled; HANDOFF no longer names an active plan; plan index refreshed. Next: `/start-project` for a new plan or `/run-plan-all` for the Backlog."

## Hard stops

1. Never cancel a plan with a run or queue in flight on it; never from inside a headless tick.
2. Never `/git-prod`.
3. Skipped or cancelled Ask (or `Keep the active plan`) → stop.
4. Never touch Backlog, Parked, or Run queue fields; never pick the next plan.
5. Do not hard-delete or archive. For a disposal, finish here and then use `/archive-plan` from the parked list, or move the file by hand.

## Boundaries

| Command | Target | Effect |
|---------|--------|--------|
| `/cancel-plan` | Active plan | Open to-dos cancelled, active fields cleared, file kept |
| `/backlog-cancel` | Backlog row | Open to-dos cancelled, Backlog row dropped, file kept |
| `/backlog-delete` | Backlog row | Backlog row dropped, file moved to `archive/` |
| `/archive-plan` | Parked plan | Parked row dropped, file moved to `archive/` |

## Hosts

Colony starts the interactive agent with `/cancel-plan <plan-file>` (plan CRUD seam, `host.interactive`). The command asks its own confirmation there; the host never answers it, and the host disables its Cancel action while a run is going.

## Ask questions requirement

Confirmation before cancel **must** use Ask questions per `.cursor/rules/hitl-ask-questions.mdc`.

## Related

- ADR: `.cursor/memory/decisions/2026-07-26_backlog-crud-commands-contract.md` (Amend 2026-10-31)
