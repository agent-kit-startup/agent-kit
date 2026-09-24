---
name: run-plan-all
description: Orchestrate multiple plans as an ordered queue, then ship one release per completed plan.
---

# Command: /run-plan-all

## Goal

Orchestrate multiple eligible plans as an ordered queue. The main window is a **pure orchestrator**: PO synthesis, HITL confirm, then one Task per plan running the `/run-plan` tick. When Ship auth is `per-plan-release`, this window then ships one release per completed plan. Plan Tasks never `/git-prod`.

HITL contract, exact Ask labels, numbered fallback (path 1): [hitl-gates](../skills/core/hitl-gates/SKILL.md). PO synthesis, confirm queue, ship lane, and execute-queue detail: [run-plan-all-queue.md](../skills/core/hitl-gates/run-plan-all-queue.md) (each queued plan's own tick runs [run-plan-tick-contract.md](../skills/core/hitl-gates/run-plan-tick-contract.md)). Plans inventory is `.cursor/context/plan-index.json` + `.cursor/HANDOFF.md` only (ADR `2026-07-26_command-orchestration-delegation-pattern.md`).

## Hard stops (kit failure if skipped)

1. **One release per completed plan that has a product diff** when the confirm label sets Ship auth `per-plan-release`. `Run plans only` does not ship. Each ship is one SemVer, one `v*` tag, one promote. The next plan starts only after that ship is Done. A completed plan with no versionable product diff skips that release and the cursor advances. A red or unfinished post-prod verification, or a product diff that is not staging-ready, stops the queue (no extra patch, no next plan).
2. **Confirm before execute.** Default-path Ask is start-vs-resume (stored queue + material drift) or the queue confirm (fresh synthesis). Inbox Ask is opt-in or post-default, never a pre-Ask blocker. No silent resume that skips eligible-not-queued or adjustment-class Backlog.
3. **One Task per plan, sequential.** After the confirm Ask the orchestrator dispatches one Task subagent per queued plan. It must not implement to-dos, run tests, or write that plan's changelog. Mandatory execution Task is **per queued plan** after confirmation. No parallel plan Tasks. No co-pack with `/git-staging`. The ship lane starts only after that Task's summary is in.
4. **Missing or malformed summary:** Ask the user before advancing the cursor. Do not invent an outcome.
5. **Audits do not cut a second tag.** Mid-batch: one arm+wait, no triage Ask. Exit `3` is timeout-only and does not retroactively convert, upgrade, or rewrite a later monitor into success. Queue-end wait then `/plan-review-triage`.

## Ask labels

| Gate | Labels |
|------|--------|
| Inbox (post-default) | `Analyze inbox now` / `Enqueue Fix now` / `Not now` |
| Start vs resume | `Resume frozen queue` / `Insert new backlog` / `Re-synthesize` |
| Confirm queue | `Run as proposed` / `Run plans only` / `Edit order` / `Apply merges & drops only` / `Keep all plans as-is` / `Include Gate-B plans` / `Cancel` |

`Run as proposed`, `Edit order`, `Apply merges & drops only`, and `Keep all plans as-is` set Ship auth `per-plan-release`. `Run plans only` sets `plans-only`. Numbered-list fallback is **path 1** when Ask questions is missing.

## Procedure

1. Skim Unprocessed (mention only; inbox Ask is post-default). Preflight audit session-pile and unsatisfiable Claude reviewer (`warn`/`block` per `externalPlanReview.preflight`).
2. PO synthesis (Task explore; no `kind: resume`). On a stored queue with no material drift, resume the frozen order and its Ship auth (missing Ship auth is `plans-only`). On material drift, Ask start-vs-resume.
3. Queue confirm on a fresh synthesis. Apply only approved consolidations via `.cursor/scripts/run-plan-all-consolidate.sh`. Write `- **Ship auth:**` on HANDOFF.
4. Dispatch one `/run-plan` Task per queued plan. Worker skips chat exhaustion Ask and never `/git-prod`. Record outcomes. Run the ship lane before advancing the cursor.
5. Mid-batch wait when `midBatchAudits` is on. Queue-end: Final HANDOFF, audits, `/plan-review-triage` path list. `plans-only` may then suggest `/git-prod` if staging is ahead of `main` (separate HITL). `per-plan-release` does not ship again at queue end.
