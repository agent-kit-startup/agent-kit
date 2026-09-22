---
name: run-plan-all
description: Orchestrate multiple plans as an ordered, deduplicated execution queue, one Task per plan.
---

# Command: /run-plan-all

## Goal

Orchestrate multiple eligible plans as an ordered queue. The main window is a **pure orchestrator**: PO synthesis, HITL confirm, then one Task per plan running the `/run-plan` tick. Never `/git-prod`.

HITL contract, exact Ask labels, numbered fallback (path 1): [hitl-gates](../skills/core/hitl-gates/SKILL.md). PO synthesis, confirm queue, and execute-queue detail: [run-plan-all-queue.md](../skills/core/hitl-gates/run-plan-all-queue.md) (each queued plan's own tick runs [run-plan-tick-contract.md](../skills/core/hitl-gates/run-plan-tick-contract.md)). Plans inventory is `.cursor/context/plan-index.json` + `.cursor/HANDOFF.md` only (ADR `2026-07-26_command-orchestration-delegation-pattern.md`).

## Hard stops (kit failure if skipped)

1. **Never `/git-prod`.** Prod suggestion after queue-end is a separate HITL.
2. **Confirm before execute.** Default-path Ask is start-vs-resume (stored queue + material drift) or the 6-way confirm (fresh synthesis). Inbox Ask is opt-in or post-default, never a pre-Ask blocker. No silent resume that skips eligible-not-queued or adjustment-class Backlog.
3. **One Task per plan, sequential.** After the confirm Ask the orchestrator dispatches one Task subagent per queued plan. It must not implement to-dos, run tests, or write changelogs. Mandatory execution Task is **per queued plan** after confirmation. No parallel plan Tasks. No co-pack with `/git-staging`.
4. **Missing or malformed summary:** Ask the user before advancing the cursor. Do not invent an outcome.
5. **Audits do not steal `/git-prod`.** Mid-batch: one arm+wait, no triage Ask. Exit `3` is timeout-only and does not retroactively convert, upgrade, or rewrite a later monitor into success. Queue-end wait then `/plan-review-triage`.

## Ask labels

| Gate | Labels |
|------|--------|
| Inbox (post-default) | `Analyze inbox now` / `Enqueue Fix now` / `Not now` |
| Start vs resume | `Resume frozen queue` / `Insert new backlog` / `Re-synthesize` |
| Confirm queue | `Run as proposed` / `Edit order` / `Apply merges & drops only` / `Keep all plans as-is` / `Include Gate-B plans` / `Cancel` |

Numbered-list fallback is **path 1** when Ask questions is missing.

## Procedure

1. Skim Unprocessed (mention only; inbox Ask is post-default). Preflight audit session-pile and unsatisfiable Claude reviewer (`warn`/`block` per `externalPlanReview.preflight`).
2. PO synthesis (Task explore; no `kind: resume`). On a stored queue with no material drift, resume the frozen order. On material drift, Ask start-vs-resume.
3. 6-way confirm on a fresh synthesis. Apply only approved consolidations via `.cursor/scripts/run-plan-all-consolidate.sh`.
4. Dispatch one `/run-plan` Task per queued plan. Worker skips chat exhaustion Ask. Record outcomes, advance cursor.
5. Mid-batch wait when `midBatchAudits` is on. Queue-end: Final HANDOFF, audits, `/plan-review-triage` path list, then suggest `/git-prod` if staging is ahead of `main`.
