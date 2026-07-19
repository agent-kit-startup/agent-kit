# Command: /start-project

## Goal

Bootstrap a **plan with to-dos**. This command does **not** mean "start coding."

## When to Use

- First time using Agent Kit
- When there is no active plan or Context Pack
- When you want to start a **new** project/task (and park or finish the current one)

## Hard stops (kit failure if skipped)

These are non-negotiable in manual mode:

1. **Plan file before any product edit.** Do not modify agents, skills, rules, app code, registry, or docs-of-record while inventing the plan. Allowed writes in the bootstrap turn: the new `.cursor/plans/*.plan.md` and (if needed) a short HANDOFF note that a plan is awaiting approval.
2. **Goal in the same message is not execute permission.** `/start-project scan the repo and fix X` still goes through the gates below. Never jump to Explore → Edit.
3. **Active HANDOFF / plan wins first.** If `.cursor/HANDOFF.md` or an in-progress plan exists, summarize it and ask **continue vs start new** before creating another plan.
4. **Two gates, two user "yes" answers:**
   - **Gate A (approve plan):** propose phases/to-dos → write the plan file → stop and ask.
   - **Gate B (approve first unit):** only after Gate A is accepted → run **one** phase or one heavy to-do → update HANDOFF → stop again.
5. **Forbidden phrasing / behavior:** "I'll create a plan and start Phase 1", chaining Gate A+B in one turn, or running the whole plan unless the user explicitly used `/run-plan`.

## What to Do

### A) Plan or Context Pack already exists

1. Read `.cursor/HANDOFF.md`, `.cursor/context/current/`, and `.cursor/plans/`.
2. Summarize and ask (stop here until the user answers):
   > "There's already a plan in progress: [name]. Phase X/Y, next `[to-do-id]`. Continue with `/continue-plan`, or park it and start something new?"
3. If **continue:** hand off to the `/continue-plan` routine (do not invent a parallel plan).
4. If **start new:** park the old plan in HANDOFF ("Parked plan"), then follow section B from Gate A.

### B) First run / new plan (no active plan, or user chose "start new")

#### Gate A: design only

1. If the goal is missing or vague, ask:
   > "Hey! What's the goal of your project? (1-2 sentences)"
2. Propose phases and to-dos in chat (short list). Align with `autogit/plan-routine.md` and `.cursor/context/templates/plan.md`.
3. Ask before writing the file:
   > "I can write this plan to `.cursor/plans/[name].plan.md` (to-dos in frontmatter, no coding yet). OK?"
4. On yes: create the plan file. Update HANDOFF: active plan name, phase completed none / awaiting Gate B, next to-do id, instruction = wait for user to approve first unit.
5. Stop. Ask:
   > "Plan ready: `[path]`. First unit would be `[to-do-id]` only (manual = one phase per chat). Start that unit, switch to `/run-plan` (continuous), or edit the plan first?"

#### Gate B: first unit only (after explicit yes)

1. Mark the to-do `in_progress`, do **only** that unit.
2. Mark it `completed`, update HANDOFF, suggest `/git-staging` if there is a diff.
3. Stop. Do not start the next phase in this chat (manual mode).

## Onboarding flow (correct)

```
User: /start-project Build an authentication API with JWT
Agent: No active handoff. Proposed plan:
       0. Project setup
       1. Login/register
       2. JWT access + refresh
       3. Auth middleware
       4. Tests
       Write this to .cursor/plans/...? (no coding yet)
User: yes
Agent: [Writes plan + HANDOFF only] Plan ready. Start to-do "phase0-setup" only?
User: yes
Agent: [Does phase0 only] -> HANDOFF -> stops; suggests /git-staging if diff
```

Wrong (do not do this):

```
User: /start-project ainda tem PT no repo, deixe EN
Agent: Scanning... creating plan and starting Phase 1... [edits files]
```

## Tip

If the user is unsure:
> "Not sure yet? Tell me a bit about what you want to build and we'll figure it out together."

Manual mode default: one phase per chat after Gate B. Multi-phase in one window requires `/run-plan`.
