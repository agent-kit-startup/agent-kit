# Command: /start-project

## Goal

Bootstrap a **plan with to-dos** from any user payload. This command does **not** mean "start coding."

## When to Use

- First time using Agent Kit
- When there is no active plan or Context Pack  
- When you want to start a **new** project/task

## Hard stops (kit failure if skipped)

These are non-negotiable in manual mode:

1. **Broad Intake Review first.** Before proposing or writing a plan, run the Broad Intake Review (see below) to scan active session, plans, memory, docs, git state, and product version. Use findings for conflict triage.
2. **Plan file before any product edit.** Do not modify agents, skills, rules, app code, registry, or docs-of-record while creating the plan. Allowed writes in the bootstrap turn: the new `.cursor/plans/*.plan.md` and updated HANDOFF that parks any prior active plan.
3. **Goal in the same message is not execute permission.** `/start-project scan the repo and fix X` still goes through the gates below. Never jump to Explore → Edit.
4. **Two gates, two user "yes" answers:**
   - **Gate A (approve plan):** propose phases/to-dos → write the plan file → stop and ask using **Ask questions** tool.
   - **Gate B (approve first unit):** only after Gate A is accepted → run **one** phase or one heavy to-do → update HANDOFF → stop again.
5. **Forbidden phrasing / behavior:** "I'll create a plan and start Phase 1", chaining Gate A+B in one turn, or running the whole plan unless the user explicitly used `/run-plan`.

## Broad Intake Review (required before plan proposal)

Before proposing or writing a new plan, **scan** these sources (read/skim; do not deep-dive every file) and use findings for conflict triage:

| Bucket | What to check | How / typical paths |
|--------|---------------|---------------------|
| **Active session** | HANDOFF, Context Pack | `.cursor/HANDOFF.md`, `.cursor/context/current/` |
| **Plans** | In-progress + recent parked/related | `.cursor/plans/*.plan.md` (status in frontmatter) |
| **Archived context** | Prior packs for same theme | `.cursor/context/archive/**` (if present; glob by topic) |
| **Decisions** | ADRs that constrain the goal | `.cursor/memory/decisions/`, `_index.md` Decisions table |
| **Memory** | Errors, audits, consolidations, review logs | `.cursor/memory/errors/`, `*.md` reviews/audits, `_index.md` |
| **Local docs** | SoT / inventories / getting-started that the goal touches | `docs/**`, especially files named in the payload or related SoT |
| **Working tree** | Uncommitted local work that would collide | `git status`, `git diff` (staged + unstaged); do not commit |
| **Recent commits** | What already shipped for this theme | `git log` (short, recent), related PR titles if available |
| **Product version** | Avoid stale version prose | `package.json`, `CHANGELOG.md` `[Unreleased]` / latest |

**Triage labels** (every relevant finding gets one):

- **ignore** — already a future/pending to-do on an active or parked plan; leave for `/continue-plan`
- **error** — completed work that overreached, contradicted HITL, or left a verifiable residual → **include** in the new plan
- **include** — new scope from the user payload, or residual not owned by another plan  
- **note** — operational gap (e.g. monitor misses tags); record in plan Constraints / Acceptance or memory, no code unless asked

## What to Do

### Step 1: Broad Intake Review

Run the Broad Intake Review (see above table) and triage all findings with labels (ignore/error/include/note).

### Step 2: Handle vague goals

If the goal is missing or vague, use **Ask questions** tool (fallback to chat if tool unavailable):
> "What's the goal of your project? (1-2 sentences)"

Wait for answer before proceeding.

### Step 3: Gate A (design only)

1. **Park prior active plan** if any exists: Read `.cursor/HANDOFF.md` and `.cursor/plans/` status. If an active plan exists, update HANDOFF to mark it as "Parked plan" and note the new plan is awaiting approval.

2. **Propose phases and to-dos** based on the goal and Broad Intake findings. Align with `autogit/plan-routine.md` and `.cursor/context/templates/plan.md`.

3. **Ask before writing** using **Ask questions** tool (fallback to chat if tool unavailable):
   > "Write this plan to `.cursor/plans/[name].plan.md` (to-dos in frontmatter, no coding yet)?"
   
   Options: `Write plan file` / `Modify proposal first` / `Cancel`

4. **On approval:** create the plan file. Update HANDOFF: active plan name, phase completed none / awaiting Gate B, next to-do id, instruction = wait for user to approve first unit.

5. **Stop and ask for Gate B** using **Ask questions** tool (fallback to chat if tool unavailable):
   > "Plan ready: `[path]`. First unit would be `[to-do-id]` only (manual = one phase per chat)."
   
   Options: `Start first unit` / `Switch to /run-plan` / `Edit plan first` / `Stop here`

### Step 4: Gate B (first unit only, after explicit approval)

1. Mark the to-do `in_progress`, do **only** that unit.
2. Mark it `completed`, update HANDOFF, suggest `/git-staging` if there is a diff.
3. Stop. Do not start the next phase in this chat (manual mode).

### Step 5: Footer (informational only)

After proposing the plan, list any in-progress or parked plans in one short block:

> **Other plans:** [plan names and status] — Use `/continue-plan` to resume.

## Ask questions requirement

**Gate A, Gate B, and vague-goal clarification MUST use Ask questions tool** (`AskQuestion` / ACP `cursor/ask_question`) instead of chat prompts like "type yes to continue." This opens clickable options in the IDE UI.

**Requirements:**
1. Use **Ask questions** for any confirmation, choice among options, or clarification before acting
2. Prefer one question at a time (or small coherent set if the product allows multi-question)  
3. Options must be concrete labels (e.g. `Write plan file`, `Start first unit`, `Skip for now`)
4. **Fallback:** if the tool is not available in the current session, say so once and ask the same options in chat

**Note:** Kit-wide contract: always-applied L0 rule [`.cursor/rules/hitl-ask-questions.mdc`](../rules/hitl-ask-questions.mdc).

## Onboarding flow (correct)

```
User: /start-project Build an authentication API with JWT  
Agent: [Broad Intake Review] No conflicts found.
       Proposed plan:
       0. Project setup
       1. Login/register  
       2. JWT access + refresh
       3. Auth middleware
       4. Tests
       [Ask questions: Write plan file? Options: Write plan file / Modify first / Cancel]
User: [clicks Write plan file]
Agent: [Writes plan + HANDOFF only] Plan ready.
       [Ask questions: Start "phase0-setup" only? Options: Start first unit / Switch to run-plan / Edit first / Stop here]
User: [clicks Start first unit]  
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
