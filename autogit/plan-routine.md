# Plan Routine — Creation and Synchronization

Agent Kit **starts with the plan**: without a plan with to-dos, there's no structured execution. Create/update the plan before implementing.

`/start-project` is **bootstrap, not execute**: Gate A writes the plan file only; Gate B (second explicit yes) runs one unit. Active HANDOFF → ask continue vs start new. Details: `.cursor/commands/start-project.md`.

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
| **Manual** | `/continue-plan` | You drive: 1 phase ≈ 1 chat; suggests `/git-staging`; handoff if context full |
| **Continuous** | `/run-plan` | It drives: runs the plan to the end; picks the strategy itself (orchestrated workers when Task exists, in-session loop otherwise, `agent-kit run-plan` / `scripts/plan-loop.sh` for headless); plan status each tick; automatic `/git-staging` if diff exists; **never** `/git-prod` |

`/run-plan-loop` and `/run-plan-orchestrated` are deprecated aliases of `/run-plan` (forced strategy).

In **any** mode: plan first → update to-dos → HANDOFF → staging. The plan panel is the scoreboard for the human to follow.

---

## 6. Context budget per to-do (optional)

Canonical template: [`.cursor/context/templates/plan.md`](../.cursor/context/templates/plan.md).

Each `todos` item in frontmatter can include **budget** fields (besides `id`, `content`, `status`):

| Field | Type | Semantics |
|-------|------|-----------|
| `read_scope` | list of globs/paths | Worker reading scope; outside this, only HANDOFF + plan + strictly necessary |
| `worker_contract` | string | Return format (de facto standard: `summary + staging-ready` — see `/run-plan`) |
| `max_ticks` | integer ≥ 1 | Ticks in this to-do before forced HANDOFF + new conversation |
| `worker_type` | string | Preferred Task `subagent_type` for the orchestrated strategy (e.g. `docs-repo`, `cleancode-refactor`). Omit = orchestrator picks from the routing table in `/run-plan` |

Example:

```yaml
todos:
  - id: phase7-example
    content: "Apply migration and update queue docs"
    status: pending
    read_scope: ["db/002_*.sql", "docs/QUEUES.md"]
    worker_contract: "summary + staging-ready"
    max_ticks: 3
    worker_type: sql-schema
```

**Rules:**

- Fields are **optional**. Omit = no explicit budget (legacy).
- In the **orchestrated strategy**: main copies fields to worker prompt; worker respects `read_scope` and returns in `worker_contract`.
- `worker_type` overrides the signal table when set. If that agent is not installed, fall back to `generalPurpose` + the matching skill (same rule as `/run-plan`).
- In the **in-session loop strategy** / **manual**: `read_scope` and `max_ticks` still apply as guide; if `max_ticks` reached → HANDOFF + ask for new conversation (even mid-run). `worker_type` is informational only (no Task).
- `max_ticks` exceeded does **not** authorize `/git-prod`.

When creating plans (`/start-project` or planner): prefer template; fill budget for long or multi-file to-dos.

---

## 7. Update HANDOFF at end of each phase

According to [cursor-plan-handoff.mdc](.cursor/rules/cursor-plan-handoff.mdc):

- Record completed phase, completed to-dos, next phase.
- Include instruction for the next agent.
- **Manual** mode: if phase generated committable code, **suggest** `/git-staging` (don't execute without request).
- **Continuous** mode (`/run-plan`, any strategy): execute `/git-staging` at end of tick if diff exists (authorized by command); in the orchestrated strategy the main window stages, never the worker.
- Production only via `/git-prod` with explicit confirmation.
- If PM tool tasks were updated, mention in HANDOFF.

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

## References

- [`.cursor/context/templates/plan.md`](../.cursor/context/templates/plan.md) — canonical template with budget
- [cursor-plan-handoff.mdc](.cursor/rules/cursor-plan-handoff.mdc)
- [cursor-skills-git-workflow.mdc](.cursor/rules/cursor-skills-git-workflow.mdc)
- [autogit/gitupdate.md](autogit/gitupdate.md) (`git staging`, `git prod`)
- [`.cursor/commands/run-plan.md`](../.cursor/commands/run-plan.md) (continuous; `/run-plan-loop` and `/run-plan-orchestrated` are deprecated aliases)
- PM tools (ClickUp, Jira, …): **optional** skills/rules — only if project requires it
