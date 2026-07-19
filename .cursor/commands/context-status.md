# Command: /context-status

## Goal

Show the current context state: active task, handoff, archived tasks.

## When to Use

- When you want to know what is in progress
- To check whether there is an active task
- To list archived tasks

## What to Do

1. **Check the active task:**
   - Check `.cursor/context/current/` for an active Context Pack
   - Show task name and state summary

2. **Check HANDOFF.md:**
   - Check whether `.cursor/HANDOFF.md` exists
   - Show last update and next steps

3. **List archived tasks (last 5):**
   - Check `.cursor/context/archive/` for completed tasks

4. **Respond to the user:**

```
Context status

Active task: feature-auth (since 2024-01-15)
  - Phase: 2/5
  - Next to-do: implement-jwt

Handoff: updated on 2024-01-16 14:30
  - Instruction: "Continue JWT middleware implementation"

Archived (latest):
  - 2024-01/initial-setup
  - 2024-01/configure-db
```

## CLI alternative

```bash
./cursor-handoff status
```
