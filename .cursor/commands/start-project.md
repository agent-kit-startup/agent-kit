# Command: /start-project

## Goal

First use after install, or whenever there is no active plan.

## When to Use

- First time using Agent Kit
- When there is no active plan or Context Pack
- When you want to start a new project/task

## What to Do

### First run (no plan/Context Pack yet):

1. **Ask for the goal:**
   > "Hey! What's the goal of your project? (1-2 sentences)"

2. **Create a plan with to-dos:**
   - Help the user define the main steps
   - Create a plan in `.cursor/plans/` from the template [`.cursor/context/templates/plan.md`](../context/templates/plan.md)
   - Frontmatter with `todos` (`id`, `content`, `status`); for long-running to-dos, fill in the budget fields (`read_scope`, `worker_contract`, `max_ticks`), see `autogit/plan-routine.md`
   - Suggest phases if the project is large

3. **Confirm before coding:**
   > "Plan created! Next: first to-do `[id]` only (manual mode = one phase per chat). Sound good?"

4. **After that to-do/phase:** update `.cursor/HANDOFF.md`, stop, and ask before the next phase. Do not run the whole plan in this chat unless the user switches to `/run-plan-loop` or `/run-plan-orchestrated`.

### If a plan/Context Pack already exists:

1. **Read current state:**
   - Check `.cursor/HANDOFF.md`
   - Check `.cursor/context/current/`
   - Check `.cursor/plans/`

2. **Summarize and suggest:**
   > "There's already a plan in progress: [name]. Phase 2/5. Continue, or start something new?"

## Onboarding flow

```
User: /start-project
Agent: Hey! What's the goal of your project?
User: Build an authentication API with JWT
Agent: Got it! I'll create a plan with the main steps:
       1. Project setup (deps, structure)
       2. Implement login/register
       3. Implement JWT (access + refresh)
       4. Auth middleware
       5. Tests
       Can I create this plan and start with setup?
User: yes
Agent: [Creates the plan, does ONLY the first to-do, updates HANDOFF, stops]
```

## Tip

If the user is not sure what they want, help them define it:
> "Not sure yet? Tell me a bit about what you want to build and we'll figure it out together."

Manual mode default: one phase per chat. Multi-phase in one window requires `/run-plan-loop` or `/run-plan-orchestrated`.
