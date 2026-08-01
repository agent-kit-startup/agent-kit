# Command: /backlog-add

## Goal

Enqueue a **new plan with to-dos** under HANDOFF Backlog without activating it, parking the current plan, or offering Gate B. Same Broad Intake scan as `/start-project`; activation gates are skipped on purpose.

## When to Use

- You want a plan file and a Backlog row while the current active plan stays active
- You do not want park / activate / first-unit HITL from `/start-project`
- The goal is queueing work for later (`/continue-plan`, `/run-plan`, or `/run-plan-all`), not starting it now

## Usage

```
/backlog-add <goal>
```

Example: `/backlog-add Polish Mission Control empty-state icons`

## Hard stops

1. **Broad Intake Review first** (same buckets and triage labels as `/start-project`).
2. **Plan file + Backlog HANDOFF only** in the add turn. No product, registry, rule, or docs-of-record edits.
3. **Never park or activate.** Do not change `- **Plan:**`, phase, next to-dos, Parked list, or an in-flight Run queue.
4. **Never offer Gate B.** After write, report the path and stop.
5. **Do not invent Field Report cards** for routine enqueue.
6. **Never `/git-prod`.**

## Prepared repository

Same planning blockers as `/start-project`: unresolved essential readiness → point to `/agent-kit-onboard`. Non-essential pending is advisory only.

## What to Do

### 1. Broad Intake Review (required before plan proposal)

> **Delegation note:** The actual bucket scanning below is performed by a **Task(explore) subagent** dispatched from this step. The table defines the specification of what the worker scans. See below for the delegation pattern.

Before enqueueing a new plan, **scan** these sources (read/skim; do not deep-dive every file) and use findings for conflict triage:

| Bucket | What to check | How / typical paths |
|--------|---------------|---------------------|
| **Prepared repository** | Verified profile and readiness state | `.cursor/agent-kit.config.json`, `.cursor/context/readiness.json` |
| **Active session** | HANDOFF, Context Pack | `.cursor/HANDOFF.md`, `.cursor/context/current/` |
| **Plans** | In-progress + recent parked/related | `.cursor/plans/*.plan.md` (status in frontmatter) |
| **Archived context** | Prior packs for same theme | `.cursor/context/archive/**` (if present; glob by topic) |
| **Decisions** | ADRs that constrain the goal | `.cursor/memory/decisions/`, `_index.md` Decisions table |
| **Memory** | Errors, audits, consolidations, review logs, plan-monitors, findings audits | `.cursor/memory/errors/`, `.cursor/memory/plan-monitor-*.md`, theme-matched `plan-review-*.md`, `_index.md` (Audits + Decisions) |
| **Local docs** | SoT / inventories / getting-started that the goal touches | `docs/**`, especially files named in the payload or related SoT |
| **Working tree** | Uncommitted local work that would collide | `git status`, `git diff` (staged + unstaged); do not commit |
| **Recent commits** | What already shipped for this theme | `git log` (short, recent), related PR titles if available |
| **Product version** | Avoid stale version prose | `package.json`, `CHANGELOG.md` `[Unreleased]` / latest |

**Triage labels** (every relevant finding gets one):

- **ignore**: already a future/pending to-do on an active or parked plan; leave for `/continue-plan`. For plan-monitors: owned by another open plan, or already triaged clean (`## Triage note` / follow-up / residuals-plan heading)
- **error**: completed work that overreached, contradicted HITL, or left a verifiable residual → **include** in the new plan. For plan-monitors: GAP or regression vs claimed-complete work
- **include**: new scope from the user payload, or residual not owned by another plan. For plan-monitors: open residual not owned by an active/backlog plan
- **note**: operational gap (e.g. monitor misses tags); record in plan Constraints / Acceptance or memory, no code unless asked. For plan-monitors: outdated vs HEAD, freshness caveat, or staging-hygiene risk (dirty untracked monitors)

Do not invent a fifth triage label. Field Report and `/plan-review-triage` remain attention/HITL SoT; Broad Intake consults monitors as evidence only (ADR `decisions/2026-07-27_plan-monitor-consumer-awareness.md`).

The actual scanning and triage is delegated to a **Task(explore) subagent** using the worker prompt template at `.cursor/context/templates/command-worker-prompt.md`.

1. **Fill the template** — set these parameters:
   - **Repo:** `[absolute repo path]`
   - **Command:** `/backlog-add`
   - **Task description:** "Scan the 9 Broad Intake buckets (prepared repository, active session, plans, archived context, decisions, memory, local docs, working tree, recent commits, product version) and return a structured triage report with findings per bucket, each labeled ignore/error/include/note."
   - **read_scope:** `[".cursor/agent-kit.config.json", ".cursor/context/readiness.json", ".cursor/HANDOFF.md", ".cursor/context/current/", ".cursor/plans/*.plan.md", ".cursor/context/archive/**", ".cursor/memory/decisions/", ".cursor/memory/errors/", ".cursor/memory/plan-monitor-*.md", ".cursor/memory/plan-review-*.md", ".cursor/memory/_index.md", "docs/**", "package.json", "CHANGELOG.md"]`
   - **worker_contract:** "structured triage report: list of findings per bucket with triage labels (ignore/error/include/note)"
   - **max_ticks:** 2

2. **Dispatch** a Task subagent with `subagent_type: explore`.

3. **Read the worker summary** — the main window uses the triage findings for conflict triage in Step 2 (vague goals) and Step 3 (propose and confirm write).

**Fallback:** If Task dispatch is unavailable, run the Broad Intake Review inline (same as pre-delegation behavior).

### 2. Vague goal

If the goal is missing or vague, use **Ask questions** (chat numbered-list fallback):
> "What's the goal to put on the backlog? (1-2 sentences)"

Wait before proposing.

### 3. Propose and confirm write

1. Propose phases and to-dos (align with `autogit/plan-routine.md` and `.cursor/context/templates/plan.md`).
2. Ask with **Ask questions** (one list; chat fallback if the tool is missing):

   > "Write this plan to backlog (keep current active plan; no Gate B)?"

   Options:
   - `Write plan to backlog`
   - `Modify proposal first`
   - `Cancel`

3. **Cancel / skipped answer:** stop. No file or HANDOFF edits.
4. **Modify:** revise the proposal, ask again.
5. **Write plan to backlog:**
   1. Create `.cursor/plans/<name>.plan.md` with frontmatter to-dos.
   2. Append the basename under HANDOFF `- **Backlog plans:**` (canonical label; Checklist also accepts `- **Backlog:**`). Use the bullet field, never a `## Backlog plans` heading alone (Mission Control will not see the row).
   3. Do not touch active plan fields, Parked plans, or Run queue blocks. Do **not** call `.cursor/scripts/run-plan-all-consolidate.sh` (that path is for `/run-plan-all` after confirm Ask only).
   4. Stop. Tell the operator the plan path and that resume is via `/continue-plan` (or later queue inclusion), not Gate B.

## Boundaries

| Command | Difference |
|---------|------------|
| `/start-project` | May park/activate and offers Gate B when activating. Use when disposition is unknown. |
| `/continue-plan` | Starts a unit on a chosen plan. `/backlog-add` never starts units. |
| `/archive-plan` | Parked-list dispose. Not used here. |

## Ask questions requirement

Vague-goal clarify and write confirmation **must** use Ask questions per `.cursor/rules/hitl-ask-questions.mdc`. Chat fallback: one numbered list per message.

## Related

- ADR: `.cursor/memory/decisions/2026-07-26_backlog-crud-commands-contract.md`
- Disposition gate for `/start-project`: `.cursor/memory/decisions/2026-07-25_start-project-plan-disposition-gate.md`
- Cursor product-update gaps may route here via `/cursor-update-awareness` (Ask → `/backlog-add`)
