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

1. **Fill the template** using `.cursor/context/templates/command-worker-prompt.md` (Repo, Command, Task description, `read_scope`, `worker_contract`, `max_ticks`); exact field values: [procedure.md](../skills/core/agent-kit-onboard/procedure.md).

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

> **Delegation note:** same Task(explore) pattern as Start or Resume, applied only to the re-scan sub-step; the main window owns all HITL and decisions here.

Per-check resolution guidance and exact Ask-label examples: [procedure.md](../skills/core/agent-kit-onboard/procedure.md).


## Actions and Revalidation

> **Delegation note:** same pattern as Start or Resume, applied to this section's re-scan step.

- Run local, reversible, idempotent, merge-safe repairs with `agent-kit doctor --fix-safe --json`.
- After any confirmed or manual action, rerun `agent-kit doctor --json` and re-read the refreshed snapshot.
- Revalidate the affected check before advancing.
- Persist explicit non-blocking deferrals in `.cursor/context/config.json` under `onboarding.deferredItems` with `checkId`, `reason`, and `recoveryCommand`. Merge without removing existing keys.
- **Essential checks cannot be completed by deferral when the scanner offers a concrete action for them.** One exception (Amend 2026-09-20, ADR `decisions/2026-07-28_onboarding-completion-nonessential-deferral.md`): an essential check with zero listed actions may be completed by an explicit deferral. See Completion step 2 below for the exact enforcement rule.
- A check with `status: "blocked"` cannot be deferred, regardless of whether it is essential.
- `agent-kit doctor` prints `Deferred essential: <check-id> — <reason>` for each essential check completed this way (also in the `--json` output as `deferredEssentials`), so "onboarding completed" is never silently indistinguishable from "every essential check is truly ready."

## Completion

> **Delegation note:** same pattern as Start or Resume, applied to the final re-scan (step 1 below).

Completion requires every essential check to be ready, **or**, for an essential check with zero listed actions only, explicitly deferred with a reason and recovery action (Amend 2026-09-20). Every remaining non-essential check must be ready or have a valid explicit deferral with a reason and recovery action.

When complete:

1. Run `agent-kit doctor --json` once more and read the refreshed report before writing completion state.
2. Verify every check in `pillars[].checks[]` with `essential: true` has `status: "ready"`, **or** has zero `actions` and an explicit deferral (reason + recovery command) in `onboarding.deferredItems`. An essential check with a listed action always resolves through that action, never a deferral, no matter its status.
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

Domain-skills scaffold execution detail (what happens after each label): [procedure.md](../skills/core/agent-kit-onboard/procedure.md).

7. End with exactly one call to action:
   - `Next: /start-project` when the user wants to plan a deliverable.
   - `Next: finish setup` when no deliverable should start now.

The domain-skills scaffold gate is not a readiness blocker; deferring or skipping it must still allow `/start-project` to proceed.
Mission Control is also **optional** and **not** an essential readiness check. Consumer L0 installs the `/dashboard` command text but not `dashboard/**`; `agent-kit dashboard` serves the panel from the installed CLI (4.8.2 onward) when the operator wants it.
Do not block `/start-project` on Mission Control or on the domain-skills scaffold. Do not ask about skins or external review before essentials (Hard Stop 1).

Agent Personas remain available through later personalization or settings. External review is offered only when a plan reaches exhaustion.
