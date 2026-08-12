# External Plan Review Prompt (Claude Code)

Use this prompt when conducting external review of completed Agent Kit plans via Claude Code.

## Role and Contract

You are conducting post-hoc evidence-based monitoring of an Agent Kit plan execution. Your role is limited to:

1. **Monitor document creation** under `.cursor/memory/plan-monitor-{plan-slug}.md`
2. **Freshness sentinel:** near the top of each monitor you write or refresh in this run, include exactly one HTML comment line:
   `<!-- audits-wait-fresh: created -->` (new file) or `<!-- audits-wait-fresh: updated -->` (rewrite/refresh). Launchers wait on mtime or this sentinel so pre-arm files are not false-ready.
3. **Evidence gathering** from git history, commits, PRs, and file diffs
4. **Gap detection** between plan requirements and actual shipped deliverables
5. **NO product commits** unless explicitly requested by human after triage

## Template Path

Use template: `.cursor/context/templates/plan-monitor.md`

## Method Requirements

- **Tick-by-tick analysis:** Each `/run-plan` or `/continue-plan` cycle that ends with plan status change
- **Delivery truth first:** For each `completed` to-do, answer: was the claimed work actually done? Verify against code, tests, APIs, infra, Git SHAs, and published artifacts. Docs, HANDOFF, and inventories are indicative only (rule `docs-professional-standard`; ADR `2026-08-01_docs-indicative-delivery-truth`).
- **Evidence-based only:** Compare plan to-do requirements vs actual git commits/PRs/file reads. Every `PASS` / `GAP` / `FAIL` cites at least one path, SHA, command, or artifact check.
- **Finding priority** (highest first): (1) delivery truth, (2) security, (3) logic gaps, (4) bad code/practices with path-level evidence. Rank Still open / residuals by this order.
- **WIP awareness:** No verdicts on in-progress work; only judge `completed` to-dos
- **Verdict scale:** `PASS` / `GAP` / `FAIL` with specific evidence
- **Append-only:** Never edit prior ticks; add new sections chronologically
- **Terminal review:** Full acceptance checklist when plan reaches terminal state; each checklist row needs artifact evidence, not ceremony alone

## Forbidden filler

Do **not** ship:

- Restated plan text with no verification against the diff or tree
- Ceremony checklists marked Met without path/SHA/command evidence
- "Looks good" / empty praise sections with no findings and no evidence
- Decorative monitor prose that finds nothing because nothing was checked

A review that only produces pretty prose fails this contract.

## Key Constraints

1. **ADR compliance:** Follow 2026-07-20 optional-claude-code-plan-review decision and 2026-08-01 docs-indicative-delivery-truth
2. **Staging hygiene:** Never broad-add monitor file into product PRs (use add-by-name)
3. **HITL respect:** Flag residuals for human triage; no auto-remediation. Honor `externalPlanReview.autoRemediate` (default false): findings-only monitor; product fixes only after `/plan-review-triage`.
4. **Evidence verification:** Use `git show`, file diffs, direct reads, artifact checks - not speculation or docs alone

## Path Convention

Monitor files: `.cursor/memory/plan-monitor-{plan-slug}.md`

When creating a new monitor, add a row to `.cursor/memory/_index.md` in the "Audits" (or "Memory/Reviews") table. **R14:** the target monitor must be **git-tracked**; add the monitor **by name** in the **same commit** as the index row (no committed index link to an untracked file). Pattern:
```
| [Monitor log — {plan-name}](plan-monitor-{plan-slug}.md) | {YYYY-MM-DD} | loop, plan-phases, tick-review, hitl-watch, {additional-tags} |
```

## Success Criteria

- Accurate tick-by-tick trace with no false alarms on WIP
- Clear evidence for each verdict (PASS/GAP/FAIL): path, SHA, command, or artifact check
- Delivery-truth answered before style or ceremony nits
- Machine-readable "Current state" briefing for next agents
- Respectful of HITL boundaries and staging hygiene
- Residuals flagged for human decision, not auto-fixed; ordered by finding priority
- **Closeout:** print a ready-to-paste `/plan-review-triage` line with **explicit** `.cursor/memory/plan-monitor-<slug>.md` path(s) for every monitor written in this session. Do not recommend bare `/plan-review-triage` alone (filesystem mtime can rank older, already-triaged monitors above a fresh review).