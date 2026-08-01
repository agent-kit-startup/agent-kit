# Handoff - [Task Name]

Machine fields below must stay as `- **Field:**` bullets (Mission Control parses those). Do not replace Backlog / Parked / Run queue with `##` section headings alone.

- **Plan:** `file.plan.md`
- **Last updated:** [YYYY-MM-DD HH:MM]
- **Mode:** [manual | run-plan (orchestrated) | run-plan (in-session loop) | run-plan-all]
- **Phase completed:** [N]
- **Next phase:** [N+1]
- **Completed to-dos:** [list of ids]
- **Next to-dos:** [ids]
- **Gaps:** [none | short list of open residuals, blockers, or stop reasons]
- **Instruction for the next agent:** [1–3 clear sentences]

### Gaps voice (Flight Log)

`- **Gaps:**` is operator residuals for Mission Control Flight Log (NOW / Earlier), not a system-status dump. Flight Log uses palette-by-type notification chrome (`ok` / `advice` / `prompt` / `residual` / `warning`); OK must not look like a yellow residual debit.

| Say | Avoid |
|-----|--------|
| Short open residuals the next human can act on | Field Report cadence WARNING ids |
| Named blocker or stop reason + recovery cursor | Mid-batch monitor path dumps |
| Exact `none` when audits/queue plumbing is the only noise | `/git-prod` suggestion boilerplate as Gaps body |
| | Review all / Resolve all / Copy review chatter |
| | `none. Residuals…` / `none. Mid-batch…` (OK + pointer in Gaps body) |

**Before / after:** queue exhausted or mid-batch → prefer exact `none` (audits are not Gaps; put pointers in Instruction). Residuals after triage → short enqueue note, not a full Still-open table. See ADR `2026-07-27_mc-flight-log-panel.md`.

### Mode vocabulary

| Situation | Recommended `- **Mode:**` value |
|-----------|-------------------------------|
| Manual `/continue-plan` | `manual` |
| Continuous run, orchestrated | `run-plan (orchestrated)` |
| Continuous run, in-session loop | `run-plan (in-session loop)` |
| Multi-plan queue | `run-plan-all` |
| API / usage limit hard stop | `[prior mode] — STOPPED: API/usage limit` (example: `run-plan (orchestrated) — STOPPED: API/usage limit`) |

Mission Control treats Mode containing `STOPPED` or `exhausted` as terminal. On quota stops, also set `- **Gaps:**` to the stop reason and recovery cursor.

## Work Status

- **In progress:** [what is being worked on now]
- **Pending:** [next steps or items not yet started]
- **Blockers:** [impediments, dependencies or pending decisions - leave empty if none]
- **Backlog plans:**
  - `other-plan.plan.md`
- **Parked plans:** none

## Session Context

- **Branch:** [current branch name]
- **Uncommitted:** [summary of what was not committed, e.g.: "2 files modified in docs/"]
- **References:** [links to STATE.md, Context Pack or critical files, e.g.: `file:line`]

## Files Touched

- [file1] - [action]
- [file2] - [action]

## Decisions Made

- [decision 1] - [rationale]

## Issues Found

- [issue] - [status: resolved|pending]

---

## Run queue (multi-plan only)

When using `/run-plan-all`, persist queue state as the same bullet fields (not a heading-only section):

- **Mode:** run-plan-all
- **Run queue:** [plan-a.plan.md, plan-b.plan.md, plan-c.plan.md]
- **Queue cursor:** N (current: plan-x.plan.md)
- **Queue status:** running | paused | blocked | exhausted
- **Queue outcomes:**
  - plan-x.plan.md: completed (last to-do id, notes)
- **Gaps:** [none | queue-level stop reason]

*Keep handoff concise (~500 tokens) when possible; prioritize actionable information and file:line references.*
