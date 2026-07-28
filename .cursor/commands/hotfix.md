# Command: /hotfix

## Goal

Ship a **narrow, urgent change** as a **mini plan**, then run it continuously with the same tick contract as `/run-plan` (status per to-do, HANDOFF each tick, `/git-staging` on diff, never `/git-prod`).

Use when the work is too small for a full `/start-project` Broad Intake cycle but still needs a plan panel, HANDOFF, and staging discipline.

## When to Use

- Cosmetic or single-surface fixes (icons, copy, one CSS token, one harness assertion)
- Operator-locked glyph/map choices already confirmed in chat
- You want continuous ticks ("in a row") without inventing a large multi-phase plan

Prefer `/start-project` for new features, ambiguous scope, or multi-domain work. Prefer `/backlog-add` when you only want to enqueue without running.

## Usage

```
/hotfix <goal>
```

Example: `/hotfix Monitor delivery subtype glyphs (BMP map locked in chat)`

## Hard stops

1. **Scope must be narrow.** If the goal needs Broad Intake, Gate A/B, or more than ~4 to-dos / 2 phases, stop and redirect to `/start-project` or `/backlog-add`.
2. **Confirm before write + run** with **Ask questions** (chat numbered-list fallback). Options:
   - `Write mini plan and run`
   - `Write mini plan only (stop)`
   - `Modify proposal first`
   - `Cancel`
3. **Never `/git-prod`.** Staging only via the `/run-plan` tick-close path.
4. **Park before activate when needed.** If HANDOFF `- **Plan:**` points at a plan with pending/in_progress to-dos, park it (append under `- **Parked plans:**`) before activating the hotfix plan. Exhausted/completed active plans may be replaced without a park row.
5. **Do not rewrite an in-flight `/run-plan-all` queue** (`- **Queue status:**` `running`). Finish, stop, or Ask to pause the queue first.
6. **API/usage limit pre-flight** same as `/run-plan` (refuse auto-run while HANDOFF still records a quota hard stop).
7. **Audits pre-flight** same as `/run-plan` / `/continue-plan` (`externalPlanReview.preflight`: `off` | `warn` | `block`).

## Persona

Reuse `agentPersona.modes.run-plan` (fallback Night Shift / `config.example.json`). Chat chrome only; HITL labels stay concrete.

## What to Do

### 1. Read state

- `.cursor/HANDOFF.md` (required)
- Goal from the slash message (or Ask if missing/vague)
- Skim theme-matched `.cursor/memory/plan-monitor-*.md` for open residuals (advisory; do not block solely on Review debt)

### 2. Propose a mini plan

Author a plan under `.cursor/plans/` with:

| Constraint | Rule |
|------------|------|
| Name | Prefer `hotfix-<slug>.plan.md` |
| Size | ≤ 4 to-dos, ≤ 2 phases (typical: lock → implement → tests/CHANGELOG) |
| Frontmatter | Always include `todos` with `status`; optional `read_scope` / `worker_contract` / `max_ticks` / `inline_first` |
| Body | Goal, locked decisions (glyphs, tokens), Acceptance, Constraints (out of scope) |

Align with `.cursor/context/templates/plan.md` and `autogit/plan-routine.md`. Skip full Broad Intake unless the goal is vague or conflicts with an open plan.

### 3. Confirm (HITL)

Ask questions with the four options above. **Cancel / skipped:** stop, no writes. **Modify:** revise and Ask again. **Write mini plan only:** write plan + set HANDOFF active (Mode `hotfix`), do **not** start ticks. **Write mini plan and run:** write, activate, then step 4.

### 4. Activate

Update `.cursor/HANDOFF.md`:

- `- **Plan:**` → hotfix plan basename
- `- **Mode:**` → `hotfix` (while running continuous ticks, agents may mirror `run-plan (<strategy>)` in Instruction; keep `hotfix` as the Mode root so Mission Control can recognize the path)
- Phase / next to-dos from the mini plan
- Preserve `- **Backlog plans:**` / `- **Parked plans:**` / queue fields unless parking the prior active plan

### 5. Run (same tick contract as `/run-plan`)

Follow [`.cursor/commands/run-plan.md`](run-plan.md) tick contract end-to-end:

1. Read state → next pending to-do → `in_progress`
2. Execute (orchestrated Task or in-session; inline-first rules unchanged)
3. Close tick: `completed` + HANDOFF + cadence bump + `/git-staging` on diff (add-by-name for monitors)
4. Reschedule until exhausted or blocked

Overrides vs full `/run-plan`:

- Default expectation is a **short** run (hours/minutes, not multi-day)
- External plan review at exhaustion: same `externalPlanReview` rules as `/run-plan` (enabled → autonomous or paste per `mode`; else `offerOnExhausted` Ask)
- Still never steal `/git-prod` confirmation

### 6. Exhausted

Final HANDOFF (`Mode: hotfix — STOPPED: plan exhausted` or equivalent). Suggest `/git-prod` only if staging is ahead of `main` (separate HITL).

## Typical flow

```
User: /hotfix Swap Monitor delivery subtype glyphs (map locked)
Agent: Mini plan proposed (3 to-dos). Ask: Write mini plan and run / …
User: [Write mini plan and run]
Agent: Writes hotfix-….plan.md → HANDOFF Mode hotfix → run-plan ticks → staging PRs → stop
```

## Relation to other commands

| Command | Difference |
|---------|------------|
| `/start-project` | Full Broad Intake + Gate A/B; not for tiny urgent patches |
| `/backlog-add` | Enqueue only; never activates or runs |
| `/run-plan` | Continuous runner for an **existing** active plan |
| `/run-plan-all` | Multi-plan queue; do not start a hotfix while queue `running` |
| `/continue-plan` | Manual one-unit gate; hotfix defaults to continuous |

## Troubleshooting

- **"Too large for /hotfix"** → `/start-project` or `/backlog-add`
- **"Queue running"** → stop or finish `/run-plan-all` first
- **"Ambiguous glyphs/tokens"** → Ask to lock the map before Write and run
