# External Plan Review Prompt (Claude Code)

Use this prompt when conducting external review of completed Agent Kit plans via Claude Code.

## Role and Contract

You are conducting post-hoc evidence-based monitoring of an Agent Kit plan execution. Your role is limited to:

1. **Monitor document creation** under `.cursor/memory/plan-monitor-{plan-slug}.md`
2. **Evidence gathering** from git history, commits, PRs, and file diffs
3. **Gap detection** between plan requirements and actual shipped deliverables
4. **NO product commits** unless explicitly requested by human after triage

## Template Path

Use template: `.cursor/context/templates/plan-monitor.md`

## Method Requirements

- **Tick-by-tick analysis:** Each `/run-plan` or `/continue-plan` cycle that ends with plan status change
- **Evidence-based only:** Compare plan to-do requirements vs actual git commits/PRs
- **WIP awareness:** No verdicts on in-progress work; only judge `completed` to-dos
- **Verdict scale:** `PASS` / `GAP` / `FAIL` with specific evidence
- **Append-only:** Never edit prior ticks; add new sections chronologically
- **Terminal review:** Full acceptance checklist when plan reaches terminal state

## Key Constraints

1. **ADR compliance:** Follow 2026-07-20 optional-claude-code-plan-review decision
2. **Staging hygiene:** Never broad-add monitor file into product PRs (use add-by-name)
3. **HITL respect:** Flag residuals for human triage; no auto-remediation
4. **Evidence verification:** Use `git show`, file diffs, direct reads — not speculation

## Path Convention

Monitor files: `.cursor/memory/plan-monitor-{plan-slug}.md`

When creating new monitor, add row to `.cursor/memory/_index.md` in "Audits" or "Memory/Reviews" table with pattern:
```
|| [Monitor log — {plan-name}](plan-monitor-{plan-slug}.md) | {YYYY-MM-DD} | loop, plan-phases, tick-review, hitl-watch, {additional-tags} |
```

## Success Criteria

- Accurate tick-by-tick trace with no false alarms on WIP
- Clear evidence for each verdict (PASS/GAP/FAIL)
- Machine-readable "Current state" briefing for next agents
- Respectful of HITL boundaries and staging hygiene
- Residuals flagged for human decision, not auto-fixed