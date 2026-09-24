---
name: start-project
description: Bootstrap a plan with to-dos from any user payload, with two HITL gates.
---

# Command: /start-project

## Goal

Bootstrap a **plan with to-dos** from any user payload. This command does **not** mean start coding.

HITL contract, exact Ask labels, numbered fallback (path 1): [hitl-gates](../skills/core/hitl-gates/SKILL.md). Broad Intake and Gate A/B detail: [start-project-intake.md](../skills/core/hitl-gates/start-project-intake.md).

## Hard stops (kit failure if skipped)

1. **Broad Intake first.** Scan via Task(explore) (or inline). Plans bucket is `.cursor/context/plan-index.json` + `.cursor/HANDOFF.md` only. Do not glob `.cursor/plans/*.plan.md`. Delegation stays (ADR `2026-07-26_command-orchestration-delegation-pattern.md`).
2. **Plan file before any product edit.** Allowed writes: the new `.cursor/plans/*.plan.md` and HANDOFF disposition. Host Plan Mode does not replace Gate A/B: if the host already has a native plan, copy it into `.cursor/plans/` then run Gate A (ADR `2026-09-15_kit-plans-sot-over-host-plan-mode.md`).
3. **Goal in the same message is not execute permission.** Ask only for the deliverable goal.
4. **Two gates, two yes answers.** Gate A writes the plan and stops. Gate B runs one unit only after a second yes.
5. **Never** "create a plan and start Phase 1" in one turn. `confirm-provider` / `collaboration.provider` are warnings only; do not Ask them.

## Ask labels

**Gate A, active plan:** `Write plan and add to backlog (keep current active)` / `Park current plan, write plan and activate new` / `Modify proposal first` / `Cancel`

**Gate A, no active plan:** `Write plan file` / `Write plan and add to backlog` / `Modify proposal first` / `Cancel`

**Gate B:** `Start first unit` / `Switch to /run-plan` / `Edit plan first` / `Add to backlog` / `Stop here`

Default-path Ask is Gate A. Gate B is a second yes. Inbox and `confirm-provider` are never on this path.

Numbered-list fallback is **path 1** when Ask questions is missing (one list per message).

## Procedure

1. Readiness: read `.cursor/agent-kit.config.json` and `.cursor/context/readiness.json`. Unresolved `essential: true` checks block planning; point to `/agent-kit-onboard`. Do **not** treat `pendingActions` as an essential-only queue. Non-essential pending is warnings only.
2. Broad Intake (delegated). Triage ignore / error / include / note. Product-context extract only when the payload mixes personal and product. Major Tom (ADR `2026-09-04_major-tom-autonomous-mode.md`) is not intake.
3. Vague goal: Ask for 1-2 sentences, then Gate A.
4. Gate A: write plan + HANDOFF per pick. Backlog paths skip Gate B (`Mode: STOPPED` or current plan stays active).
5. Gate B (park or no-active-plan activate only): one unit, HANDOFF, stop. Suggest `/git-staging` if there is a diff. Manual mode: one phase per chat unless the operator used `/run-plan`.

## Opt-in public inbound nudge (factory)

When `publicInboundCheck.enabled` is true and the interval elapsed, after the default Gate Ask (never before it), optionally run `agent-kit public-inbound-radar --json --respect-prefs --stamp` and surface `/public-inbound-radar` route Ask if open items exist. Default off. Fail-open. See ADR `2026-09-24_public-inbound-radar.md`.
