---
name: agent-kit-onboard
description: Prepare and validate repository readiness before /start-project.
---

# Command: /agent-kit-onboard

## Goal

Prepare and validate repository readiness before `/start-project`. This command is the sole Agent Kit coordinator for repository preparation.

## Hard Stops

1. Do not ask about Agent Personas, external plan review, or a first deliverable before essential readiness is complete.
2. Ask one concrete Ask questions question at a time, and only when scanner evidence cannot resolve intent.
3. Do not initialize Git, create or publish branches, add or change remotes, install hooks, create CI or deployment configuration, change protection, or perform another external or destructive mutation without explicit Ask questions confirmation.
4. A skipped or cancelled answer stops the proposed action.
5. Do not write a plan or edit product code. `/start-project` owns deliverable planning.

## Start or Resume

> **Delegation note:** The initial `agent-kit doctor --json` execution and readiness file reading below is performed by a **Task(explore) subagent** dispatched from this step. The parameters define the specification of what the worker scans. See below for the delegation pattern.

1. **Fill the template** — set these parameters:
   - **Repo:** `[absolute repo path]`
   - **Command:** `/agent-kit-onboard`
   - **Task description:** "Run `agent-kit doctor --json` (or `npx @dadado/agent-kit-cli doctor --json` as fallback), read the report output, `.cursor/context/readiness.json`, `.cursor/context/config.json`, and `.cursor/agent-kit.config.json`. Return a structured readiness report with: essential checks status, non-essential checks status, detected purpose/stack/git facts."
   - **read_scope:** `[".cursor/context/readiness.json", ".cursor/context/config.json", ".cursor/agent-kit.config.json"]`
   - **worker_contract:** "structured readiness report: list of essential checks and their status, non-essential checks and their status, detected facts about the repository"
   - **max_ticks:** 2

2. **Dispatch** a Task subagent with `subagent_type: explore`.

3. **Read the worker summary** — the main window uses the readiness report for the next steps.

4. Preserve an active plan or HANDOFF. Repository readiness guidance must not replace or restart active work.

5. Derive unresolved essential checks from `pillars[].checks[]`: select checks where `essential: true` and `status` is not `ready`, preserve report order, then use that check's `actions` for the next step. Do not treat `pendingActions` as an essential-only queue.

6. Resume the first unresolved essential check before considering any non-essential action. Do not restart completed checks or repeat confirmed facts.

**Fallback:** If Task dispatch is unavailable, run the doctor scan and file reads inline (same as pre-delegation behavior: run `agent-kit doctor --json`, read the returned report, `.cursor/context/readiness.json`, `.cursor/context/config.json`, and `.cursor/agent-kit.config.json` when present).

## First Useful Message

The first useful message must contain these four items in this order:

1. `Repository preparation: N of M essential checks ready.`
2. `Detected:` concise facts supported by report evidence.
3. `Fixed:` safe local fixes already applied, or `none`.
4. `Next:` exactly one action, using the first unresolved essential check.

Do not append a second call to action, settings menu, command overview, or unrelated welcome.

## Progressive Resolution

> **Delegation note:** The main window owns all HITL (Ask questions) and decision-making in this section. After each user decision/confirmation, the re-scan sub-step ("rerun `agent-kit doctor --json`") can be delegated to a Task(explore) subagent using the same pattern as the Start or Resume section above. The main window reads the worker summary and makes the next decision.

Resolve the first pending essential check according to its evidence and recommendation:

1. **Purpose and context:** use README, docs, manifests, workflows, schemas, and existing guidance. Ask only if purpose or source-of-truth context remains ambiguous.
2. **Git operating model:** distinguish no Git, local-only Git, and hosted Git. Treat local-only as valid. Confirm Git initialization and remote setup separately.
3. **Provider:** use explicit configuration, authenticated metadata, known hostnames, and provider files in that order. A custom hostname alone does not identify a provider.
4. **Branch strategy:** preserve existing conventions. Ask before creating, renaming, publishing, or deleting a branch, including `staging`.
5. **Safety and hooks:** safe `.gitignore` merges may use `agent-kit doctor --fix-safe --json`. Ask before installing or replacing hooks.
6. **Quality, CI, and deploy:** infer existing commands and files. Ask before creating CI or deployment configuration. Authentication, permissions, external secrets, and branch protection remain guided manual actions.
7. **Manual blockers:** state the blocker, one recovery action, and the exact check that will be revalidated.

Ask questions labels must describe the concrete effect. Examples:

- `Keep repository without Git` / `Initialize local Git` / `Stop setup`
- `Keep local-only repository` / `Configure a remote` / `Defer remote setup`
- `Confirm GitLab self-hosted` / `Confirm another provider` / `Leave provider unresolved`
- `Keep current branch strategy` / `Create staging branch` / `Defer branch setup`
- `Install Agent Kit hooks` / `Keep existing hooks` / `Show manual integration`
- `Create CI configuration` / `Keep local validation only` / `Defer CI setup`

When Ask questions is unavailable, say so once and present the same options as a numbered list. Accept the number, label, or a custom answer. Do not invent a tool call.

## Actions and Revalidation

> **Delegation note:** The re-scan step below can use the same delegation pattern as the Start or Resume section. Delegate `agent-kit doctor --json` execution to a Task(explore) subagent; the main window reads the readiness report and applies decisions.

- Run local, reversible, idempotent, merge-safe repairs with `agent-kit doctor --fix-safe --json`.
- After any confirmed or manual action, rerun `agent-kit doctor --json` and re-read the refreshed snapshot.
- Revalidate the affected check before advancing.
- Persist explicit non-blocking deferrals in `.cursor/context/config.json` under `onboarding.deferredItems` with `checkId`, `reason`, and `recoveryCommand`. Merge without removing existing keys.
- Essential checks cannot be completed by deferral. Only a non-essential unresolved check may be deferred, and its deferral must be explicit, non-blocking, include a reason, and include a recovery action.
- A check with `status: "blocked"` cannot be deferred, regardless of whether it is essential.

## Completion

> **Delegation note:** The final `agent-kit doctor --json` run (step 1 below) can use the same delegation pattern as the Start or Resume section.

Completion requires every essential check to be ready. Every remaining non-essential check must be ready or have a valid explicit deferral with a reason and recovery action.

When complete:

1. Run `agent-kit doctor --json` once more and read the refreshed report before writing completion state.
2. Verify every check in `pillars[].checks[]` with `essential: true` has `status: "ready"`.
3. Verify each remaining non-essential check is ready or explicitly deferred with both a reason and recovery action. Reject deferral for any check with `status: "blocked"`.
4. If verification fails, leave `onboarding.status: "in_progress"` and `onboarded` unchanged, then resume the first unresolved essential check derived from `pillars[].checks[]`.
5. Only after verification passes, merge `onboarding.status: "completed"` and `onboarded: true` into `.cursor/context/config.json` without removing other keys.
6. **Domain-skills scaffold (optional HITL).** Before showing the final finish-setup CTA, run the scaffold gate:
   - Read `.cursor/context/personalization.json` and `.cursor/agent-kit.config.json` to reuse install-time evidence. Do not invent a second detector.
   - Build a short proposal from the already-applied L2 skills and L1 packs in personalization, plus any project-owned domain skills implied by the profile but not yet installed.
   - Ask one question using **Ask questions** with concrete options:

     > "Essentials are ready. Before finish setup, scaffold domain skills from the detected profile?"

     Options: `Scaffold domain skills` / `Defer (record reason)` / `Skip`

   - **Fallback when Ask questions is unavailable:** present the same options as a numbered list, ask the user to reply with the number or the label, and note they can always **type their own answer** if none of the options fit (equivalent of the built-in "Other" choice).
   - **Scaffold domain skills:** show the proposal list, then write any accepted project-owned skills under `.cursor/skills/domain/<skill-id>/SKILL.md` only when the path does not already exist. Update the **Relevant skills** section of `.cursor/project-context.md` (create the heading if missing) with installed and newly accepted skill ids plus evidence; also ensure those ids appear under `.cursor/agent-kit.json` `skills[]` when that manifest is the project's install index. Record `onboarding.domainSkills` in `.cursor/context/config.json` with `status: "applied"`, the list of accepted items, and `appliedAt`.
   - **Defer:** ask for a short reason, then record `onboarding.domainSkills` with `status: "deferred"`, `reason`, and `recoveryCommand: "/agent-kit-onboard"`.
   - **Skip:** record `onboarding.domainSkills` with `status: "skipped"`.
   - Never overwrite an existing project-owned skill or file without a separate HITL confirmation. This closes the gap reported in public issue https://github.com/agent-kit-startup/agent-kit/issues/36 and the dogfood note `dogfood/cursor_onboard_should_scaffold_domain_skills_2026_08_01.md`.
   - **Instruction-only surface:** this gate is chat/`/agent-kit-onboard` prose executed by the agent session. There is no separate CLI subcommand that scaffolds domain skills; intentionally document defer/skip when the operator declines. Project-owned skills under `.cursor/skills/domain/` are one-way (not contributeable via `guessRegistryPath` / registry paths `core` and `community` only).
7. End with exactly one call to action:
   - `Next: /start-project` when the user wants to plan a deliverable.
   - `Next: finish setup` when no deliverable should start now.

After essentials are ready, `/agent-kit-onboard` offers one optional HITL gate: a **domain-skills scaffold** derived from the install-time personalization/doctor evidence. This gate is not a readiness blocker; deferring or skipping it must still allow `/start-project` to proceed. Mission Control is also **optional** and **not** an essential readiness check. Consumer L0 installs the `/dashboard` command text but not `dashboard/**`. If the operator wants the panel, `agent-kit dashboard` serves it from the installed CLI (4.8.2 onward); on older pins point them to an agent-kit checkout that includes `dashboard/start.mjs` (loopback `http://127.0.0.1:3333`). Do not block `/start-project` on Mission Control or on the domain-skills scaffold. Do not ask about skins or external review before essentials (Hard Stop 1).

Agent Personas remain available through later personalization or settings. External review is offered only when a plan reaches exhaustion.
