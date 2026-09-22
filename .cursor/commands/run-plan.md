---
name: run-plan
description: Run the active plan continuously until it is done or blocked, picking the execution strategy automatically.
---

# Command: /run-plan

## Goal

Run the **active plan** continuously until it is done or blocked. The agent picks the strategy (orchestrated when Task exists, in-session loop otherwise, headless `agent-kit run-plan`). Never `/git-prod` from this command.

HITL contract, exact Ask labels, numbered fallback (path 1): [hitl-gates](../skills/core/hitl-gates/SKILL.md). Full tick contract: [run-plan-tick-contract.md](../skills/core/hitl-gates/run-plan-tick-contract.md).

## Hard stops (kit failure if skipped)

1. **Never `/git-prod`.** Suggest it only after Final HANDOFF when staging is ahead of `main` (separate HITL).
2. **One to-do per tick.** Mark `in_progress` before work. Never stack the next to-do.
3. **Risk / API-limit stop.** PII, secrets, or ambiguous scope: Ask the risk labels. Quota or Task abort: revert the to-do to `pending`, HANDOFF the stop, do not reschedule or silent-inline.
4. **One Ask on the default path.** Inbox, owed-close, and landing Asks are opt-in or post-default, never pre-Ask blockers. Empty inbox: silent skip. Skip the inbox Ask inside a `/run-plan-all` per-plan Task.
5. **Exhaustion audits do not steal `/git-prod`.** Exit `3` is timeout-only and does not retroactively convert, upgrade, or rewrite a later monitor into success.

## Ask labels

| Gate | Labels |
|------|--------|
| Risk | `Continue with risk` / `Modify approach` / `Stop run` |
| Inbox (post-default) | `Analyze inbox now` / `Enqueue Fix now` / `Not now` |
| Exhaustion (post-default) | `Run review now` / `Always enable automatic` / `Not now` |
| Owed-close (post-default) | `Adopt existing monitor` / `Ack owed without review` / `Not now` |

Numbered-list fallback is **path 1** when Ask questions is missing.

## Procedure

1. Read HANDOFF + plan + config. Preflight API-limit stop, audits, unsatisfiable Claude reviewer, session-pile. Read a product-context extract when the plan points at one.
2. Next pending to-do. `force_task: true` or findings → Task. Lightweight docs-only → inline-first. Else Task or in-session.
3. Execute only that to-do. Findings-only for `review-*`. `autoRemediate` default false: no silent product fix.
4. Close: plan status, HANDOFF, cadence bump, `/git-staging` on a commitable diff. Staging ready: yes requires lint evidence (or `none applicable`). Dashboard HTML: `none applicable (dashboard-CSS)` covered by plugin-ux-validation. Contract string alone without that evidence is invalid.
5. Reschedule or stop (blocker, exhausted, user stop, API limit). Never `/git-prod`.

Persona chrome (`agentPersona.modes.run-plan`) after the command Ask, not instead of HITL. Default chat chrome: no cockpit emoji.
