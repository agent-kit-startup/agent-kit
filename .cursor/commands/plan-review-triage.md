# Command: /plan-review-triage

## Goal

Triage residuals from a **Claude external plan review** monitor. Read the latest monitor findings, summarize open residuals, and guide next steps with **Ask questions**.

## When to Use

- After Claude external plan review completed (monitor file exists under `.cursor/memory/plan-monitor-*.md`)
- You want to process findings from the monitor and decide next steps
- **Not for mid-plan reviews** - this command expects `completed` work only

## Preconditions

- A monitor file exists in `.cursor/memory/` with pattern `plan-monitor-*.md`
- Monitor has "Current state" or "Full review" section with residuals
- Plan referenced in the monitor has exhausted implementable to-dos

If no `plan-monitor-*.md` exists (external review never completed, or launcher tip/no-op): say so once, suggest `/plan-external-review` after prefight files exist, and **stop**. Do not invent residuals.

## What to Do

### Step 1: Read the monitor

1. **Find the latest monitor** via glob `.cursor/memory/plan-monitor-*.md` or use a specific file if provided by the user.

2. **Read the monitor file** prioritizing these sections in order:
   - **"Current state"** section (agent briefing) - latest residuals
   - **"Full review"** section - exhausted plan residuals  
   - **"Still open"** table - specific action items
   - **Standing findings** - cross-cutting issues

### Step 2: Summarize for the user

Present a concise summary:
> **Plan monitor findings for `[plan-name]`:**
> 
> **Closed:** [brief list of completed items]
> 
> **Still open:** [numbered list of residuals with IDs from monitor]

### Step 3: Ask for triage decision

Use **Ask questions** tool with these exact options:

> "How to handle the open residuals?"

Options: `Write residuals plan` / `Fix nits only` / `Ack and stop`

**Chat fallback:** if Ask questions tool unavailable, ask the same options in chat with clear labeling.

### Step 4: Execute the choice

#### A. `Write residuals plan`

1. **Guide to `/start-project`** with residuals as the goal payload:
   > "Use `/start-project` with this goal: [formatted residuals summary]"
   
2. **Remind about gates:** "Gate A/B still apply - plan creation and first unit need separate confirmations."

3. **Do not bypass** the `/start-project` gates; do not create the plan file directly

#### B. `Fix nits only`

1. **Confirm scope** with specific item list from monitor:
   > "Fixing these nits only: [list]. Proceed?"

2. **On confirmation:** implement only the small fixes listed as "nits" 
   - Typically: typos, formatting, small doc updates, obvious omissions
   - **Never:** architecture changes, new features, or multi-file refactors

3. **After fixes:** suggest `/git-staging` if there are changes

4. **Warn about multi-phase:** if fixes look substantial, stop and redirect to "Write residuals plan" instead

#### C. `Ack and stop`

1. **Update HANDOFF** with a note that the monitor was reviewed and acknowledged:
   ```
   Monitor: plan-monitor-[slug].md reviewed. Residuals acknowledged. No immediate action.
   ```

2. **No product edits** - just the HANDOFF note

3. **Confirm status:** monitor findings noted for future reference

## Hard stops

1. **Never treat Claude monitor as execute permission** - all paths require human confirmation
2. **Never `/git-prod`** from this command - residual fixes go through `/git-staging` only  
3. **Never auto-implement** without the triage choice above
4. **Never bypass `/start-project` gates** when creating residuals plan
5. **No broad scope creep** in "Fix nits only" - redirect to plan creation for substantial work

## Ask questions requirement

**All triage decisions MUST use Ask questions tool** per kit-wide contract (`.cursor/rules/hitl-ask-questions.mdc`). This creates clickable options in the IDE UI.

**Chat fallback only** if the tool is unavailable in the current session.

## Example flow

```
User: /plan-review-triage
Agent: Reading latest monitor... plan-monitor-auth-api.md
       
       Plan monitor findings for auth-api plan:
       
       Closed: JWT middleware, refresh tokens, basic tests
       
       Still open:
       A. Rate limiting missing from login endpoint
       B. Password strength validation not implemented  
       C. API docs missing error response formats
       
       [Ask questions: How to handle residuals? Options: Write residuals plan / Fix nits only / Ack and stop]
User: [clicks Write residuals plan]
Agent: Use /start-project with this goal: "Complete auth API residuals: rate limiting on login, password validation, API error docs"
       Gate A/B still apply for plan creation and first unit.
```

## References

- Monitor template: `.cursor/context/templates/plan-monitor.md`
- Plan creation: `.cursor/commands/start-project.md` 
- HITL contract: `.cursor/rules/hitl-ask-questions.mdc`
- Related: `.cursor/commands/plan-external-review.md`