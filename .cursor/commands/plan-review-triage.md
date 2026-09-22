---
name: plan-review-triage
description: Triage residuals from an external plan review monitor and guide next steps.
---

# Command: /plan-review-triage

## Goal

Triage residuals from a **Claude external plan review** monitor. Select the right monitor(s) (untriaged / explicit paths, **not** raw mtime), summarize open residuals, and guide next steps with **Ask questions**.

Supports **multi-path walk**: iterate multiple monitors in blocking-first then debt order when given several report paths (for example the path list printed by `/plan-external-review` after a batch, or a Flight Log **Copy triage command** paste). When remaining monitors share a **uniform** outcome class, use **one** batch Ask (still write a durable triage heading on every target). Mixed outcomes fall back to sequential Asks. Operator may expand Write residuals to the whole remaining set in one reply (`1 and write all the other`); enqueue via paced per-monitor Tasks (wave size 2) or one combined plan (see Step 6).

## When to Use

- After Claude external plan review completed (monitor file exists under `.cursor/memory/plan-monitor-*.md`)
- You want to process findings from the monitor and decide next steps
- **Daily path:** `/run-plan` (exhaustion) and `/run-plan-all` (queue-end) continue into this Ask after wait exit 0. This slash stays HITL SoT; operators should not need to type `done` or paste triage solely to resume. ADR `2026-08-14_main-command-dogfood-audit-routing.md`.
- **Owed-row adoption:** an explicit path invocation (`/plan-review-triage <path>`) on a monitor whose slug has a **dead** wait-state (`.cursor/context/audit-wait/<slug>.json` `status: "timeout"`/`"soft-fail"`, or `"armed"` with `now >= deadline`) and an **owed** Field Report row for that plan runs this same Step 1-5 walk unchanged, but Step 4's durable heading additionally records the adoption (see Step 4).
  Gap-aware skip's "no open residuals / clean Outcome" row does **not** apply to an adoption target: a clean adopted monitor still gets the Ask and the durable heading (only "already triaged" or "not a monitor file" may still skip it) — the owed row needs that heading to close.
  This is the `Adopt existing monitor` HITL label offered by `/run-plan` / `/run-plan-all`'s owed-close path (`.cursor/memory/errors/2026-08-14_audit-owed-ledger-no-close-path.md`); it is never automatic and never rewrites the earlier exit `3`.
- **Not for mid-plan reviews** - this command expects `completed` work only

## Usage

Standard (no paths: select untriaged monitors; see Step 1):
```
/plan-review-triage
```

Multi-path (preferred after a fresh external review; walk specific monitors in order):
```
/plan-review-triage .cursor/memory/plan-monitor-slug-1.md .cursor/memory/plan-monitor-slug-2.md
```

When paths are provided, the agent walks them in the given order (blocking first, then debt when auto-ordered). After gap-aware skip, if two or more monitors still need a decision and share a **uniform** outcome class, use **one** Ask for the set (batch Ack or one residuals summary); otherwise Ask **per** monitor. Every decided monitor still gets its own durable triage heading.

**Do not rely on bare `/plan-review-triage` after a batch external review** when the launcher (or Claude closeout) already printed explicit monitor paths: paste that path list so triage cannot miss the files just written.

### Gap-aware skip (multi-path)

Before Asking on a path, skip with a **one-line note** (do not abort the walk) when any of these hold:

| Skip when | One-line note example |
|-----------|------------------------|
| Already triaged (`## Triage note` / `## Follow-up plan` / `## Residuals plan`) | `Skip plan-monitor-x.md: already triaged` |
| No open gaps (empty Still open / no residual items / clean Outcome) | `Skip plan-monitor-x.md: no open residuals` |
| Path missing or not a `plan-monitor-*.md` under `.cursor/memory/` | `Skip <path>: not a monitor file` |

The skip rules above are defensive for hand-built multi-path lists. Flight Log per-row **Copy triage command** remains available for intentional one-monitor triage of a clean or already-visible row. There is no `/field-report-review` command and no Mission Control **Review all** button.

## Preconditions

- When no paths provided: at least one **untriaged** monitor exists under `.cursor/memory/plan-monitor-*.md` (or git shows new/staged monitors that still need a triage heading)
- When paths provided: each path points to an existing file matching `plan-monitor-*.md` under `.cursor/memory/`; nonexistent or non-monitor paths are skipped with a one-line note without aborting the walk
- Monitor has "Current state" or "Full review" section with residuals
- Plan referenced in the monitor has exhausted implementable to-dos

If no `plan-monitor-*.md` exists (and no paths given), say so once, suggest `/plan-external-review` after prefight files exist, and **stop**. Do not invent residuals.

If monitors exist but **all** are already triaged (and none are new/staged without a heading), say so once, suggest `/plan-external-review` if a new review is owed, and **stop**. Do not invent residuals from an already-acked file. Do not suggest Field Report **Review all** or `/field-report-review`: neither exists.


## What to Do

Full Steps 1-6 walk and example flows: [procedure.md](../skills/core/plan-review-triage/procedure.md).

## Hard stops

1. **Never treat Claude monitor as execute permission** - all paths require human confirmation
2. **Never `/git-prod`** from this command - residual fixes go through `/git-staging` only  
3. **Never auto-implement** without the triage choice above
4. **Never skip Broad Intake or the backlog write-confirm Ask** on Write residuals plan (write-confirm may collapse for a remaining multi-path set when the operator authorizes it in the same reply as Write residuals). Never park, activate, Gate B, or rewrite Run queue from this path. Clipboard `/start-project` is **not** the happy path (optional operator escape hatch only when they want activate + Gate B). Do not fan out ≥3 plan-author Tasks in one turn (Step 6 pacing).
5. **No broad scope creep** in "Fix nits only" - redirect to Write residuals plan (backlog enqueue) for substantial work. At closeout_depth ≥ 1 with no Blocking product finding, Step 5A gate 0 refuses that enqueue; use Ask **Other** / an explicit operator override instead (ADR decision 6) and record it in the triage heading.
6. **Never skip the triage heading** - including Ack and stop
7. **Never unbounded close-* conveyor** - enforce max closeout depth and nits/process-only defaults (Step 2b / Step 5A gate 0; ADR `decisions/2026-08-11_plan-audit-residuals-termination.md`). Depth-capped process-only Still open → Ack or Fix nits, not another `close-*`.

## Ask questions requirement

**All triage decisions MUST use Ask questions tool** per kit-wide contract (`.cursor/rules/hitl-ask-questions.mdc`). This creates clickable options in the IDE UI.

**Chat fallback only** if the tool is unavailable in the current session.

## References

- Monitor template: `.cursor/context/templates/plan-monitor.md`
- Residuals enqueue: `.cursor/commands/backlog-add.md` (Broad Intake + write-confirm Ask + Backlog HANDOFF)
- Optional activate + Gate B: `.cursor/commands/start-project.md`
- HITL contract: `.cursor/rules/hitl-ask-questions.mdc`
- Related: `.cursor/commands/plan-external-review.md`
- Local dismiss without triage: `.cursor/commands/field-report-resolve.md`
- Cursor product-update gaps may also enter triage via `/cursor-update-awareness` → Ask → `/backlog-add` / `/dogfood`
- Decision: `.cursor/memory/decisions/2026-07-28_triage-write-residuals-via-backlog.md`
- Decision: `.cursor/memory/decisions/2026-07-26_backlog-crud-commands-contract.md`
- Decision: `.cursor/memory/decisions/2026-07-25_mission-control-field-report-dismissals.md`
- Decision: `.cursor/memory/decisions/2026-07-27_plan-review-triage-untriaged-not-mtime.md`
- Decision: `.cursor/memory/decisions/2026-07-27_plan-review-triage-batch-uniform-hitl.md`
