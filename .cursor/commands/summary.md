# Command: /summary

## Goal

Give a quick summary of the current state for a user who lost track of progress.

## When to Use

- When the user seems lost
- When they ask "where are we?", "what's left?", "summary"
- After long gaps without interaction

## What to Do

1. **Identify context:**
   - Read `.cursor/HANDOFF.md` if it exists
   - Read the active Context Pack if it exists
   - Consider the current conversation history

2. **Build a 3-part summary:**
   - **Done:** short list (max 3 items)
   - **In progress:** current task/to-do
   - **Left to do:** next steps (max 3 items)

3. **Ask for the next step:**
   > "Want to continue where we left off, or do something else?"

## Response format

```
Quick summary

Done:
- Folder structure created
- Basic auth implemented

In progress:
- Implement refresh token (to-do: refresh-token)

Next:
- Auth tests
- API documentation

Continue with the refresh token, or move to something else?
```

## Tip

Keep the summary short. If the user wants details, they will ask.
