# Command: /continue-plan

## Goal

Resume a plan from the last handoff. Confirm the next unit, then execute **only that unit** (manual default).

## When to Use

- At the start of a new conversation after a handoff
- When you want to continue where you left off

## Hard stops

1. **Read `.cursor/HANDOFF.md` first.** No handoff → say so and suggest `/start-project`. Do not invent progress.
2. **Summarize and wait for yes** before editing. "Ready?" / "Sound good?" is a real gate, not flavor text.
3. **One unit per chat** (phase or one heavy to-do) unless the user explicitly ran `/run-plan-loop` or `/run-plan-orchestrated`.
4. **Do not start a competing plan.** New goal → `/start-project` (continue vs park), not silent parallel work.

## What to Do

1. **Read `.cursor/HANDOFF.md`** (required).

2. **Identify the state:**
   - Active plan
   - Phase completed
   - Pending to-dos
   - Instruction from the previous agent
   - Parked plans (mention only; do not start unless the user asks)

3. **Read the Context Pack** (if it exists) under `.cursor/context/current/`.

4. **Summarize and stop for confirmation:**
   > "[Phase X/Y completed] Last step: [description]. Next: `[to-do-id]`. Start that unit only?"

5. **On yes:** run only that unit. Keep plan to-do `status` updated (`pending` → `in_progress` → `completed`).

6. **When that unit is done:** update HANDOFF, stop, suggest `/git-staging` if there is a diff, and ask for a **new** conversation with `/continue-plan` for the next phase (manual mode).

## Typical flow

```
User: /continue-plan
Agent: Reading HANDOFF... Phase 2/5 done. Next: create-auth-service only. Start it?
User: yes
Agent: [Does that to-do] -> updates HANDOFF -> stops; suggests /git-staging if diff
```

## Tip

If the handoff is outdated:
> "Explain where we left off and what's left to do"

Multi-phase in one window: user must opt into `/run-plan-loop` or `/run-plan-orchestrated`.
