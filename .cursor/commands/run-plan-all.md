---
name: run-plan-all
description: Orchestrate multiple plans as an ordered, deduplicated execution queue, one Task per plan.
---

# Command: /run-plan-all

## Goal

Orchestrate multiple plans as an ordered, deduplicated execution queue. The agent first acts as a **product owner**: it reads the recent code state (latest merges/commits), the changelog, and every eligible plan, then synthesizes a proposed execution order with overlap/dependency annotations and consolidation suggestions. After the user approves the queue, the main window **dispatches one Task per plan**; each Task runs `/run-plan`'s tick contract. One active plan at a time; the queue persists so a resume in a fresh chat does not re-synthesize from scratch.

**Never** `/git-prod` from this command (remains separate HITL).

## When to Use

- Multiple Gate-A backlog plans have accumulated, with overlapping scope, implicit ordering, or consolidation opportunities.
- You want one command that orders, deduplicates, and runs plans end-to-end without manual activation per plan.
- A workspace has been running `/run-plan` per plan individually and the operator wants batch throughput.

## Precondition

- A set of eligible plans exists under `.cursor/plans/` — at least one with `pending` or `in_progress` to-dos in its frontmatter.
- The eligibility contract is defined by `.cursor/memory/decisions/2026-07-26_run-plan-all-queue-contract.md`:
  - **Included by default:** active plan with implementable to-dos; backlog plans with pending to-dos and Gate A done (or no Gate pending).
  - **Excluded by default:** exhausted/all-completed, cancelled, closed plans; plans awaiting Gate B without opt-in.
  - **Opt-in:** Gate-B-awaiting plans may be included via the `Include Gate-B plans` option at confirm time.
- No eligible plans: report and stop. Suggest `/start-project` for a new plan.

## Strategy

This command runs in the **main window** as a **pure orchestrator**. It synthesizes, asks, applies user-approved consolidations, then **dispatches one Task subagent per queued plan**. Each subagent runs the existing `/run-plan` tick contract in its own context. The orchestrator does **not** implement to-dos, fork a second tick engine, fan out plans in parallel, or replace `/run-plan` behavior. See `.cursor/memory/decisions/2026-07-26_run-plan-all-pure-orchestration.md`.

**Persona:** reuse `agentPersona.modes.run-plan` / night-shift (no new persona id required; documented in registry).

## PO Synthesis (read-only proposal step)

> **Delegation note:** The actual scanning below is performed by a **Task(explore) subagent** dispatched from the delegation pattern. The tables define the specification of what the worker scans. The main window reviews the structured report and runs the 6-way confirm Ask only. See the [Delegation pattern](#delegation-pattern) subsection below.

Before asking the user for confirmation, the agent performs a **read-only** synthesis. It edits no plan files and changes no HANDOFF state during this step.

### Inputs (reads)

| Source | What is read | Purpose |
|--------|-------------|---------|
| **Recent merges** | `git log --first-parent --merges -20` for merge commits on the active branch | Identify scope already shipped; prune candidate plans whose to-dos have already landed |
| **Recent commits** | `git log --first-parent --no-merges -10`; `git diff staging...HEAD --stat` | Catch work-in-progress that overlaps with candidate plans; flag conflicts |
| **CHANGELOG** | `CHANGELOG.md` `[Unreleased]` section + latest release notes | Catch scope already delivered or contradicted in releases |
| **HANDOFF** | `.cursor/HANDOFF.md` active plan, queue cursor (if resuming), backlog/parked lists | Preserve current execution position; the active HANDOFF plan keeps priority unless reordered |
| **Candidate plans** | Frontmatter (`todos`, `status`) + body (goal, constraints, acceptance, phases) for each eligible plan | Full inventory of pending work; detect overlap by comparing file paths, goal statements, and phase descriptions |

### Outputs (surfaced at the confirm Ask only)

| Output | Detail |
|--------|--------|
| **Logical execution order** | A flat ordered list of plan basenames. Dependency prerequisites first; shipped-scope sections pruned; smaller/unblocking before large when dependencies are equal |
| **Overlap / dependency map** | Per-pair annotations: `A blocks B`, `A touches same files as B` (sequential-only), `B is subset of A` (merge), `A contradicts B` (user decides) |
| **Consolidation proposals** | **Merge** (adjacent/overlapping scope → one plan), **Split** (unrelated domains → two plans), **Simplify** (redundant phases → condense), **Drop** (scope fully shipped → archive) |
| **Coherence notes** | Free-text observations: shared ADRs needed, cross-plan acceptance differences, middleware ordering suggestions |

### Ordering heuristics (locked)

1. **Shipped-scope-first pruning** — scan merge history and CHANGELOG; fully shipped → propose drop; partially shipped → reorder to skip delivered sections.
2. **Dependency edges before siblings** — A plan that explicitly depends on another's output runs after that plan.
3. **Smaller/unblocking before large** — among no-dependency plans, fewer to-dos or narrower `read_scope` runs first.
4. **Active HANDOFF priority** — the plan referenced by `.cursor/HANDOFF.md` as active runs first, unless reordered at confirm.
5. **Backlog list fallback** — tie-breaking: HANDOFF Backlog plans order (top-to-bottom as listed).
6. **Basename tiebreaker** — alphabetical if still tied.

### Overlap / dependency map rules

- **Same-file collision:** two plans list the same path or glob → collision flag; run sequentially, user may merge or reorder.
- **Scope subset:** plan B's goal fully covered by plan A → `B is subset of A`; merge B's unique to-dos into A, archive B.
- **Explicit dependency:** plan B says "depends on A" in `Constraints` or `Why` → edge `A → B` is hard-wired.
- **Contradiction:** plan A assumes architecture state X, plan B changes X → conflict; user decides order.
- **Independent default:** no collisions or edges → independent; order by remaining heuristics.

### Delegation pattern

This step is delegated to a **Task(explore) subagent** using the reusable worker prompt template at `.cursor/context/templates/command-worker-prompt.md`. Follow the same pattern as `/start-project` Step 1 (see [Broad Intake Review delegation](../commands/start-project.md#step-1-broad-intake-review-delegated)).

1. **Fill the template** — set these parameters:
   - **Repo:** `[absolute repo path]`
   - **Command:** `/run-plan-all`
   - **Task description:** "Scan recent merges (git log --first-parent --merges -20), recent commits (git log --first-parent --no-merges -10; git diff staging...HEAD --stat), CHANGELOG.md [Unreleased] + latest release, HANDOFF, and every eligible candidate plan (frontmatter + body) under .cursor/plans/. Return a structured PO synthesis report: logical execution order, overlap/dependency map, consolidation proposals, and coherence notes. See the Inputs table in the command for the full specification."
   - **read_scope:** `[".cursor/plans/*.plan.md", ".cursor/HANDOFF.md", "CHANGELOG.md", ".cursor/memory/decisions/"]` (plus workspace-level git log/diff). Unprocessed dogfood is owned by the Confirm Queue preflight below; do not put dogfood paths on this explore worker.
   - **worker_contract:** "structured PO synthesis report: ordered plan list, overlap/dependency annotations, consolidation proposals, coherence notes, plus staging-ready (lint)"
   - **max_ticks:** 2
   - **worker_type:** explore

2. **Dispatch** a Task subagent with `subagent_type: explore`.

3. **Read the worker summary** — the main window uses the synthesis report to present the 6-way confirm Ask (see [Confirm Queue](#confirm-queue-ask-questions)). Do not dump raw diffs or logs.

**Fallback:** If Task dispatch is unavailable, run the PO synthesis inline (same as pre-delegation behavior).

**References:** Reusable worker prompt template at `.cursor/context/templates/command-worker-prompt.md`. Delegation routing table at `autogit/plan-routine.md` section 9 (Commands refactored).

## Confirm Queue (Ask questions)

**Unprocessed dogfood preflight:** before the confirm Ask, skim `##` or `### Unprocessed Files` in factory `dogfood/README.md` or consumer `.cursor/dogfood/README.md`. Empty or missing: silent OK. Non-empty: mention count and top titles once with standard triage labels, then **Ask questions** (one question, before the 6-way confirm; chat numbered-list fallback) with labels exactly `Analyze inbox now` / `Enqueue Fix now` / `Not now` (same handlers as `/continue-plan` hard stop 4). Never auto-analyze, never invent Field Reports, never refuse the queue solely because the inbox is non-empty. After `Not now` or after ingest/enqueue, continue to the 6-way confirm. Orchestrator owns this skim and Ask for the batch: per-plan `/run-plan` workers must not re-recite the same inbox and must not Ask again. sessionStart tip remains complementary (ADRs `2026-08-11_dogfood-unprocessed-broad-intake-bucket.md`, `2026-08-14_main-command-dogfood-audit-routing.md`).

**Audit session-pile preflight (before the confirm Ask):** count detached workspace-owned `agent-kit-audit-*` sessions via `.cursor/scripts/plan-external-review.sh --reap-audit-sessions --dry-run` (or the arm `--dry-run` line `audit-sessions: N detached owned`). At warn: print the dispose command (or offer `--reap-audit-sessions`) in the Ask/preflight body and continue. At cap: do not arm; surface the cap in the orchestrator Ask/preflight, not only launcher stderr. Attached sessions are operator work and are never counted. This orchestrator check runs once, at queue confirm; per-arm protection is the launcher's own session-cap refusal (exit 4), which the mid-batch and queue-end arms already honour, so no second orchestrator call site is wired.

**Audits unsatisfiable-config preflight (before the confirm Ask):** when `externalPlanReview.preflight` is not `off`, check whether `enabled: true` and `backend` is pinned `"claude"` while this lane's implementer is Claude — that combination can only end owed (`CLAUDE.md` lists Claude external plan-review audits as a non-goal here; implementer≠reviewer same-model skip, ADR `decisions/2026-08-13_audits-atomic-wait-reviewer-fallback.md` point 4). `"auto"`, `"cursor"`, and `"cloud"` stay satisfiable. `midBatchAudits: true` multiplies the cost: every completed plan arms, every arm same-model-skips, every plan in the queue ends owed. `warn`: surface once, naming the combination and the three outs (`backend: "auto"`, `"cursor"`, or `"cloud"`), then continue. `block`: do not start the queue into a config that can only end owed — stop and surface the fix, or continue only on explicit operator deferral; never steal `/git-prod`. This runs before the confirm Ask because that is the one place an operator can still change config cheaply, ahead of a multi-plan run. A growing owed pile is not an acceptable substitute for surfacing this (`.cursor/memory/errors/2026-08-14_audit-owed-ledger-no-close-path.md`).

After synthesis, present the proposal using **Ask questions** tool. Include the ordered list, key overlaps/consolidations, and coherence notes in the question body. Fallback to chat numbered list if the tool is unavailable.

> "Plans synthesized. Proposal: [N] plans in order, [M] consolidations, [K] overlaps. Here is the proposed execution queue..."

Options (6-way):

| Option | Behavior |
|--------|----------|
| `Run as proposed` | Accept the full PO synthesis: apply approved merges/drops to plan files, set the queue order in HANDOFF, activate the first plan, begin execution |
| `Edit order` | Accept consolidation proposals but reorder the queue. The user specifies the new order (typed or pasted). |
| `Apply merges & drops only` | Accept consolidation proposals but keep the default per-heuristic order for the remaining queue |
| `Keep all plans as-is` | Run the queue without any consolidation; use the proposed order only (no plan files are changed) |
| `Include Gate-B plans` | Re-run the synthesis with Gate-B-awaiting plans included; show a new confirm Ask. Only offered when Gate-B plans exist. |
| `Cancel` | Abort `/run-plan-all`. No plans reordered, merged, or dropped. HANDOFF unchanged. |

### After confirmation

- **Run as proposed / Apply merges & drops only:** apply consolidation mutations (merge, split, drop, rename) to plan files and/or archive directory. Write the resolved queue order to HANDOFF.
- **Edit order:** apply consolidation mutations, then update the queue order per user input.
- **Keep all plans as-is:** preserve all plan files exactly; write only the queue order to HANDOFF.
- **Include Gate-B plans:** re-run synthesis with Gate-B plans included, then present a new confirm Ask.
- **Cancel:** stop immediately. Report that no state was changed.

Rejected consolidation proposals leave plans untouched. If the user rejects all consolidations but approves the order, the queue runs in the proposed order without mutating plan files.

### Consolidation apply

Use the safe helper after the confirm Ask grants consolidations. Canonical launcher: `.cursor/scripts/run-plan-all-consolidate.sh` (wrapper: `scripts/run-plan-all-consolidate.sh`). Default is `--dry-run`; real mutations need `--apply --approved`.

**Pre-flight (always):**

1. Confirm Ask already granted for the consolidations being applied (script refuses `--apply` without `--approved`).
2. Target plan files exist under `.cursor/plans/` (not already archived unless intentional).
3. Do not change active HANDOFF `- **Plan:**` unless activating the first queued plan via `--activate` / `--rewrite-queue`.
4. **In-flight queue guard:** `/backlog-add`, `/backlog-edit`, `/backlog-delete`, and `/backlog-cancel` must **not** call this script, and must **not** rewrite `- **Run queue:**`, `- **Queue cursor:**`, `- **Queue status:**`, or `- **Queue outcomes:**` (ADR `2026-07-26_backlog-crud-commands-contract`). The script with `--caller backlog-crud` refuses those paths when a `/run-plan-all` queue is in flight.

**Checklist (after confirm):**

| Step | Command / action |
|------|------------------|
| Preflight | `.cursor/scripts/run-plan-all-consolidate.sh --preflight` |
| Merge (frontmatter) | `.cursor/scripts/run-plan-all-consolidate.sh --merge-checklist SOURCE.plan.md TARGET.plan.md` then agent-edit TARGET (script never auto-merges YAML); archive SOURCE with `--drop` |
| Drop / archive | `.cursor/scripts/run-plan-all-consolidate.sh --drop PLAN.plan.md --apply --approved` (refuse overwrite unless `--force-overwrite`) |
| HANDOFF queue rewrite | `.cursor/scripts/run-plan-all-consolidate.sh --rewrite-queue --queue "a.plan.md,b.plan.md" --cursor 0 --status running --activate a.plan.md --apply --approved` |

`--rewrite-queue` validates and normalizes `--outcomes` (including multiline) **before** any HANDOFF mutation, then applies Plan/Mode/queue/cursor/status/outcomes as one atomic rewrite. Invalid outcomes (for example a line that looks like a HANDOFF machine field) refuse with the file untouched. Backlog CRUD callers still cannot rewrite the queue.

Queue field shape aligns with `serializeRunPlanAllQueueFields` in `packages/cli/src/plan-loop/run-plan-all-orchestrator.ts` (machine-field bullets only). Never `/git-prod` from this path.

## Execute the Queue

After confirmation, the main window is a **pure orchestrator**. For each plan in the approved queue **in order** (one at a time; no parallel plan Tasks):

### Orchestrator must not

The orchestrator **must not** implement to-dos, edit product code, run tests, write changelogs, or edit plan files except **user-approved consolidation mutations** applied after the confirm Ask. The PO synthesis Task(explore) delegation (see [Delegation pattern](#delegation-pattern)) is a read-only analysis step and does **not** satisfy the execute-queue contract. Mandatory execution Task is **per queued plan** after confirmation.

### Per-plan flow

1. **Activate the plan** — update `.cursor/HANDOFF.md`: `Mode: run-plan-all`, active plan basename, full `Run queue`, `Queue cursor`, `Queue status: running`. HITL fields that assert a human decision (Queue status stopped, Parked, approved, deferred, confirmed) must record Ask id, operator reply, or `agent-inferred`. Do not write Parked / Queue status stopped as operator action unless an Ask id and operator reply exist.
2. **Dispatch Task** — launch one Task subagent with a self-contained prompt (template below) that includes:
   - Absolute path to the plan file under `.cursor/plans/`
   - HANDOFF snapshot (active plan, cursor, outcomes so far, queue order)
   - Instruction to run the `/run-plan` tick contract for that plan until exhausted or blocked
   - Structured return contract (required)
3. **Background wait** — prefer `run_in_background: true`. Wait for the **end-of-turn completion notification**. Do **not** poll the Task (no AwaitShell loops on subagent status). **No co-pack:** do not start the next plan Task, `/git-staging`, or other parallel heavy work in the same turn as an in-flight plan Task; sequential queue only (ADR `decisions/2026-07-27_auto-run-no-regression-invariants.md`).
4. **Validate the summary** — require a structured return of the form:

```text
{ outcome: "completed"|"blocked"|"partial", lastTodoId, filesTouched[], failures?[] }
```

   Missing or malformed summary: **Ask the user** before advancing the cursor. Do not invent an outcome.
5. **Record the outcome** — write HANDOFF `Queue outcomes` (plan basename, `outcome`, `lastTodoId`, optional notes from `failures`).
6. **Advance the cursor** — increment `Queue cursor` to the next plan index; update `Run queue` / `Queue status`; repeat from step 1 until a stop condition.

Subagent ownership (inside the Task): mark to-dos `in_progress` → implement → `completed`; plan-level HANDOFF updates; per-to-do risk gates (`max_ticks`, PII/secrets Ask, staging-on-diff); never `/git-prod`.

### Audits (mid-batch + queue end)

**Default path when audits are enabled:** this command arms, waits, rearms leftover wait budget on exit 3, and continues into `/plan-review-triage` at queue end (explicit path list). Operators stay on `/run-plan-all`; specialist `/plan-external-review` and `/plan-review-triage` stay SoT and are invoked from this path. Do not reimplement exit-3 resume (`dogfood-ingest-fix-now`) or a Cloud Agents reviewer (`cursor-cloud-agents-sdk`). ADR `2026-08-14_main-command-dogfood-audit-routing.md`.

Read `externalPlanReview` before the queue confirm Ask and at each advance:

| Config | Behavior |
|--------|----------|
| Audits **pre-flight** (`preflight`: `off` \| `warn` \| `block`) | Before the confirm Ask and before each mid-queue advance: same owed/untriaged check as `/run-plan`, plus the unsatisfiable-config check (`enabled: true` + pinned `backend: "claude"` in this lane can only end owed; see "Audits unsatisfiable-config preflight" above). `block` arms or stops; never steals `/git-prod`. |
| `midBatchAudits: true` and audits enabled | After each plan Task returns `outcome: completed`, the **orchestrator** arms **one** full audit for that plan with `--force --autonomous --wait-monitor` (or one `--batch` + wait_all when batching is intentional) **before** advancing the cursor. No paste Ask between plans. Soft-fail → Field Report owed; still advance. AwaitShell until exit `0|3|4` (chat slice ~90s; remaining budget in `.cursor/context/audit-wait/<slug>.json`). **Exit 3 with remaining `waitTimeoutSeconds`:** do not treat as arm-done. Same orchestrator session resumes wait-state polling (re-arm `--wait-monitor` against leftover budget) before advancing the cursor or skipping triage. Exit 3 with zero leftover budget, or exit 4: Field Report owed, then advance. Wait success requires a **fresh** monitor after arm start. Reviewer cascade: `backend: "auto"` uses Claude (Haiku) when usable, else Cursor Agent. Same-model implementer/reviewer is an honest skip. Do **not** fan out N background sessions without wait. Do **not** insert a mid-queue triage Ask (operator non-stop preserved; record ready path for queue-end). Mid-batch stays findings-only: **never** auto-Write residuals or rewrite the Run queue between plans. |
| `midBatchAudits` false/missing | **Non-stop** mid-queue: do **not** pause for audit Ask/paste between plans. Mid-queue completed plans stay Field Report **owed** until reviewed. |
| Queue exhausted | Final HANDOFF; cadence `batch-complete`; then queue-end audit arm covering remaining owed/unreviewed targets (enabled → `--force --autonomous --wait-monitor` or paste per `mode`; else `offerOnExhausted` Ask). Prefer one launcher `--batch` + wait_all when multiple basenames. After wait exit `0`: run `/plan-review-triage` Ask with an **explicit path list** of fresh monitors (batch uniform Ask when outcomes match; sequential fallback when mixed; durable heading per file). **Batch exhaust without conveyor:** when remaining monitors are process-only / depth-capped, prefer uniform **Ack and stop** or **Fix nits only**; do not spawn unbounded `close-*` backlog from Write residuals (ADR `decisions/2026-08-11_plan-audit-residuals-termination.md`). Then suggest `/git-prod` if staging is ahead of `main` (separate HITL). |

Never steal `/git-prod` confirmation. Chat never runs silent headless `--force` / `claude -p` in the agent shell. Spawn-only exit 0 without `--wait-monitor` is **not** review done. Never stop at Final HANDOFF "when monitors exist, run triage" after arming: wait (freshness) then continue (mid-batch waits for file only; queue-end waits then triage Ask with explicit paths). ADR: `2026-07-27_audits-autonomous-plan-review-contract.md` (supersedes queue-end-only); wait freshness: `2026-07-27_audits-wait-freshness-enforce.md`.

**Exit 3 stays timeout-only across the queue.** A mid-queue or queue-end arm that returns `3` reviewed nothing: leave that plan Field Report **owed**, keep its path out of the queue-end triage list, and never narrate it as reviewed. **Same-session resume:** when leftover `waitTimeoutSeconds` remains in `.cursor/context/audit-wait/<slug>.json`, the same orchestrator session must keep polling (re-arm `--wait-monitor`) before advancing the cursor or skipping `/plan-review-triage`. A later session may poll leftover budget; that is fallback, not the default while this session is still open. Do not treat a first-slice exit `3` as "arm done, continue the queue." Monitors that show up later, including monitors written by a different arm or a later queue position, do **not** retroactively upgrade an earlier `3` — the `3` stays `3` even when a later genuine monitor exists. Exit `4` covers the launcher soft-fails: no usable reviewer (`backend: "auto"` tried Claude then Cursor; pinned `claude` still tips when Claude is missing), same-model refuse, background spawn unavailable, a **silent PTY** early abort (spawn succeeded but produced no scrollback in the grace window), and a **session-cap refusal** (detached `agent-kit-audit-*` pile at the cap, so nothing spawned). Advance the queue on exit 4 or on exit 3 with zero leftover budget, but record the target as owed, never as reviewed. **Leftover budget is `deadline` vs wall clock, never `status: "armed"` alone:** the launcher expires a wait-state file left `armed` past its `deadline` on contact (to `status: "timeout"`, `remainingBudgetSeconds: 0`), so a stale arm from an earlier queue run is never resumed as live budget; sweep all slugs with `.cursor/scripts/plan-external-review.sh --gc-wait-state [--dry-run]`. **Owed close (separate, later event, not an upgrade of the `3`):** once the wait-state for that slug is terminal-and-dead (`status: "timeout"`/`"soft-fail"`, or `"armed"` with `now >= deadline`) and a genuine post-hoc monitor for the slug exists, `/run-plan`'s owed-close HITL applies — `Adopt existing monitor` (into `/plan-review-triage`, closes as reviewed-by-adoption) or `Ack owed without review` (closes as acked/unreviewed); a duplicate re-arm against already-merged work is not the only route. Queue-end triage lists still exclude dead-timeout rows by default; adoption is operator-initiated per row. ADR: `2026-07-30_audits-pty-progress-gate-zombie-policy.md`; wait resume: `2026-08-13_audits-atomic-wait-reviewer-fallback.md`; owed-close: `.cursor/memory/errors/2026-08-14_audit-owed-ledger-no-close-path.md`.

### External plan review (legacy heading)

Same table as **Audits (mid-batch + queue end)** above. Keep Field Report owed rows (`buildOwedReviewItems`). Mid-batch: one arm+wait (or one batch wait_all) before advance; no unwatched multi-Terminal fan-out; triage via `/plan-review-triage` at queue-end with explicit path list. Queue-end chat path: wait then triage Ask.

### Subagent prompt template

Self-contained; the subagent does **not** inherit the orchestrator transcript.

```text
You are an Agent Kit worker running one queued plan for /run-plan-all. Execute the plan via the /run-plan tick contract and stop when the plan is exhausted or blocked.

Repo: <absolute repo root>
Plan: .cursor/plans/<plan-basename>.plan.md
HANDOFF snapshot:
- Mode: run-plan-all
- Active plan: <plan-basename>.plan.md
- Queue cursor: <N> (of <total>)
- Run queue: [<ordered basenames>]
- Queue outcomes so far: <list or none>
- Instruction from HANDOFF: <1-3 sentences if present>

Rules:
- Read `.cursor/HANDOFF.md` and the plan file first. Resume from the next pending/in_progress to-do.
- Follow `/run-plan` (`.cursor/commands/run-plan.md`): tick contract, risk gates, staging-on-diff when there is a diff.
- Findings-only: review workers (`review-*` / findings contracts) return structured findings (severity, path, evidence) and must not auto-fix product code. After findings, the in-plan `/run-plan` orchestrator applies `externalPlanReview.autoRemediate` (default false): fix-agent Task (small) or residuals backlog plan (large). Do not silent-apply.
- Unprocessed dogfood already skimmed by the orchestrator at queue-confirm — do not re-recite.
- When this plan is exhausted (`outcome: completed`), **skip** chat exhaustion Ask/paste in the worker (parent orchestrator owns mid-batch + queue-end audits). Return the structured summary and stop.
- Never `/git-prod`. Never ask the user for `/continue-plan` as the default path.
- A refused command (permission classifier, never /git-prod class) is terminal in this worker: do not retry it.
- Do not fabricate HITL: do not write Parked / Queue status stopped as operator action unless an Ask id and operator reply exist.
- Do not start the next queued plan; this Task owns only this plan.
- Prefer orchestrated /run-plan strategy inside this Task when Task nesting is available; otherwise in-session loop for this plan only.
- Update plan frontmatter todo statuses and HANDOFF for this plan as you go.
- Before "Staging ready: yes": run repository-appropriate formatter/linter on touched files.

Return ONLY a structured summary (no diff/log dump):
## Worker summary
- outcome: completed | blocked | partial
- lastTodoId: <id>
- filesTouched: [<paths>]
- failures: [<optional short notes>]
- Staging ready: yes|no
- Notes: <1-2 sentences>
```

### Stop conditions

Do not dispatch the next plan when:

| Condition | Action |
|-----------|--------|
| Next plan depends on a prior plan's unfinished deliverable | HANDOFF with blocked status; stop. `/git-staging` only if there is a diff (orchestrator may stage queue-meta only; product staging belongs to the subagent tick) |
| Next plan requires Gate B (was opted in) | HANDOFF + stop (Gate B not yet granted; manual `/start-project` or re-run with explicit opt-in) |
| User asked to stop | Do not reschedule; HANDOFF with current queue position |
| API / usage hit limit (quota, rate-limit signal, Task dispatch failure, auto model switch) | Hard stop: revert to-do to `pending`; HANDOFF with stop reason + cursor + queue position; operator message to wait for reset or switch off Auto to a named model (Claude Opus / Sonnet 4.6 / Composer 2.5 Fast); do not advance queue cursor; do not dispatch the next plan |
| Prior HANDOFF still records an API/usage limit hard stop and operator has not confirmed recovery | Refuse auto-reschedule and refuse next-plan Task dispatch until named-model switch and/or quota wait; same pre-flight as `/run-plan` (HANDOFF stop-reason check only; no remaining-quota API) |
| Queue exhausted (all plans completed) | Final HANDOFF; run `.cursor/scripts/field-report-cadence-bump.sh batch-complete`; queue-end audits arm (autonomous or paste per config; not a mid-queue paste Ask); then suggest `/git-prod` if staging is ahead of `main` (HITL only, never auto; never steal prod) |
| Subagent summary missing/malformed and user does not authorize advance | HANDOFF with blocked/partial marker; stop or re-dispatch after Ask |

### Mid-queue context pressure

When the orchestrator main window is near its context limit (heuristic: message count, tool calls, token estimate):

1. **Persist the queue** — write HANDOFF with full approved queue order + current `Queue cursor` + all `Queue outcomes` so far. The queue is **not** re-synthesized on resume.
2. **Stop and instruct** — tell the user to open a **new conversation** and paste `/run-plan-all`. The new agent reads HANDOFF, validates queue files still exist (no material drift), and **resumes by dispatching the next plan as a Task** (does not implement in-window).

On resume, validate both plan file existence and status against the stored queue. Material drift (plan deleted, status changed from pending to something else) requires a new synthesis and confirmation rather than silent reorder.

## HANDOFF Persistence

Every queue mutation updates `.cursor/HANDOFF.md` with these fields:

```
Mode: run-plan-all
Run queue: [plan-a.plan.md, plan-b.plan.md, plan-c.plan.md]
Queue cursor: 1 (current: plan-b.plan.md)
Queue status: running | paused | blocked | exhausted
Queue outcomes:
  plan-a.plan.md: completed (to-dos: id-1, id-2, id-3)
```

HITL claims on these fields (especially `Queue status: stopped` or a Parked row as operator action) must record Ask id, operator reply, or `agent-inferred`. An inferred stop must not look identical to an operator stop.

The approved queue order is persisted so a resume in a fresh chat does not re-synthesize. See the ADR at `.cursor/memory/decisions/2026-07-26_run-plan-all-queue-contract.md`.

**Gaps voice:** keep `- **Gaps:**` short and operator-facing (exact `none` when only mid-batch / cadence / monitor plumbing changed; never `none. Residuals…` as an OK debit). Do not dump queue-outcome tables, mid-batch monitor paths, or `/git-prod` boilerplate into Gaps. Full say/avoid pattern: handoff template + ADR `2026-07-27_mc-flight-log-panel.md`.

## Guidance for long runs

- **Cooldown between plans (`interTickCooldownMs`):** when `.cursor/context/config.json` has a value `> 0`, the orchestrator waits that many ms between queued plan Tasks. **Default remains `0`** so named-model / fast queues are not silently slowed. Set via Mission Control **Config** or `config.json` (see `config.example.json`).
- **Auto continuous queues:** if the operator stays on **Auto**, strongly recommend a non-zero cooldown before starting (documented recommend: **15000** ms). After a quota hard stop, next successful resume should use cooldown ≥ that recommend (bounded adaptive backoff, prose only; no fake Cursor quota API).
- **First-queue Auto surface (when cooldown is `0`):** before dispatching the first plan Task (or on resume after an API-limit stop), if `interTickCooldownMs` is missing or `0` and the operator appears to be on **Auto**, briefly surface the 15000 ms recommend. Do **not** change the global default. Named-model queues need no nag.
- **Prefer a named model** (Claude Opus, Sonnet 4.6, or Composer 2.5 Fast) over **Auto** for long queues. Named models typically use a **separate quota bucket** from Auto and expose Ask questions for HITL. Auto fallback after a limit (e.g. to Grok 4.5) loses Ask questions and is not a successful tick.
- **Do not** throttle Mission Control SSE/poll as a Cursor Agent quota fix (local-only; see enforcement audit).
- **Parallel plan Tasks are not used.** The sequential orchestration (one Task per plan, one plan at a time) is already a mitigation against API hit-rate. This is locked by the pure-orchestration ADR.

## Stop

User: "stop" / "stop the run" → do not schedule the next plan; HANDOFF with current queue position (cursor index + outcomes so far).

## HITL (invariants)

- `/git-prod` **never** from this command, any execution path
- The confirm queue Ask is a mandatory HITL gate (6 options, no silent default)
- After confirmation, each plan runs in a **Task** subagent; the orchestrator does not implement to-dos in-window
- Missing/malformed Task summary requires an Ask before advancing the cursor
- Risk gates (PII, secrets, ambiguous scope) remain per-plan within `/run-plan`'s own tick contract (inside the Task)
- External plan review Ask/paste runs **once at queue end** only for HITL; mid-queue arms one wait per plan (or one `--batch` + wait_all) without triage Ask; queue-end waits then `/plan-review-triage` Ask with explicit paths; must not steal `/git-prod` confirmation
- Rejected consolidation proposals leave plan files untouched

## Typical flow

```
User: /run-plan-all
Agent: [PO synthesis] Read merges (20), commits (10), CHANGELOG, 4 plans...
       Proposal: 4 plans in order. Overlap: plan-b touches same files as plan-c (collision).
       Consolidation: merge plan-d into plan-a (scope subset).
       [Ask questions: 6 options]
User: [clicks Run as proposed]
Agent: [Merges plan-d into plan-a, archives plan-d]
       HANDOFF: Mode run-plan-all, Run queue [plan-a, plan-b, plan-c], Queue cursor 0, Queue status running
       [Activate plan-a → Task dispatch (run_in_background) with plan + HANDOFF + return contract]
       [End-of-turn: Worker summary outcome=completed]
       HANDOFF: Queue cursor 1, outcomes {plan-a: completed} (no review pause)
       [Activate plan-b → Task dispatch ...]
       ...
       [All plans exhausted → Final HANDOFF, queue-end audits arm, then suggest /git-prod]
```

**Context pause flow:**

```
...mid-queue...
Agent: Context near limit. Persisting queue position 2 (plan-c).
       HANDOFF: Mode run-plan-all, Queue cursor 2, outcomes {plan-a: completed, plan-b: completed}
       Open a new conversation and paste '/run-plan-all'. Resume dispatches Task for plan-c (no in-window implement).
```

## Troubleshooting

- **"No eligible plans found"** — check that at least one plan has `pending`/`in_progress` to-dos. Gate-B-only plans require `Include Gate-B plans` opt-in at confirm time.
- **"Queue file missing on resume"** — a plan was deleted outside the queue. Run a new synthesis: the agent will detect the gap and propose a corrected order.
- **"Consolidation proposal rejected"** — no state is changed. The queue runs in the proposed order with all original plan files intact.
- **"HANDOFF Mode is run-plan-all but queue is empty"** — the queue finished and no new synthesis was requested. Suggest `/run-plan-all` again if there are new eligible plans.