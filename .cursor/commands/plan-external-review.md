# Command: /plan-external-review

## Goal

Manually arm **optional external plan review** via Claude Code after `/run-plan` has exhausted implementable to-dos. Claude writes an evidence-based monitor under `.cursor/memory/plan-monitor-*.md`. Cursor triage of findings is a **later** step (not this command).

## When to Use

- `/run-plan` (or headless `agent-kit run-plan`) reached plan exhausted / no implementable to-dos left
- You want a second-agent check of shipped work vs the plan (gaps, residuals)
- Auto-arm from the exhausted path was skipped (opt-in off, no `claude` on PATH, script tip only) or you prefer a manual re-run

**Wired path:** when `/run-plan` (orchestrated / in-session) or headless `agent-kit run-plan` stops on plan exhausted, the kit arms or suggests `.cursor/scripts/plan-external-review.sh` (see `/run-plan` "Optional external plan review"). Use this command when you need to re-arm manually. Still not a Cursor `hooks.json` `stop` entry.

Do **not** use this mid-plan for in-flight to-dos; the monitor method only verdicts `completed` work.

## Prefight

Before arming, confirm relative to the repo root:

1. Launcher: `.cursor/scripts/plan-external-review.sh` (fallback `scripts/plan-external-review.sh`)
2. Prompt: `.cursor/context/templates/plan-external-review-prompt.md`
3. Monitor scaffold: `.cursor/context/templates/plan-monitor.md`

If any are missing: stop. Do **not** claim a review ran. Tell the user to run `agent-kit update --refresh` (L0 ships these; a legacy manifest `protected` entry of `.cursor/context/**` used to block templates until the kit expands that glob to session-only paths). Re-run this command after the files exist.

## Preconditions (opt-in)

1. Prefight files above exist.
2. `.cursor/context/config.json` has `externalPlanReview.enabled: true` (see `config.example.json`), **or** use `--force` for a one-shot arm without persisting opt-in. Missing file = disabled unless `--force`.
3. Claude Code CLI (`claude`) on PATH for auto-launch; if missing, use the paste fallback below.

## Manual arm

### A. Script (preferred)

```bash
# Default: non-interactive claude -p (verified CLI flag)
.cursor/scripts/plan-external-review.sh

# One-shot without persisting enabled
.cursor/scripts/plan-external-review.sh --force

# Interactive session in the Cursor terminal
.cursor/scripts/plan-external-review.sh --interactive

# Print ready-to-paste prompt only
.cursor/scripts/plan-external-review.sh --paste-only

# Explicit plan file (else resolved from .cursor/HANDOFF.md Plan: line)
.cursor/scripts/plan-external-review.sh optional_claude_code_plan_review_2026_07_20.plan.md
```

Compatibility wrapper: `scripts/plan-external-review.sh` forwards to `.cursor/scripts/`.

Script behavior (ADR):

- Disabled / missing config → tip + exit 0 (does not fail the plan run)
- Missing template → tip + exit 0 (suggest `agent-kit update --refresh`)
- `claude` missing → tip + exit 0
- Never `/git-prod`; never broad `git add`
- Does **not** register a Cursor native `stop` hook

### B. Paste fallback

1. Open a Cursor terminal in the repo root.
2. Run `claude` (interactive).
3. Paste a short prompt that points at:
   - `.cursor/context/templates/plan-external-review-prompt.md`
   - Active plan under `.cursor/plans/`
   - `.cursor/HANDOFF.md`
   - `git rev-parse HEAD`
4. Or: `.cursor/scripts/plan-external-review.sh --paste-only` and paste the printed block.

## What Claude should produce

- Monitor file: `.cursor/memory/plan-monitor-<plan-slug>.md` (template: `plan-monitor.md`)
- Index row in `.cursor/memory/_index.md` when creating a new monitor
- No product commits unless a human asks after triage

## Cursor triage (next step)

This command does **not** require Ask questions to launch Claude.

After the monitor exists, **next step:** `/plan-review-triage` to process findings. That command reads the monitor, summarizes residuals, and offers options (write residuals plan / fix nits only / ack and stop) via Ask questions. Do not auto-implement from Claude findings without HITL. If no `plan-monitor-*.md` exists, say so and stop (nothing to triage).

## References

- ADR: `.cursor/memory/decisions/2026-07-20_optional-claude-code-plan-review.md`
- Related: `.cursor/memory/decisions/2026-07-19_stop-hook-no-hitl-interference.md` (no stop-hook auto agent)
- Prompt: `.cursor/context/templates/plan-external-review-prompt.md`
- Monitor template: `.cursor/context/templates/plan-monitor.md`
- Config sketch: `.cursor/context/config.example.json`
- Launcher: `.cursor/scripts/plan-external-review.sh`

## HITL invariants

- Never `/git-prod` from this path
- Staging monitor artifacts with add-by-name only (do not sweep into unrelated PRs)
- Ask questions belongs to triage, not to launching Claude
