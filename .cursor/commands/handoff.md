# Command: /handoff

## Goal

Update the handoff document to preserve current state and allow continuation in a new conversation.

**Runs in the main window by default.** Do not dispatch this command to a Task subagent by default; Task isolation is opt-in and used only when the kit repo wants it.

## When to Use

- At the end of each phase of a plan
- When context is getting full
- Before pausing work for an extended period
- When you want to record progress

## What to Do

1. **Check the active task:**
   - Check whether a Context Pack exists in `.cursor/context/current/`
   - Check whether an active plan exists in `.cursor/plans/`

2. **Update `.cursor/HANDOFF.md` with:**
   - Plan name (file)
   - Last updated (timestamp)
   - Phase completed
   - Completed to-dos (ids)
   - Next phase
   - Next to-dos (ids)
   - Clear instruction for the next agent (1-3 sentences)

3. **DevOps spine (suggest, do not run without being asked):**
   - If the phase produced commitable code, suggest `/git-staging` to promote to pre-prod.
   - If there was an error or a tradeoff decision, suggest a memory-loop WRITE (`.cursor/memory/`).
   - Never suggest committing directly to `main`; production only via `/git-prod` after staging.

4. **Respond to the user:**
   > "Handoff updated! Continue: `/continue-plan`. With code ready: `/git-staging`. Production: `/git-prod`."

## CLI alternative

```bash
./cursor-handoff handoff
# or: agent-kit handoff
```

This updates HANDOFF.md based on the active plan / Context Pack.

## Full loop

```
plan -> work -> /handoff -> /git-staging -> (approval) -> /git-prod -> memory
```
