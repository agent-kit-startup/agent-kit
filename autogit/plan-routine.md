# Plan Routine — Creation and Synchronization

Agent Kit **starts with the plan**: without a plan with to-dos, there's no structured execution. Create/update the plan before implementing.

`/start-project` is **bootstrap, not execute**: Broad Intake Review first; Gate A single composite question (with active plan: backlog+write / park+write / modify / cancel; without: write / write+backlog / modify / cancel); Gate B (second explicit approval via **Ask questions**, chat fallback if needed) offers start first unit / run-plan / edit / Add to backlog / Stop here, then runs one unit only when start is chosen. `Add to backlog` lists under Backlog plans with Mode STOPPED; `Stop here` leaves the plan active without starting the unit. Active HANDOFF → disposition merged into Gate A composite options. Details: `.cursor/commands/start-project.md`. HITL gates: `.cursor/rules/hitl-ask-questions.mdc`. Fallback: one numbered list per message.

**Backlog enqueue without activation:** `/backlog-add` uses the same Broad Intake + plan-file shape, asks `Write plan to backlog` / `Modify proposal first` / `Cancel`, appends HANDOFF `- **Backlog plans:**`, and stops (no Gate B, never parks or activates). Manage backlog rows with `/backlog-edit`, `/backlog-delete` (archive move), `/backlog-cancel` (soft cancel in place). Distinct from `/archive-plan` (parked-list only). Details: `.cursor/commands/backlog-*.md`; ADR `decisions/2026-07-26_backlog-crud-commands-contract.md`.

When the user requests **creating a new plan** (or the agent is in planner mode creating plans), **always** follow this routine:

---

## 1. Create the plan with to-dos

- **Always include to-dos** in the plan frontmatter (array with `id`, `content`, `status`).
- Respect phase order (0 → 1 → 2 → …).
- Each phase with actionable and trackable to-dos.
- During execution, keep `status` updated (`pending` → `in_progress` → `completed`) so the user can follow along in the plan panel.
- Do not edit product files in the same turn that only creates the plan (Gate A).

---

## 2. Include security verification

When the plan involves **flows, APIs, integrations or deployment**:

- Add phase or section **"Complete security verification"** with:
  - **Flow and integrity:** webhook, filters, timeouts, error handling
  - **Secrets and credentials:** none in code; env.example without real values; tokens obfuscated in docs
  - **Best practices:** PII, rate limits, HTTPS, idempotency
  - **Pre-production checklist:** check-secrets, CHANGELOG, documentation

---

## 3. Sync with project manager (optional)

**Only if the project uses a PM tool** (ClickUp, Jira, Linear, etc.) and the user indicates parent task or active integration.

When there's a parent task:

1. Create subtask per phase (or actionable to-do) in the **project's** tool.
2. Follow conventions of that tool's skill/rule (if it exists) — the kit does **not** assume ClickUp.
3. Record IDs in the plan for updates between phases.

If there's no PM tool: skip. Plans + HANDOFF + Git are sufficient for the structural spine.

---

## 4. Keep PM updated between phases (if it exists)

- **When completing each phase:** update corresponding subtask status.
- **At plan end:** after `git prod`, mark delivery as complete in project tool.
- **When updating HANDOFF.md:** mention subtasks only if they exist.

---

## 5. Two execution modes

| Mode | Command | Behavior |
|------|---------|----------|
| **Manual** | `/continue-plan` | You drive: 1 phase ≈ 1 chat; Ask before the unit; suggests `/git-staging`; handoff if context full; new chat for the next phase |
| **Continuous** | `/run-plan` | It drives: runs the plan to the end; picks the strategy itself (orchestrated workers when Task exists, in-session loop otherwise, `agent-kit run-plan` / `scripts/plan-loop.sh` for headless); plan status each tick; automatic `/git-staging` if diff exists; **never** `/git-prod` |
| **Hotfix** | `/hotfix` | Narrow urgent change: confirm → mini plan (≤4 to-dos / ≤2 phases) → activate → same `/run-plan` tick contract continuously; **never** `/git-prod`; refuse while `/run-plan-all` queue is `running` |
| **Multi-plan queue** | `/run-plan-all` | PO synthesis → confirm queue → **pure orchestrator: dispatch one Task subagent per plan** (each runs the `/run-plan` tick contract), record the returned summary, advance the cursor; orchestrator never implements to-dos in-window; never `/git-prod`; context pause preserves queue for resume |

`/run-plan-loop` and `/run-plan-orchestrated` are deprecated aliases of `/run-plan` (forced strategy).

In **any** mode: plan first → update to-dos → HANDOFF → staging. The plan panel is the scoreboard for the human to follow.

**Operator playbook (manual denser steps + which-command chooser):** [Getting started - A normal day](../docs/getting-started.md#a-normal-day). Do not fork Gate A/B or tick contracts here; L0 commands remain SoT.

---

## 6. Context budget per to-do (optional)

Canonical template: [`.cursor/context/templates/plan.md`](../.cursor/context/templates/plan.md).

Each `todos` item in frontmatter can include **budget** fields (besides `id`, `content`, `status`):

| Field | Type | Semantics |
|-------|------|-----------|
| `read_scope` | list of globs/paths | Worker reading scope; outside this, only HANDOFF + plan + strictly necessary |
| `worker_contract` | string | Return format (prefer: `summary + tests + staging-ready (lint)`; see `/run-plan`). **Findings contracts** (see below) also authorize plan-file writes by the worker |
| `max_ticks` | integer ≥ 1 | Ticks in this to-do before forced HANDOFF + new conversation |
| `worker_type` | string | Preferred Task `subagent_type` for the orchestrated strategy (e.g. `docs-repo`, `cleancode-refactor`). Omit = orchestrator picks from the routing table in `/run-plan` |
| `inline_first` | boolean | Opt-in signal for orchestrated `/run-plan` in-session implement. **Not force-inline.** When `true` **and** every lightweight check passes (docs-only `read_scope`, allowed `worker_type`, no findings contract), implement in-session instead of Task. If any check fails, the flag is **ignored** and the tick is Task. See `/run-plan` and authoring rules below |
| `force_task` | boolean | When `true`, always dispatch Task even if the to-do would qualify for inline-first |

Plans also support one **plan-level** attribution field (top-level frontmatter, not per to-do):

| Field | Type | Semantics |
|-------|------|-----------|
| `agent` | string | Kit agent identity: basename of a file under `.cursor/agents/`. The dashboard resolves delivery and plan-progress events to it for grouping. Absent or invalid = `agent: null` (UI groups under `system`); absent is valid, do not force a fit. Not a substitute for `worker_type`, and Cursor built-ins (`generalPurpose`, `explore`, `shell`) are not valid values unless a matching agent file exists |

**`staging-ready` and lint evidence:** `Staging ready: yes` means the worker ran repository-appropriate formatter/linter checks on touched files (or stated none applicable) and recorded commands/results under `Tests:` or `Validation:` in the summary. Prefer `worker_contract` strings that name lint explicitly (e.g. `staging-ready (lint)`). Orchestrator rejects `staging-ready=yes` without that evidence when the to-do changed formatted/linted files. Do not require a global lint for pure markdown (or other paths) when no applicable linter exists. Full rules: `/run-plan` "Review the return" / worker prompt. Cross-links: `.cursor/memory/errors/2026-07-21_ci-biome-blocked-440-publish.md`, `2026-07-23_biome-format-blocked-446-tag-ci.md`, process note in `plan-monitor-dashboard-field-report-and-skins.md` (lint after merge → extra formatting PR).

**Findings contracts** (`worker_contract` contains `findings`, names a plan-body artifact such as `backlog table in plan body`, or review-style to-do ids like `review-*`): the worker is the **first-party author** of that phase's findings in the plan (or agreed artifact). **Findings-only:** the review worker must not auto-fix product code. After findings exist, `/run-plan` reads `externalPlanReview.autoRemediate` (default `false`) and remediates via a separate fix-agent Task (small/contained) or, when closeout depth and Blocking severity allow, a residuals backlog plan (large/multi-touch); never silent apply in the review tick. Residuals enqueue is **not** the unbounded happy path: max closeout depth 1 per theme family; prefer Ack / Fix nits for nits or process-only Still open (ADR `decisions/2026-08-11_plan-audit-residuals-termination.md`). In orchestrated `/run-plan`, dispatch with **write access**; do not default to ask/read-only. The orchestrator reviews the summary and the written section; transcription from summary is **fallback only** (label secondhand; note gap in HANDOFF). Product code stays thin-orchestrator: only plan/artifact edits unless the to-do says otherwise. Full rules: `/run-plan` section "Findings contracts (review workers)" and "Remediation gate". Findings contracts still require lint evidence when the worker also edits formatted/linted product or test files; plan-only markdown findings with no applicable linter may state none applicable.

Example:

```yaml
todos:
  - id: phase7-example
    content: "Apply migration and update queue docs"
    status: pending
    read_scope: ["db/002_*.sql", "docs/QUEUES.md"]
    worker_contract: "summary + tests + staging-ready (lint)"
    max_ticks: 3
    worker_type: sql-schema
```

**Rules:**

- Fields are **optional**. Omit = no explicit budget (legacy).
- In the **orchestrated strategy**: main copies fields to worker prompt; worker respects `read_scope` and returns in `worker_contract` (including lint evidence before `Staging ready: yes`). **Inline-first:** lightweight docs-only to-dos (see `/run-plan` "Inline-first lightweight to-dos") implement in-session without Task unless `force_task: true`. For findings contracts, worker also writes findings into the plan (or agreed artifact); orchestrator does not transcribe by default. At consolidate or plan close, copy the final backlog to `.cursor/memory/plan-review-<plan-slug>.md` (versioned; plans stay gitignored). See `decisions/2026-07-25_plan-review-findings-durable-home.md` and `/run-plan` findings contracts step 5.
- `worker_type` overrides the signal table when set. If that agent is not installed, fall back to `generalPurpose` + the matching skill (same rule as `/run-plan`).
- In the **in-session loop strategy** / **manual**: `read_scope` and `max_ticks` still apply as guide; if `max_ticks` reached → HANDOFF + ask for new conversation (even mid-run). `worker_type` is informational only (no Task). Lint-before-staging-ready still applies when the session agent implements the to-do.
- `max_ticks` exceeded does **not** authorize `/git-prod`.

**Authoring `inline_first` (avoid false opt-in):**

- `inline_first: true` is an **opt-in signal**, not a force-inline. Qualification stays strict (ADR `decisions/2026-07-27_run-plan-inline-first-qualification-gap.md`).
- For ADR / memory / CHANGELOG / L0-only deliverables: use `worker_type: docs-repo` (or omit), keep `read_scope` on the docs-only allowlist, then set `inline_first: true` only if those checks pass.
- Do **not** set `inline_first: true` with `security-reviewer`, `tech-lead`, `explore`, or product `read_scope` unless Task isolation is intentional (`force_task: true`). Pairing the flag with non-lightweight tags still dispatches Task and can burn quota under Auto.
- After an API-limit Task abort: recover, then `/continue-plan` or re-author a qualifying docs tick. Do not expect silent inline fallback of the aborted to-do.

**Mission Control dashboard SoT:** for dashboard HTML/CSS/JS work, author `read_scope` with `dashboard/dashboard.html` (repo root). Never seed `packages/cli/dashboard/dashboard.html` — that tree is gitignored and regenerated by `scripts/sync-cli-dashboard.mjs` at prepack. Template note: `.cursor/context/templates/plan.md` ("Mission Control dashboard SoT path").

**Authoring checklist: split docs-only vs product ticks (Auto quota):**

Prefer **two to-dos** when a phase would mix markdown deliverables with product evidence reads. More Auto ticks then qualify for inline-first; heavy work stays Task-isolated. ADR: `decisions/2026-07-27_auto-run-no-regression-invariants.md`.

| Prefer | Avoid |
|--------|--------|
| Docs/ADR/CHANGELOG/L0 tick: `worker_type: docs-repo` (or omit), docs-only `read_scope`, `inline_first: true` | One close-out to-do with `read_scope` that includes `packages/**`, `dashboard/**`, or other product paths "just for context" |
| Separate product/implement or findings tick: real `worker_type`, product `read_scope`, no false `inline_first` (or `force_task: true`) | Tagging an ADR-only write as `security-reviewer` / `tech-lead` with product `read_scope` while setting `inline_first: true` (flag ignored → Task burn) |

Bad product `read_scope` on docs close-out:

```yaml
- id: phase3-closeout
  content: "CHANGELOG + memory index"
  worker_type: docs-repo
  read_scope: ["CHANGELOG.md", ".cursor/memory/_index.md", "dashboard/**"]  # product path → not lightweight
  inline_first: true   # ignored → Task
```

Good split:

```yaml
- id: phase2-product
  content: "Implement dashboard change"
  worker_type: generalPurpose
  read_scope: ["dashboard/**"]
  force_task: true
- id: phase3-closeout
  content: "CHANGELOG + memory index"
  worker_type: docs-repo
  read_scope: ["CHANGELOG.md", ".cursor/memory/_index.md"]
  inline_first: true
```

When creating plans (`/start-project` or planner): prefer template; fill budget for long or multi-file to-dos; prefer `staging-ready (lint)` (or equivalent) in `worker_contract` when the to-do will touch formatted/linted paths; author `inline_first` only for ticks that will actually qualify; **split** docs-only close-out from product ticks.

---

## 7. Update HANDOFF at end of each phase

According to [cursor-plan-handoff.mdc](../.cursor/rules/cursor-plan-handoff.mdc):

- Record completed phase, completed to-dos, next phase.
- Include instruction for the next agent.
- **Manual** mode: if phase generated committable code, **suggest** `/git-staging` (don't execute without request).
- **Continuous** mode (`/run-plan`, any strategy): execute `/git-staging` at end of tick if diff exists (authorized by command); in the orchestrated strategy the main window stages, never the worker.
- Production only via `/git-prod` with explicit confirmation via **Ask questions** (chat fallback if the tool is unavailable).
- If PM tool tasks were updated, mention in HANDOFF.
- **Evidence-checks closeout (merge gate):** before writing `- **Gaps:** none` or claiming staging-ready on a closeout tick, confirm `build` / Evidence checks are green via `gh pr checks <N>` (open staging PR) or local `pnpm evidence:knowledge-classification:check`. Do not merge while checks are in-flight or red. Name red/pending Evidence checks under Gaps until green (or record an explicit waiver). ADR: `decisions/2026-08-01_evidence-checks-merge-gate.md`.

---

## 8. Close phase in Git (DevOps spine)

| Moment | Command | Effect |
 |---------|---------|--------|
| Code ready for pre-prod | `/git-staging` | Promote → staging branch + HANDOFF |
| Pre-prod approved | `/git-prod` | Promote → `main` + HANDOFF (+ memory if applicable) |
| Incident/decision along the way | memory-loop WRITE | Persist in `.cursor/memory/` |

Without staging/prod, handoff describes work that Git doesn't "remember" yet.

---

## Summary for the agent

| Moment | Action |
|---------|--------|
| **Create plan** | Template `plan.md` + to-dos in frontmatter (+ budget if applicable) + security phase (if applicable) — **always before executing** |
| **During execution** | Update to-do `status` in plan (scoreboard); honor `read_scope` / `max_ticks` |
| **PM tool + parent task** | Subtasks per phase (optional — only if project uses it) |
| **End of each phase / tick** | Update HANDOFF; staging (suggest or automatic per mode) |
| **Pre-prod** | `/git-staging` |
| **End of plan / release** | `/git-prod`; complete in PM tool if it exists |

---

---

## 9. Command orchestration delegation

Heavy I/O operations in slash commands (Broad Intake scans, transcript scans, readiness scans, monitor scans, git log fetches) are **delegated to Task subagents** using the reusable worker prompt template at `.cursor/context/templates/command-worker-prompt.md`. The main window remains a thin orchestrator: it reads the worker summary, applies HITL (Ask questions), and writes the result.

### When to delegate

| Scan/Operation Type | subagent_type | Command examples |
|---------------------|---------------|----------|
| Broad Intake (bucket table in command is SoT; includes Unprocessed dogfood) | explore | `/start-project`, `/backlog-add` |
| Transcript + subject-context scan | explore | `/field-report-resolve` |
| Readiness scan | explore | `/agent-kit-onboard` |
| Monitor scan | explore | `/plan-review-triage` |
| Git log/network fetch | explore | `/update`, `/run-plan-all` |
| Command refactor (rewrite) | cleancode-refactor | Phase 2 command rewrites |
| Contract/template design | tech-lead | Phase 1 contract design |
| Template/rule update | docs-repo | Phase 3 updates |
| Fallback (no specific match) | generalPurpose | Any command |

**Broad Intake Memory paths (must match command `read_scope`):** `.cursor/memory/decisions/`, `.cursor/memory/errors/`, `.cursor/memory/plan-monitor-*.md`, theme-matched `.cursor/memory/plan-review-*.md`, `.cursor/memory/_index.md` (Audits + Decisions). Prefer theme match over reading every Audits row. Same triage labels only (`ignore` / `error` / `include` / `note`). ADR: `decisions/2026-07-27_plan-monitor-consumer-awareness.md`. Field Report and `/plan-review-triage` stay attention/HITL SoT.

**Broad Intake Unprocessed dogfood paths:** factory `dogfood/README.md` or consumer `.cursor/dogfood/README.md` (`##` or `### Unprocessed Files` on read). Never auto-analyze. ADR: `decisions/2026-08-11_dogfood-unprocessed-broad-intake-bucket.md`.

**Resolution order:** explicit `worker_type` on the to-do (plan frontmatter), then the signal table above, then `generalPurpose` as fallback.

### How to use the worker prompt template

1. **Fill the template** at `.cursor/context/templates/command-worker-prompt.md` with the command's specific parameters:
   - Repo path, command name, task description
   - `read_scope` (globs/paths limiting what the worker reads)
   - `worker_contract` (expected return format, e.g. `summary + paths + staging-ready (lint)`)
   - `max_ticks` (limit before forced HANDOFF + new conversation)
   - `worker_type` (subagent type from the routing table)

2. **Dispatch a Task subagent** with `subagent_type` matching the routing table.

3. **Read the worker summary** — the main window reads the structured return, it does **not** dump raw diffs or logs.

4. **Apply HITL** using Ask questions tool (or chat fallback if unavailable).

5. **Write the result** — the main window persists the outcome (plan file, command output, dismissals, etc.).

### Fallback pattern

When Task dispatch is unavailable (no subagent support in the current session), the command falls back to **inline execution** — the main window performs the work directly, same as `/run-plan`'s in-session loop fallback. Command files should mention this with a comment linking to the fallback path.

### Commands refactored

| Command | Delegation scope | Phase |
|---------|-----------------|-------|
| `/start-project` | Broad Intake Review (buckets listed in the command table, includes Unprocessed dogfood) → Task(explore) | Phase 2 |
| `/backlog-add` | Broad Intake Review (same buckets as `/start-project`) → Task(explore) | Phase 2 |
| `/agent-kit-onboard` | `agent-kit doctor --json` + readiness scan + progressive resolution → Task(explore) | Phase 2 |
| `/field-report-resolve` | Claim-check: transcript (`answered`) + named subject context (`subject_resolved`, path/plan evidence only) + monitor scan → Task(explore) | Phase 2 |
| `/plan-review-triage` | Monitor scan + summarization → Task(explore) | Phase 2 |
| `/continue-plan` | Plan selection scan (multiple plans) → Task(explore) | Phase 2 |
| `/run-plan-all` | PO Synthesis (git log, CHANGELOG, candidate plans, HANDOFF) → Task(explore) | Phase 1 |

### References

- `.cursor/context/templates/command-worker-prompt.md` — the reusable worker prompt template
- `.cursor/memory/decisions/2026-07-26_command-orchestration-delegation-pattern.md` — ADR
- `.cursor/plans/commands-orchestration-delegation.plan.md` — full plan with Phase 0 audit and routing table
- Hitl-ask-questions.mdc — HITL gates for all command delegation

---

## References

- [`.cursor/context/templates/plan.md`](../.cursor/context/templates/plan.md) — canonical template with budget
- [cursor-plan-handoff.mdc](../.cursor/rules/cursor-plan-handoff.mdc)
- [cursor-skills-git-workflow.mdc](../.cursor/rules/cursor-skills-git-workflow.mdc)
- [autogit/gitupdate.md](gitupdate.md) (`git staging`, `git prod`)
- [`.cursor/commands/run-plan.md`](../.cursor/commands/run-plan.md) (continuous; `/run-plan-loop` and `/run-plan-orchestrated` are deprecated aliases)
- [`.cursor/commands/hotfix.md`](../.cursor/commands/hotfix.md) (mini plan + continuous tick contract)
- [`.cursor/commands/run-plan-all.md`](../.cursor/commands/run-plan-all.md) (multi-plan queue); operator path in [docs/getting-started.md](../docs/getting-started.md)
- PM tools (ClickUp, Jira, …): **optional** skills/rules — only if project requires it
