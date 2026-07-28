# Command: /plan-review-triage

## Goal

Triage residuals from a **Claude external plan review** monitor. Select the right monitor(s) (untriaged / explicit paths, **not** raw mtime), summarize open residuals, and guide next steps with **Ask questions**.

Supports **multi-path walk**: iterate multiple monitors in blocking-first then debt order when given several report paths (for example from Field Report **Review all**, or the path list printed by `/plan-external-review` after a batch). When remaining monitors share a **uniform** outcome class, use **one** batch Ask (still write a durable triage heading on every target). Mixed outcomes fall back to sequential Asks.

## When to Use

- After Claude external plan review completed (monitor file exists under `.cursor/memory/plan-monitor-*.md`)
- You want to process findings from the monitor and decide next steps
- **Automatic after chat arm:** `/run-plan` / `/plan-external-review` (and `/run-plan-all` queue-end) wait for the monitor then continue into this command's Ask; operators should not need to type `done` or paste triage solely to resume
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

When paths are provided, the agent walks them in the given order (blocking first, then debt when auto-ordered by **Review all**). After gap-aware skip, if two or more monitors still need a decision and share a **uniform** outcome class, use **one** Ask for the set (batch Ack or one residuals summary); otherwise Ask **per** monitor. Every decided monitor still gets its own durable triage heading.

**Do not rely on bare `/plan-review-triage` after a batch external review** when the launcher (or Claude closeout) already printed explicit monitor paths: paste that path list so triage cannot miss the files just written.

### Gap-aware skip (multi-path)

Before Asking on a path, skip with a **one-line note** (do not abort the walk) when any of these hold:

| Skip when | One-line note example |
|-----------|------------------------|
| Already triaged (`## Triage note` / `## Follow-up plan` / `## Residuals plan`) | `Skip plan-monitor-x.md: already triaged` |
| No open gaps (empty Still open / no residual items / clean Outcome) | `Skip plan-monitor-x.md: no open residuals` |
| Path missing or not a `plan-monitor-*.md` under `.cursor/memory/` | `Skip <path>: not a monitor file` |

Field Report **Review all** already pastes a gap-filtered path list; the skip rules above are defensive for hand-built multi-path lists. Per-row **Copy triage command** remains available for intentional one-monitor triage of a clean or already-visible row.

## Preconditions

- When no paths provided: at least one **untriaged** monitor exists under `.cursor/memory/plan-monitor-*.md` (or git shows new/staged monitors that still need a triage heading)
- When paths provided: each path points to an existing file matching `plan-monitor-*.md` under `.cursor/memory/`; nonexistent or non-monitor paths are skipped with a one-line note without aborting the walk
- Monitor has "Current state" or "Full review" section with residuals
- Plan referenced in the monitor has exhausted implementable to-dos

If no `plan-monitor-*.md` exists (and no paths given), say so once, suggest `/plan-external-review` after prefight files exist, and **stop**. Do not invent residuals.

If monitors exist but **all** are already triaged (and none are new/staged without a heading), say so once, suggest Field Report **Review all** or `/plan-external-review` if new reviews are owed, and **stop**. Do not invent residuals from an already-acked file.

## What to Do

### Step 1: Read the monitor

When **no paths provided** (select targets; **never** "newest mtime wins" alone):

**Selection order** (stop at the first non-empty set; then walk that set like multi-path):

1. **Git-fresh:** `git status` / staged / untracked `.cursor/memory/plan-monitor-*.md` that lack a triage heading (`## Triage note` / `## Follow-up plan` / `## Residuals plan`).
2. **HANDOFF-aligned:** monitor paths for plans named in HANDOFF `- **Run queue:**` / queue outcomes / Gaps when those monitors exist and are still untriaged.
3. **Untriaged scan:** all `.cursor/memory/plan-monitor-*.md` without a triage heading. Prefer those with open gaps (numbered Residual items, non-empty Still open, substantive Standing finding; same spirit as Field Report `reportHasOpenReviewGaps`), but still include clean untriaged files so the operator can **Ack and stop**. If several match, walk them (blocking/debt order when obvious; otherwise newest **content** review date, then mtime as a weak tie-break only).
4. **Hard stop:** if every candidate is already triaged, report "no untriaged monitors" and stop. Do **not** Ask on an already-triaged file just because its mtime is newest.

**Gap-aware skip** (empty Still open / no residual items) applies to **explicit multi-path** lists (e.g. Field Report **Review all**). Bare-command selection above does **not** skip clean untriaged monitors: they still need a durable triage heading.

**Then read the selected set:**

1. **Delegate to a Task(explore) subagent** using the command-worker-prompt template:
   - Fill the template fields:
     - **Command:** `/plan-review-triage`
     - **Task description:** "Select triage targets under `.cursor/memory/plan-monitor-*.md` using selection order: (1) git-fresh untriaged, (2) HANDOFF-aligned untriaged, (3) all untriaged (prefer open gaps). Do **not** choose solely by mtime. Return structured summaries for each selected path (Current state, Full review, Still open, Standing findings). If none qualify, say so."
     - **read_scope:** `[".cursor/memory/plan-monitor-*.md", ".cursor/HANDOFF.md"]`
     - **worker_contract:** "selected paths + per-monitor structured summary: plan name, closed items, still-open items (with IDs), standing findings, triaged yes/no"
     - **max_ticks:** 1
   - Dispatch Task(explore)
   - Read the worker summary
2. **Fallback:** when Task dispatch is unavailable, perform the same selection order inline (do not glob-sort by mtime and stop on the first file).

When one path is selected, continue with Steps 2-5. When several are selected, use Step 6 (multi-path walk).

When **paths provided**:

1. Treat paths as an ordered list: blocking paths first, debt paths second (same order as the **Review all** copy target).
2. For each path, apply **Gap-aware skip** (above). Only remaining gap monitors get a Task(explore) dispatch (or batch them in one worker if multiple paths).
3. **Fallback:** when Task dispatch is unavailable, verify each path is an existing file under `.cursor/memory/` matching `plan-monitor-*.md`. Non-existent, non-monitor, already-triaged, or no-open-residual paths are skipped with a one-line note; the walk continues.
4. Read the worker summary for each path that was not skipped.

### Step 2: Summarize for the user

Present a concise summary:
> **Plan monitor findings for `[plan-name]`:**
> 
> **Closed:** [brief list of completed items]
> 
> **Still open:** [numbered list of residuals with IDs from monitor]

### Step 3: Ask for triage decision

Use **Ask questions** tool with these exact options:

> "How to handle the open residuals?"

Options: `Write residuals plan` / `Fix nits only` / `Ack and stop`

**Chat fallback:** if Ask questions tool unavailable, ask the same options in chat with clear labeling.

### Step 4: Persist a durable triage heading (required for every outcome)

After the human chooses, **append** to the monitor file (agent turn writes the file; Mission Control never auto-writes):

```markdown
## Triage note

- **Date:** YYYY-MM-DD
- **Choice:** Write residuals plan | Fix nits only | Ack and stop
- **Summary:** [one line]
```

Rules:

1. **All three outcomes** write this heading (or an equivalent `## Follow-up plan` / `## Residuals plan` heading when a residuals plan is created).
2. **Ack and stop** must write the heading on the monitor. Updating HANDOFF alone is **not** enough: Field Report uses `isReportTriaged`, which looks for a triage heading (or a follow-up plan reference). Without the heading, the row stays untriaged.
3. Keep HITL: do not invent a choice; do not write the heading before the user picks an option.
4. Prefer appending once near the end of the file; do not delete prior review evidence.

### Step 5: Execute the choice

#### A. `Write residuals plan`

Enqueue residuals in-session via the `/backlog-add` contract (ADR `decisions/2026-07-28_triage-write-residuals-via-backlog.md`). Do **not** end on a clipboard `/start-project` paste as the happy path.

1. Persist the triage heading (Step 4) with Choice `Write residuals plan`. After the plan file exists, prefer upgrading or appending `## Residuals plan` / `## Follow-up plan` with the plan basename (durable heading on the monitor still required).

2. **Propose** a residuals plan from this monitor's Still open (and include-worthy Standing findings). Post-triage intake is the monitor: full Broad Intake scan is N/A (same spirit as `/backlog-add` once the goal is concrete).

3. **Ask write confirm** with Ask questions (chat numbered-list fallback). Exact options:
   - `Write plan to backlog`
   - `Modify proposal first`
   - `Cancel`

4. **Cancel / skipped answer:** stop. Triage heading already written; no plan file or Backlog HANDOFF edit.

5. **Modify:** revise the proposal, ask again.

6. **Write plan to backlog:**
   1. Create `.cursor/plans/<name>.plan.md` with frontmatter to-dos (template: `.cursor/context/templates/plan.md`).
   2. Append the basename under HANDOFF `- **Backlog plans:**` (bullet field only; never a bare `## Backlog plans` heading).
   3. **Never** park, activate, offer Gate B, invent Field Report cards for routine enqueue, or rewrite `- **Run queue:**` / queue cursor / status / outcomes.
   4. Stop. Tell the operator the plan path; resume later via `/continue-plan` or queue inclusion (`/run-plan-all`), not Gate B.

7. **Escape hatch only:** if the operator explicitly wants activate + Gate B, they may run `/start-project` themselves. That is optional; it is **not** the default close after Write residuals plan.

#### B. `Fix nits only`

1. Persist the triage heading (Step 4) with Choice `Fix nits only`.

2. **Confirm scope** with specific item list from monitor:
   > "Fixing these nits only: [list]. Proceed?"

3. **On confirmation:** implement only the small fixes listed as "nits" 
   - Typically: typos, formatting, small doc updates, obvious omissions
   - **Never:** architecture changes, new features, or multi-file refactors

4. **After fixes:** suggest `/git-staging` if there are changes

5. **Warn about multi-phase:** if fixes look substantial, stop and redirect to "Write residuals plan" instead

#### C. `Ack and stop`

1. Persist the triage heading (Step 4) with Choice `Ack and stop` so the Field Report row clears.

2. **Optionally update HANDOFF** with a short note. Keep `- **Gaps:**` natural (`none` or one residual); do **not** dump monitor paths, cadence ids, or mid-batch audit plumbing into Gaps (Flight Log voice; ADR `2026-07-27_mc-flight-log-panel.md`). Example Instruction (not Gaps body):
   ```
   Monitor reviewed; residuals acknowledged. No immediate action.
   ```

3. **No product edits** beyond the monitor heading (and optional HANDOFF note)

4. **Confirm status:** monitor findings noted; triage heading written

### Step 6: Multi-path walk (paths provided **or** Step 1 selected a set)

When multiple report paths are in scope (explicit args **or** bare-command selection), the agent applies Steps 2-5 after gap-aware skip. Rules:

1. **Uniform batch HITL** - after skip, if **two or more** monitors still need a triage decision and their open residuals share the **same outcome class** (all Ack-and-stop, or all write-one-residuals / fix-nits for the shared set), present **one** Ask questions gate for the whole set. Do **not** require N identical replies. ADR: `decisions/2026-07-27_plan-review-triage-batch-uniform-hitl.md`.
2. **Mixed → sequential fallback** - if outcome classes differ, or the operator chooses a per-file path, Ask **per** monitor (legacy walk).
3. **No silent Ack** - every triage decision (batch or per-file) requires Ask questions (or chat numbered-list fallback). Never invent Ack without HITL.
4. **Durable heading on every target** - after the chosen outcome, write `## Triage note` (or Follow-up / Residuals) on **each** monitor in the decided set before finishing. Batch Ack that updates only the first file is invalid.
5. **Batch Write residuals** - when the uniform choice is Write residuals plan, propose **one** combined residuals plan from the set's Still open items, then one backlog write-confirm Ask (`Write plan to backlog` / `Modify` / `Cancel`). On write, enqueue once and reference that plan path from each monitor's Residuals / Triage heading. Sequential/mixed walks may enqueue per monitor. Never require a second `/start-project` paste after the backlog write.
6. **Stopping contract** - if the human stops mid-walk (disagrees, changes mind, or says stop), the walk stops at that point. Completed monitors keep their triage headings; remaining monitors stay untriaged.
7. **Path skipping** - non-existent or non-monitor paths are skipped with a one-line note. The walk continues to the next valid path.

## Hard stops

1. **Never treat Claude monitor as execute permission** - all paths require human confirmation
2. **Never `/git-prod`** from this command - residual fixes go through `/git-staging` only  
3. **Never auto-implement** without the triage choice above
4. **Never skip the backlog write-confirm Ask** on Write residuals plan; never park, activate, Gate B, or rewrite Run queue from this path. Clipboard `/start-project` is **not** the happy path (optional operator escape hatch only when they want activate + Gate B)
5. **No broad scope creep** in "Fix nits only" - redirect to Write residuals plan (backlog enqueue) for substantial work
6. **Never skip the triage heading** - including Ack and stop

## Ask questions requirement

**All triage decisions MUST use Ask questions tool** per kit-wide contract (`.cursor/rules/hitl-ask-questions.mdc`). This creates clickable options in the IDE UI.

**Chat fallback only** if the tool is unavailable in the current session.

## Example flow - Bare command (untriaged selection)

```
User: /plan-review-triage
Agent: Selection: git-fresh untriaged → plan-monitor-auth-api.md
       (skipped plan-monitor-run-plan-all.md: already triaged; mtime newer but ineligible)

       Plan monitor findings for auth-api plan:
       
       Closed: JWT middleware, refresh tokens, basic tests
       
       Still open:
       A. Rate limiting missing from login endpoint
       B. Password strength validation not implemented  
       C. API docs missing error response formats
       
       [Ask questions: How to handle residuals? Options: Write residuals plan / Fix nits only / Ack and stop]
User: [clicks Write residuals plan]
Agent: Appends ## Triage note to the monitor, proposes a residuals plan from Still open,
       then Ask: Write plan to backlog / Modify proposal first / Cancel.
User: [clicks Write plan to backlog]
Agent: Writes `.cursor/plans/auth-api-residuals.plan.md`, appends it under HANDOFF
       `- **Backlog plans:**`, upgrades monitor heading with the plan path, and stops.
       Plan is on Backlog (no Gate B). Resume later with `/continue-plan` or queue inclusion.
       (Optional escape hatch: operator may still run `/start-project` for activate + Gate B.)
```

## Example flow - Multi-path walk

```
User: /plan-review-triage .cursor/memory/plan-monitor-auth.md .cursor/memory/plan-monitor-ui.md
Agent: Both monitors share Write-residuals outcome class → one batch Ask.
User: [clicks Write residuals plan]
Agent: One combined residuals proposal → Ask Write plan to backlog / Modify / Cancel.
User: [clicks Write plan to backlog]
Agent: Writes one plan file + Backlog row; ## Residuals plan (or Triage note) on each monitor
       referencing that path. No `/start-project` paste. Mixed outcomes stay sequential.
```

## References

- Monitor template: `.cursor/context/templates/plan-monitor.md`
- Residuals enqueue: `.cursor/commands/backlog-add.md` (write-confirm Ask + Backlog HANDOFF)
- Optional activate + Gate B: `.cursor/commands/start-project.md`
- HITL contract: `.cursor/rules/hitl-ask-questions.mdc`
- Related: `.cursor/commands/plan-external-review.md`
- Local dismiss without triage: `.cursor/commands/field-report-resolve.md`
- Decision: `.cursor/memory/decisions/2026-07-28_triage-write-residuals-via-backlog.md`
- Decision: `.cursor/memory/decisions/2026-07-26_backlog-crud-commands-contract.md`
- Decision: `.cursor/memory/decisions/2026-07-25_mission-control-field-report-dismissals.md`
- Decision: `.cursor/memory/decisions/2026-07-27_plan-review-triage-untriaged-not-mtime.md`
- Decision: `.cursor/memory/decisions/2026-07-27_plan-review-triage-batch-uniform-hitl.md`
