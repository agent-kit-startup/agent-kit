# Command: /continue-plan

## Goal

Resume a plan or task from the last handoff.

## When to Use

- At the start of a new conversation after a handoff
- When you want to continue where you left off

## What to Do

1. **Read `.cursor/HANDOFF.md`** (required)
   - If it does not exist: tell the user there is no recorded handoff and suggest `/start-project`

2. **Identify the state:**
   - Which plan is active
   - Which phase was completed
   - Which to-dos are pending
   - Instruction left by the previous agent

3. **Read the Context Pack** (if it exists):
   - Check `.cursor/context/current/` for state details
   - Check touched files, decisions, constraints

4. **Summarize for the user:**
   > "[Phase X/Y completed] Last step: [description]. Next: [to-do]. Ready?"

5. **Continue only the indicated next to-do / phase** (manual default). Do not chain the rest of the plan in this chat.

6. **When that unit is done:** update HANDOFF, stop, suggest `/git-staging` if there is a diff, and ask the user to open a **new** conversation with `/continue-plan` for the next phase.

## Typical flow

```
User: /continue-plan
Agent: Reading HANDOFF.md... Phase 2/5 completed. Next: implement authentication.
Agent: I'll start with the to-do "create-auth-service" only. Sound good?
User: yes
Agent: [Does that to-do] -> updates HANDOFF -> stops and asks before phase 3
```

## Tip

If the handoff is outdated or unclear, the user can ask for a summary:
> "Explain where we left off and what's left to do"

If the user wants many phases in one window, they must opt into `/run-plan-loop` or `/run-plan-orchestrated`.
