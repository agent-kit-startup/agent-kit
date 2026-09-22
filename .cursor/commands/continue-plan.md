---
name: continue-plan
description: Resume a plan from the last handoff and execute only the next unit.
---

# Command: /continue-plan

## Goal

Resume a plan from the last handoff. Confirm the next unit, then execute **only that unit** (manual default).

HITL contract, exact Ask labels, and numbered fallback (path 1): [hitl-gates](../skills/core/hitl-gates/SKILL.md). Resume detail is inline below (moved here from `hitl-gates/procedures.md` in Phase 1 of `contract-read-budget-lazy-layers-2026-09-19` — the 11-line resume section already fully overlapped this file's own Procedure, so it was folded in rather than kept as a separate one-line hop). Plans inventory is `.cursor/context/plan-index.json` + `.cursor/HANDOFF.md` only (ADR `2026-07-26_command-orchestration-delegation-pattern.md`).

## Hard stops (kit failure if skipped)

1. **Read `.cursor/HANDOFF.md` first.** No handoff: say so and suggest `/start-project`. Do not invent progress.
2. **API/usage-limit pre-flight.** If Mode / Gaps / Instruction still records an API/usage limit stop, do not mark a to-do `in_progress` until the operator confirms recovery. Numbered-list fallback is path 1.
3. **One Ask on the default path.** Confirm the next `[to-do-id]` before editing (or the multi-plan picker first when more than one resumable plan exists). Inbox, owed-close, and landing Asks are opt-in or post-default, never pre-Ask blockers. Empty inbox: silent skip.
4. **One unit per chat** unless the operator ran `/run-plan`.
5. **Do not start a competing plan.** New goal requires `/start-project`.

## Ask labels

**Default-path (next unit):** `Start [to-do-id]` / `Edit plan first` / `Switch to different plan` / `Stop here`

**Multi-plan picker (when needed):** `[plan-name.plan.md]` / `Create new plan instead`

**Inbox (post-default, Unprocessed non-empty):** `Analyze inbox now` / `Enqueue Fix now` / `Not now`

Numbered-list fallback is **path 1** when Ask questions is missing.

## Procedure

1. Read HANDOFF + index. Do not glob `.cursor/plans/*.plan.md`. If multiple resumable plans exist, Ask the picker first.
2. Default-path Ask for the next unit. Persona chrome after that Ask. Default chat chrome: no cockpit emoji.
3. On `Start [to-do-id]`: run only that unit; update plan status. Any other pick stops.
4. When done: HANDOFF, stop, suggest `/git-staging` if there is a diff. Next phase: new conversation with `/continue-plan`.
5. Inbox skim may mention count after the entry Ask. Do not Ask inbox before it.
