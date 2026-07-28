# Command: /continue-plan

## Goal

Resume a plan from the last handoff. Confirm the next unit, then execute **only that unit** (manual default).

## When to Use

- At the start of a new conversation after a handoff
- When you want to continue where you left off

## Hard stops

1. **Read `.cursor/HANDOFF.md` first.** No handoff → say so and suggest `/start-project`. Do not invent progress.
2. **Pre-flight (API/usage limit):** if `- **Mode:**`, `- **Gaps:**`, or `- **Instruction for the next agent:**` still records an API/usage limit hard stop from a prior tick, **do not** mark a to-do `in_progress`, dispatch a Task, or edit product files until the operator confirms recovery (switch from Auto to a named model such as Claude Opus, Sonnet 4.6, or Composer 2.5 Fast; and/or wait for quota reset). Surface recovery via **Ask questions** when available. **Fallback after Auto→Grok:** Grok 4.5 and Auto often lack Ask questions (see `.cursor/memory/decisions/2026-07-20_ask-questions-model-availability.md`); use the numbered-list chat fallback (reply by number or label; typed answer = "Other"). Pre-flight is HANDOFF check plus operator model choice only; the kit has no remaining-quota API. Align with `context-guardian` Quota-blocked sessions and `/run-plan` Read-state pre-flight.
3. **Audits pre-flight** (config `externalPlanReview.preflight`: `off` | `warn` | `block`; missing = `off`): before the next-unit confirmation Ask, check owed / untriaged audits for the chosen plan slug (Field Report owed, untriaged `plan-monitor-*.md`, open cadence WARNING). `off`: skip. `warn`: surface once, then continue. `block`: arm via `.cursor/scripts/plan-external-review.sh` (prefer `--autonomous` when `mode: autonomous`, else `--paste-only`) or stop until the operator defers; never steal `/git-prod`. Distinct from the advisory pre-unit monitor skim below (ADR `2026-07-27_audits-autonomous-plan-review-contract.md`).
4. **Apply Agent Persona chrome.** Read `.cursor/context/config.json` for `agentPersona.modes.continue-plan` (fallback to legacy `workspaceSkin`, then "autopilot"). Use the corresponding persona's `chatHints` from `registry/personas/core/` for tone and confirmations.
5. **Confirm the next unit with Ask questions** before editing. Use concrete option labels (see What to Do step 5). Do not accept a typed "yes" as the gate.
6. **One unit per chat** (phase or one heavy to-do) unless the user explicitly ran `/run-plan`.
7. **Do not start a competing plan.** New goal requires `/start-project`, which parks the active plan and proceeds to create a new one.

## What to Do

1. **Read `.cursor/HANDOFF.md`** (required).

2. **Identify the state:**
   - Active plan
   - Phase completed
   - Pending to-dos
   - Instruction from the previous agent
   - Parked plans (mention only; do not start unless the user asks)

3. **Read the Context Pack** (if it exists) under `.cursor/context/current/`.

4. **Plan selection (if multiple resumable plans):**
   When multiple resumable plans exist, delegate the plan scanning to a **Task(explore) subagent** using the worker prompt template at `.cursor/context/templates/command-worker-prompt.md`.

   1. **Fill the template** — set these parameters:
      - **Repo:** `[absolute repo path]`
      - **Command:** `/continue-plan`
      - **Task description:** "Scan all plan files in `.cursor/plans/` and return a list of resumable plans (those with pending to-dos). Include plan name, current phase, and pending to-do ids."
      - **read_scope:** `[".cursor/plans/*.plan.md"]`
      - **worker_contract:** "list of resumable plans: name, current phase, pending to-do ids"
      - **max_ticks:** 1

   2. **Dispatch** a Task subagent with `subagent_type: explore`.

   3. **Read the worker summary** — the main window uses the structured plan list to build Ask questions options.

   4. **Present options** using **Ask questions** tool:
      > "Multiple plans available. Which one to continue?"
      
      Options: read from worker summary: `[plan-name-1.plan.md]` / `[plan-name-2.plan.md]` / `Create new plan instead`
   
   **Fallback:** If Task dispatch is unavailable, scan plans inline (same as pre-delegation behavior) and use **Ask questions** tool to pick which plan to resume. Fallback to chat if Ask questions unavailable.

5. **Pre-unit monitor skim (advisory):** before the confirmation Ask, skim `.cursor/memory/plan-monitor-<chosen-plan-slug>.md` (and theme-matched `plan-review-*` if present) for Still open / untriaged / GAP lines. Mention material residuals once in the confirmation prompt. Do **not** block resume solely on Review debt; Field Report and `/plan-review-triage` remain attention/HITL SoT (ADR `decisions/2026-07-27_plan-monitor-consumer-awareness.md`).

6. **Next to-do confirmation using Ask questions:**
   > "[Phase X/Y completed] Last step: [description]. Next: `[to-do-id]`. Start that unit only?"
   
   Use **Ask questions** tool with options: `Start [to-do-id]` / `Edit plan first` / `Switch to different plan` / `Stop here`
   
   **Fallback:** if Ask questions tool unavailable, ask the same options in chat.

7. **When the user picks `Start [to-do-id]`:** run only that unit. Keep plan to-do `status` updated (`pending` → `in_progress` → `completed`). Any other choice stops without editing.

8. **When that unit is done:** update HANDOFF, stop, suggest `/git-staging` if there is a diff, and ask for a **new** conversation with `/continue-plan` for the next phase (manual mode).

## Typical flow

```
User: /continue-plan
Agent: Reading HANDOFF... Phase 2/5 done. Next: create-auth-service only.
       Ask questions: Start create-auth-service / Edit plan first / Switch to different plan / Stop here
User: [clicks Start create-auth-service]
Agent: [Does that to-do] -> updates HANDOFF -> stops; suggests /git-staging if diff
```

**Fallback:** if Ask questions tool unavailable, present the same four options as a numbered list in chat (user replies with number or label; "Other" = type their own answer).

## Tip

If the handoff is outdated:
> "Explain where we left off and what's left to do"

Multi-phase in one window: user must opt into `/run-plan`.
