---
name: backlog-add
description: Enqueue a new plan with to-dos under the HANDOFF Backlog without activating it.
---

# Command: /backlog-add

## Goal

Enqueue a **new plan with to-dos** under HANDOFF Backlog without activating it, parking the current plan, or offering Gate B. Same Broad Intake scan as `/start-project`; activation gates are skipped on purpose. Plans inventory is `.cursor/context/plan-index.json` + `.cursor/HANDOFF.md` only (ADR `2026-07-26_command-orchestration-delegation-pattern.md`).

## When to Use

- You want a plan file and a Backlog row while the current active plan stays active
- You do not want park / activate / first-unit HITL from `/start-project`
- The goal is queueing work for later (`/continue-plan`, `/run-plan`, or `/run-plan-all`), not starting it now

## Usage

```
/backlog-add <goal>
```

Example: `/backlog-add Polish Mission Control empty-state icons`

## Hard stops

1. **Broad Intake Review first** (same buckets and triage labels as `/start-project`).
2. **Plan file + Backlog HANDOFF only** in the add turn. No product, registry, rule, or docs-of-record edits.
3. **Never park or activate.** Do not change `- **Plan:**`, phase, next to-dos, Parked list, or an in-flight Run queue.
4. **Never offer Gate B.** After write, report the path and stop.
5. **Do not invent Field Report cards** for routine enqueue.
6. **Never `/git-prod`.**

## Prepared repository

Same planning blockers as `/start-project`: unresolved essential readiness → point to `/agent-kit-onboard`. Non-essential pending is advisory only.

**Never-Ask:** `confirm-provider` / `collaboration.provider` must not become an Ask. One-line advisory or silence, then continue Broad Intake → propose → write Ask. Do not halt enqueue. Distinct from an essential-readiness hard stop (that still points to `/agent-kit-onboard`). The Broad Intake worker inherits this: do not return a readiness-gate Ask for that check.

## What to Do


### 1. Broad Intake Review (required before plan proposal)

Same Broad Intake buckets, triage labels, and Task(explore) delegation as `/start-project`; the Plans bucket is index + HANDOFF only. Includes a post-write, post-default inbox Ask (`Analyze inbox now` / `Enqueue Fix now` / `Not now`, exact labels also in [hitl-gates SKILL.md](../skills/core/hitl-gates/SKILL.md)) when Unprocessed is non-empty. Full detail: [procedure.md](../skills/core/backlog-add/procedure.md).

### 2. Vague goal

If the goal is missing or vague, use **Ask questions** (chat numbered-list fallback):
> "What's the goal to put on the backlog? (1-2 sentences)"

Wait before proposing.

### 3. Propose and confirm write

1. Propose phases and to-dos (align with `autogit/plan-routine.md` and `.cursor/context/templates/plan.md`).
2. Ask with **Ask questions** (one list; numbered-list fallback is path 1):

   > "Write this plan to backlog (keep current active plan; no Gate B)?"

   Options:
   - `Write plan to backlog`
   - `Modify proposal first`
   - `Cancel`

3. **Cancel / skipped answer:** stop. No file or HANDOFF edits.
4. **Modify:** revise the proposal, ask again.
5. **Write plan to backlog:**
   1. Create `.cursor/plans/<name>.plan.md` with frontmatter to-dos.
   2. Append the basename under HANDOFF `- **Backlog plans:**` (canonical label; Checklist also accepts `- **Backlog:**`). Use the bullet field, never a `## Backlog plans` heading alone (Mission Control will not see the row).
   3. Do not touch active plan fields, Parked plans, or Run queue blocks. Do **not** call `.cursor/scripts/run-plan-all-consolidate.sh` (that path is for `/run-plan-all` after confirm Ask only).
   4. Stop. Tell the operator the plan path and that resume is via `/continue-plan` (or later queue inclusion), not Gate B.

## Boundaries

| Command | Difference |
|---------|------------|
| `/start-project` | May park/activate and offers Gate B when activating. Use when disposition is unknown. |
| `/continue-plan` | Starts a unit on a chosen plan. `/backlog-add` never starts units. |
| `/archive-plan` | Parked-list dispose. Not used here. |

## Ask questions requirement

Vague-goal clarify and write confirmation **must** use Ask questions per `.cursor/rules/hitl-ask-questions.mdc`. Chat fallback: one numbered list per message.

## Related

- ADR: `.cursor/memory/decisions/2026-07-26_backlog-crud-commands-contract.md`
- Disposition gate for `/start-project`: `.cursor/memory/decisions/2026-07-25_start-project-plan-disposition-gate.md`
- Cursor product-update gaps may route here via `/cursor-update-awareness` (Ask → `/backlog-add`)
- Public inbound rows may route here via `/public-inbound-radar` (Ask → `/backlog-add`; Dependabot is one batch)

## Opt-in public inbound nudge (factory)

When `publicInboundCheck.enabled` is true and the interval elapsed, after the write Ask (never before Broad Intake), optionally run `agent-kit public-inbound-radar --json --respect-prefs --stamp` and surface `/public-inbound-radar` route Ask if open items exist. Default off. Fail-open. See ADR `2026-09-24_public-inbound-radar.md`.
