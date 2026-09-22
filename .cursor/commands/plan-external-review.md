---
name: plan-external-review
description: Arm an optional external plan audit after /run-plan exhausts its implementable to-dos.
---

# Command: /plan-external-review

## Goal

Manually arm **optional plan audits** (external plan review via Claude Code or Cursor Agent) after `/run-plan` has exhausted implementable to-dos. The reviewer writes an evidence-based monitor under `.cursor/memory/plan-monitor-*.md`. Cursor triage of findings is a **later** step (not this command).

## When to Use

- `/run-plan` (or headless `agent-kit run-plan`) reached plan exhausted / no implementable to-dos left
- You want a second-agent check of shipped work vs the plan (gaps, residuals)
- Auto-arm from the exhausted path was skipped (opt-in off, no `claude` on PATH, soft-fail tip) or you prefer a manual re-run

**Daily path:** `/run-plan` and `/run-plan-all` invoke this contract when audits are enabled (arm + `--wait-monitor`). Use this slash for paste, manual re-arm, or when auto-arm was skipped. Still not a Cursor `hooks.json` `stop` entry. ADR `2026-08-14_main-command-dogfood-audit-routing.md`.

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
3. Prefer `externalPlanReview.mode: "autonomous"` for background/inspectable auto-launch. Missing `mode` keeps paste-compatible / legacy behavior.
4. A usable reviewer: `backend: "auto"` (default for new example/docs) uses Claude when present, else Cursor Agent. Pinned `backend: "claude"` still tips + no-op when Claude is missing.
   Pinned `backend: "cloud"` (Cursor Cloud Agents over REST) needs `curl`, `node`, and `CURSOR_API_KEY`, and reviews the **pushed** branch — it soft-fails rather than auditing unpushed state, and is never reached by `"auto"`. `--paste-only` still prints the command without requiring a binary yet. Same-family implementer and reviewer is an honest skip (including Auto/Auto).
   Claude review uses `reviewerModel` (default `sonnet` so `--permission-mode auto` can run); `advisorModel` (default `opus`) runs only on escalate. An explicit Haiku pin is valid and cannot run auto.


## Manual arm

Script commands, the chat-vs-CI table, and the full autonomous/paste-only smoke notes: [procedure.md](../skills/core/plan-external-review/procedure.md).

- **Exit 3 is timeout-only:** it means the freshness gate was not satisfied inside the budget, never that the review finished. A monitor that appears later, including one written by a different or later arm, does **not** convert a `3` into success. Leave the target Field Report **owed** and re-arm. ADR: `decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md`.

## Cursor triage (next step)

This command does **not** require Ask questions to launch Claude.

After a successful autonomous arm in chat, **do not** hand off with "run `/plan-review-triage` later". Wait for the monitor file, then run `/plan-review-triage` Ask in the same session (explicit monitor path(s) preferred). Paste-only: wait starts after the operator pastes and Claude is writing.
Bare `/plan-review-triage` selects untriaged / git-fresh monitors, but path paste remains the reliable post-batch path. For **multiple** fresh paths (batch arm or `/run-plan-all` queue-end), paste the full path list once; `/plan-review-triage` uses **one** Ask when outcomes are uniform (durable heading on every file) and sequential Asks when mixed. Do not tell the operator to "reply N times".
That command summarizes residuals and offers options (write residuals plan / fix nits only / ack and stop) via Ask questions. Do not auto-implement from Claude findings without HITL. If no `plan-monitor-*.md` exists after timeout/soft-fail, say so and stop (nothing to triage). There is no `/field-report-review` command and no Mission Control **Review all** button.

## References

- ADR: `.cursor/memory/decisions/2026-07-20_optional-claude-code-plan-review.md`
- Audits contract: `.cursor/memory/decisions/2026-07-27_audits-autonomous-plan-review-contract.md`
- Post-spawn watch + continue: `.cursor/memory/decisions/2026-07-27_audits-post-spawn-monitor-watch-continue.md`
- PTY progress gate, session cap, exit 3 honesty: `.cursor/memory/decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md`
- Related: `.cursor/memory/decisions/2026-07-19_stop-hook-no-hitl-interference.md` (no stop-hook auto agent)
- Prompt: `.cursor/context/templates/plan-external-review-prompt.md`
- Monitor template: `.cursor/context/templates/plan-monitor.md`
- Config sketch: `.cursor/context/config.example.json`
- Launcher: `.cursor/scripts/plan-external-review.sh`

## HITL invariants

- Never `/git-prod` from this path
- Staging monitor artifacts with add-by-name only (do not sweep into unrelated PRs)
- Ask questions belongs to triage (after monitor exists), not to launching Claude
- Never silent-Ack / auto-fix from findings; never claim finished without the monitor file
