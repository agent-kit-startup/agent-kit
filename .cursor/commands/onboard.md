# Command: /onboard

## Goal

Run the **first-session welcome** for Agent Kit: short orientation, workspace skin preference, HITL choice to create a first plan or skip, and an `onboarded` marker so this does not repeat.

This command does **not** write a plan file. Plan bootstrap stays in `/start-project` (Gate A + Gate B).

## When to Use

- Right after install (CLI or chat/Port B), when the user opens the project in chat
- When there is no `"onboarded": true` in `.cursor/context/config.json`
- When the user asks how Agent Kit works for the first time

## Hard stops (kit failure if skipped)

1. **No plan files from `/onboard`.** Never write or invent `.cursor/plans/*.plan.md` here. Bridge only: tell the user to run `/start-project` (or offer to run that command's flow next).
2. **Do not collapse Gate A+B.** Creating a plan and starting Phase 1 in one turn is a `/start-project` failure, not something `/onboard` may shortcut.
3. **No product code edits** in this command (no agents, skills, app code, registry, or docs-of-record).
4. **No `/git-prod`.** Do not promote to production from onboarding.
5. **HITL via Ask questions** per [`.cursor/rules/hitl-ask-questions.mdc`](../rules/hitl-ask-questions.mdc). Prefer the Ask questions tool; if missing, say so once and present the same options as a numbered list (reply with number/label, or type your own).

## What to Do

### Step 0: Check the marker

Read `.cursor/context/config.json` (create nothing yet).

### Branch A: Already onboarded (`"onboarded": true`)

1. Short message: onboarding already ran for this project.
2. Use **Ask questions** (chat fallback if tool unavailable):
   - Options: `Start a plan (/start-project)` / `Continue plan (/continue-plan)` / `Change workspace skin` / `Show commands overview` / `Done`
3. Act only on the choice (point them at the matching slash command, or list key commands briefly for overview). **Stop.** Do not rewrite `onboarded`.
4. **On `Change workspace skin`:** run **Step Skin** below, then stop (do not rewrite `onboarded`).

### Branch B: First time (marker missing or false)

1. **Welcome (short):**
   > Agent Kit keeps work in **plans** with to-dos and a **handoff** so you can continue in a new chat when context fills up. Default: **one phase per chat**. Multi-phase in one window only with `/run-plan`.

2. **Key commands (one line each):**
   - `/start-project` - bootstrap a plan (design first, then optional first unit)
   - `/continue-plan` - resume from HANDOFF / next to-do
   - `/handoff` - save phase state for a fresh conversation
   - `/git-staging` - promote work to staging (not `main`)
   - `/git-prod` - promote approved staging to production (explicit confirm)

3. Run **Step Skin** (workspace chrome preference).

4. Run **Step External Review** (opt-in Claude plan review; default Skip).

5. Use **Ask questions** (chat fallback if tool unavailable):
   > Want to create your first plan?
   - Options: `Create first plan` / `Skip for now` / `Learn more`

6. **On `Create first plan`:**
   - Tell the user to run `/start-project` with their goal (1-2 sentences), **or** offer to run `/start-project`'s flow next in this chat.
   - Do **not** write a plan file inside `/onboard`.
   - Then set the marker (Step Marker).

7. **On `Learn more`:**
   - 2-4 sentences: plan with to-dos → work one phase → `/handoff` when pausing or context is full → `/git-staging` for pre-prod → `/git-prod` only after staging approval.
   - Re-ask with the same Ask questions options: `Create first plan` / `Skip for now` / `Learn more` (or omit Learn more on the re-ask if they already saw it).

8. **On `Skip for now`:**
   - Confirm structure is ready. They can run `/onboard` or `/start-project` later.
   - Then set the marker (Step Marker).

### Step Skin: Workspace skin preference

Skins affect **chat tone chrome and CLI banners only** (see `docs/skins-contract.md`). They never change commits, HANDOFF, memory, or product docs. Built-ins: `registry/skins/core/` (community packs: Phase 5 / contribute docs).

1. Use **Ask questions** (chat fallback if tool unavailable):
   > Pick a workspace skin for chat/CLI chrome?
   - Options: `Keep mode defaults (Autopilot/Night Shift/Ghost Runner per mode)` / `Autopilot` / `Night Shift` / `Ghost Runner` / `Skip for now`

2. **Persist** by merging into `.cursor/context/config.json` under `workspaceSkin`. Ensure `.cursor/context/` exists. **Preserve** existing keys (`onboarded`, `autoHandoff`, `externalPlanReview`, etc.). Do not wipe the file.

   | Choice | Write |
   |--------|-------|
   | `Keep mode defaults (...)` | Mode map from `.cursor/context/config.example.json` (`continue-plan`→autopilot, `run-plan`→night-shift, `cli-run-plan`→ghost-runner; `default`: `autopilot`) |
   | `Autopilot` / `Night Shift` / `Ghost Runner` | Set `default` to that skin id (`autopilot` / `night-shift` / `ghost-runner`) and set **all** modes to the same id |
   | `Skip for now` | Do not change `workspaceSkin` (leave absent or as-is) |

3. Example mode-defaults payload:

```json
{
  "workspaceSkin": {
    "default": "autopilot",
    "modes": {
      "continue-plan": "autopilot",
      "run-plan": "night-shift",
      "cli-run-plan": "ghost-runner"
    }
  }
}
```

### Step External Review: Claude plan review opt-in

Default UX is **Skip** (opt-in). Never force a Claude install.

1. Use **Ask questions** (chat fallback if tool unavailable):
   > Enable Claude external plan review after plans finish?
   - Options: `Enable Claude external review` / `Skip for now`

2. **Persist** by merging into `.cursor/context/config.json` under `externalPlanReview`. Ensure `.cursor/context/` exists. **Preserve** existing keys (`onboarded`, `autoHandoff`, `workspaceSkin`, etc.). Do not wipe the file.

   | Choice | Write |
   |--------|-------|
   | `Enable Claude external review` | Full block: `enabled: true`, `backend: "claude"`, `autoRemediate: false`, `offerOnExhausted: true` |
   | `Skip for now` | Prefer full default block with `enabled: false` if missing; else merge `enabled: false` (keep other keys; ensure `offerOnExhausted: true` when writing the block for the first time) |

3. Example Enable payload:

```json
{
  "externalPlanReview": {
    "enabled": true,
    "backend": "claude",
    "autoRemediate": false,
    "offerOnExhausted": true
  }
}
```

### Step Marker: Set `onboarded` marker

After **Create first plan** (once bridged to `/start-project`) **or** **Skip for now**:

1. Ensure `.cursor/context/` exists.
2. Merge into `.cursor/context/config.json`: set `"onboarded": true`.
3. Preserve other keys (e.g. `autoHandoff`, `workspaceSkin`, `externalPlanReview`). If the file is missing, create `{ "onboarded": true }`.

Do **not** set the marker on `Learn more` alone (wait for Create or Skip).

## Ask questions requirement

First-session skin pick, first-session External Review Ask, first-session plan choice, and the already-onboarded menu **MUST** use Ask questions (`AskQuestion` / ACP `cursor/ask_question`) instead of "type yes to continue."

**Fallback:** if the tool is not in the session toolset, say so once, then present the same options as a numbered list. Tip: a model that supports Ask questions restores the clickable UI.

Kit-wide contract: [`.cursor/rules/hitl-ask-questions.mdc`](../rules/hitl-ask-questions.mdc).

## Relationship to `/start-project`

```
/onboard (welcome + skin HITL + external review HITL + plan HITL) -> user picks Create first plan
  -> /start-project (Gate A: write plan file; Gate B: first unit)
```

`/onboard` never invents phases/to-dos or writes `.cursor/plans/*.plan.md`.

## Tip

If install just finished and the user seems lost:
> "Start with `/onboard` for the welcome, then `/start-project` when you have a goal."
