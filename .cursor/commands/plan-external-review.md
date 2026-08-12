---
name: plan-external-review
description: Arm an optional external plan audit after /run-plan exhausts its implementable to-dos.
---

# Command: /plan-external-review

## Goal

Manually arm **optional plan audits** (external plan review via Claude Code) after `/run-plan` has exhausted implementable to-dos. Claude writes an evidence-based monitor under `.cursor/memory/plan-monitor-*.md`. Cursor triage of findings is a **later** step (not this command).

## When to Use

- `/run-plan` (or headless `agent-kit run-plan`) reached plan exhausted / no implementable to-dos left
- You want a second-agent check of shipped work vs the plan (gaps, residuals)
- Auto-arm from the exhausted path was skipped (opt-in off, no `claude` on PATH, soft-fail tip) or you prefer a manual re-run

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
3. Prefer `externalPlanReview.mode: "autonomous"` for background/inspectable auto-launch. Missing `mode` keeps paste-compatible / legacy behavior.
4. Claude Code CLI (`claude`) on PATH for autonomous / interactive / headless launch; if missing, soft tip + exit 0 (Field Report stays owed). `--paste-only` still prints the command without requiring `claude` yet.

## Manual arm

### Chat vs CI (do not confuse)

| Path | What to run | Where |
|------|-------------|--------|
| Chat when `mode: "autonomous"` (or `--autonomous`) | `--force --autonomous --wait-monitor` | Spawns interactive Claude in an **inspectable background PTY** (tmux/screen preferred; macOS Terminal without `activate`; emulator last resort), then waits for a **fresh** `plan-monitor-<slug>.md`. Spawn-only without wait is not review done. |
| Chat paste fallback / legacy | `--force --paste-only` then operator pastes `--force --interactive` | User's Cursor Terminal; session still waits for a fresh monitor after Claude runs |
| Mid-batch / queue-end (`--batch`) | `--force --autonomous --wait-monitor --batch p1.plan.md p2.plan.md` (or one arm+wait per plan) | Background/inspectable spawn + wait_all; no paste Ask; no N-session fan-out without wait |
| Headless `agent-kit run-plan` | `--print` (CLI always passes it) | CI / cron agent shell (`claude -p`) |

**Agents in chat MUST NOT** exec headless `--print` / `--force` alone and claim the audit is running. That agent shell is not an inspectable audit PTY; Claude HITL can block invisibly; no monitor file appears. Prefer `--autonomous` (background PTY). Use `--paste-only` only when background spawn is unavailable or the operator opts out. Background PTY ≠ banned invisible agent-shell `-p` (ADR `2026-07-28_audits-headless-terminal-honesty.md`).

### What "operator-visible" means (smoke notes)

- **Autonomous success:** chat arm **must** use `--force --autonomous --wait-monitor`. The launcher prefers a background/inspectable PTY (no OS Terminal focus by default; `--focus-terminal` / `AGENT_KIT_AUDIT_FOCUS_TERMINAL=1` restores activate), then polls until a **fresh** monitor exists (`mtime >= arm epoch` or the HTML comment sentinel `<!-- audits-wait-fresh: created|updated -->` written into the monitor). Exit `0` = fresh ready; `3` = timeout; `4` = soft-fail while waiting. Spawn-only exit 0 without wait is **not** review done. **Chat continuation:** AwaitShell until `0|3|4`; on `0` run `/plan-review-triage` Ask in the same session. Do **not** stop at Final HANDOFF "after monitor lands" or require typing `done`. ADR: `decisions/2026-07-27_audits-wait-freshness-enforce.md`.
- **Autonomous soft-fail:** missing `claude` → tip + exit `4` when `--wait-monitor` was requested (Field Report owed). Background spawn unavailable → falls back to `--paste-only` UX with an honest "NOT running yet" banner. A **silent PTY** (spawn succeeded, no scrollback within the progress-gate grace window) is reported as a failed launch: the launcher disposes the session it just spawned, prints the paste fallback, and soft-fails instead of burning the wait budget. A **session-cap refusal** (detached `agent-kit-audit-*` sessions at the cap) never spawns at all. Soft-fail does **not** invent a monitor or run triage as if review completed.
- **Exit 3 is timeout-only:** it means the freshness gate was not satisfied inside the budget, never that the review finished. A monitor that appears later, including one written by a different or later arm, does **not** convert a `3` into success. Leave the target Field Report **owed** and re-arm. ADR: `decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md`.
- **Paste-only:** clipboard + printed interactive one-liner; review starts only after the operator pastes into their Cursor Terminal. After paste (Claude running), the session still waits for the monitor file then continues into triage Ask when possible.
- **`--dry-run`:** resolves mode/plan and prints `background-cmd` / `paste-cmd` / `focus-terminal` without spawning Claude (useful for smoke).

### A. Script (preferred)

```bash
# Chat / session when autonomous (mandatory wait + freshness)
.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor

# Mid-batch or queue-end batch arm (one wait_all; no paste Ask)
.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor --batch plan-a.plan.md plan-b.plan.md

# Legacy paste fallback (clipboard + print; does NOT start Claude)
.cursor/scripts/plan-external-review.sh --force --paste-only

# Then paste this in YOUR Cursor terminal (script prints/copies it):
.cursor/scripts/plan-external-review.sh --force --interactive YOUR-PLAN.plan.md

# Optional rollback: focus OS Terminal window
.cursor/scripts/plan-external-review.sh --force --autonomous --focus-terminal --wait-monitor

# CI / headless one-shot (claude -p; no IDE panel)
.cursor/scripts/plan-external-review.sh --force --print

# Dry-run (resolve + print strategy only)
.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor --dry-run YOUR-PLAN.plan.md

# Interactive session already in the Cursor terminal
.cursor/scripts/plan-external-review.sh --interactive

# Explicit plan file (else resolved from .cursor/HANDOFF.md Plan: line)
.cursor/scripts/plan-external-review.sh optional_claude_code_plan_review_2026_07_20.plan.md
```

Compatibility wrapper: `scripts/plan-external-review.sh` forwards to `.cursor/scripts/`.

Script behavior (ADR):

- Disabled / missing config → tip + exit 0 (does not fail the plan run)
- Missing template → tip + exit 0 (suggest `agent-kit update --refresh`)
- `claude` missing → tip + exit 0 for autonomous/print/interactive; `--paste-only` still prints the command
- `mode: "autonomous"` (non-headless) → background/inspectable PTY auto-launch; soft-fallback to paste-only
- Missing `mode` key → paste-compatible default (`--print` when no flag; chat should pass `--paste-only` or set autonomous)
- Interactive and headless launches pass Claude CLI `--permission-mode auto`
- Post-spawn progress gate: samples PTY scrollback before the monitor wait; silent PTY → early abort (`AGENT_KIT_AUDIT_PROGRESS_TIMEOUT`, default 60s, `0` disables); channels without a scrollback API stay advisory
- Session pressure: warns at `AGENT_KIT_AUDIT_SESSION_WARN` detached `agent-kit-audit-*` sessions, refuses to spawn at `AGENT_KIT_AUDIT_SESSION_CAP`; reap is opt-in (`--reap-audit-sessions`), detached-only, past `AGENT_KIT_AUDIT_REAP_MIN_AGE`
- `--paste-only` copies the interactive one-liner via `pbcopy` / `xclip` / `xsel` / `clip.exe` when available
- Never `/git-prod`; never broad `git add`
- Does **not** register a Cursor native `stop` hook

### B. Paste fallback

1. Prefer autonomous first. If spawn fails or operator opts out: `.cursor/scripts/plan-external-review.sh --force --paste-only`.
2. Open a Cursor Terminal in the repo root and paste the printed interactive command.
3. Or open `claude` and paste the optional prompt block the script prints.
4. After the monitor exists: paste the explicit `/plan-review-triage .cursor/memory/plan-monitor-<slug>.md` line printed by the launcher (or Claude closeout). Prefer that over bare `/plan-review-triage`.

## What Claude should produce

Same contract as `.cursor/context/templates/plan-external-review-prompt.md` (Claude's working prompt). Command prose must not lag the template.

- Monitor file: `.cursor/memory/plan-monitor-<plan-slug>.md` (template: `plan-monitor.md`)
- Index row in `.cursor/memory/_index.md` when creating a new monitor (target must be git-tracked; add monitor by name)
- **Delivery truth first:** for each `completed` to-do, was the claimed work actually done? Verify against code, tests, APIs, infra, Git SHAs, and published artifacts. Docs, HANDOFF, and inventories are indicative only (`docs-professional-standard`; ADR `2026-08-01_docs-indicative-delivery-truth`)
- **Finding priority** (highest first): (1) delivery truth, (2) security, (3) logic gaps, (4) bad code/practices with path-level evidence. Rank Still open / residuals by this order
- **Evidence mandate:** every `PASS` / `GAP` / `FAIL` cites at least one path, SHA, command, or artifact check
- **Forbidden filler:** do not ship restated plan text with no verification; ceremony checklists marked Met without path/SHA/command evidence; "looks good" / empty praise with no findings; decorative prose that finds nothing because nothing was checked
- No product commits unless a human asks after triage

## Cursor triage (next step)

This command does **not** require Ask questions to launch Claude.

After a successful autonomous arm in chat, **do not** hand off with "run `/plan-review-triage` later". Wait for the monitor file, then run `/plan-review-triage` Ask in the same session (explicit monitor path(s) preferred). Paste-only: wait starts after the operator pastes and Claude is writing. Bare `/plan-review-triage` selects untriaged / git-fresh monitors, but path paste remains the reliable post-batch path. For **multiple** fresh paths (batch arm or Field Report **Review all**), paste the full path list once; `/plan-review-triage` uses **one** Ask when outcomes are uniform (durable heading on every file) and sequential Asks when mixed — do not tell the operator to "reply N times". That command summarizes residuals and offers options (write residuals plan / fix nits only / ack and stop) via Ask questions. Do not auto-implement from Claude findings without HITL. If no `plan-monitor-*.md` exists after timeout/soft-fail, say so and stop (nothing to triage; Field Report owed).

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
