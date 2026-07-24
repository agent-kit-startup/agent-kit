# Command: /agent-kit-onboard

## Goal

Prepare and validate repository readiness before `/start-project`. This command is the sole Agent Kit coordinator for repository preparation.

## Hard Stops

1. Do not ask about workspace skins, external plan review, or a first deliverable before essential readiness is complete.
2. Ask one concrete Ask questions question at a time, and only when scanner evidence cannot resolve intent.
3. Do not initialize Git, create or publish branches, add or change remotes, install hooks, create CI or deployment configuration, change protection, or perform another external or destructive mutation without explicit Ask questions confirmation.
4. A skipped or cancelled answer stops the proposed action.
5. Do not write a plan or edit product code. `/start-project` owns deliverable planning.

## Start or Resume

1. Run `agent-kit doctor --json` from the repository root. If `agent-kit` is unavailable on `PATH`, run `npx @dadado/agent-kit-cli doctor --json`.
2. This refreshes `.cursor/context/readiness.json`. Read the returned report, `.cursor/context/readiness.json`, `.cursor/context/config.json`, and `.cursor/agent-kit.config.json` when present.
3. Preserve an active plan or HANDOFF. Repository readiness guidance must not replace or restart active work.
4. Derive unresolved essential checks from `pillars[].checks[]`: select checks where `essential: true` and `status` is not `ready`, preserve report order, then use that check's `actions` for the next step. Do not treat `pendingActions` as an essential-only queue.
5. Resume the first unresolved essential check before considering any non-essential action. Do not restart completed checks or repeat confirmed facts.

## First Useful Message

The first useful message must contain these four items in this order:

1. `Repository preparation: N of M essential checks ready.`
2. `Detected:` concise facts supported by report evidence.
3. `Fixed:` safe local fixes already applied, or `none`.
4. `Next:` exactly one action, using the first unresolved essential check.

Do not append a second call to action, settings menu, command overview, or unrelated welcome.

## Progressive Resolution

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

- Run local, reversible, idempotent, merge-safe repairs with `agent-kit doctor --fix-safe --json`.
- After any confirmed or manual action, rerun `agent-kit doctor --json` and re-read the refreshed snapshot.
- Revalidate the affected check before advancing.
- Persist explicit non-blocking deferrals in `.cursor/context/config.json` under `onboarding.deferredItems` with `checkId`, `reason`, and `recoveryCommand`. Merge without removing existing keys.
- Essential checks cannot be completed by deferral. Only a non-essential unresolved check may be deferred, and its deferral must be explicit, non-blocking, include a reason, and include a recovery action.
- A check with `status: "blocked"` cannot be deferred, regardless of whether it is essential.

## Completion

Completion requires every essential check to be ready. Every remaining non-essential check must be ready or have a valid explicit deferral with a reason and recovery action.

When complete:

1. Run `agent-kit doctor --json` once more and read the refreshed report before writing completion state.
2. Verify every check in `pillars[].checks[]` with `essential: true` has `status: "ready"`.
3. Verify each remaining non-essential check is ready or explicitly deferred with both a reason and recovery action. Reject deferral for any check with `status: "blocked"`.
4. If verification fails, leave `onboarding.status: "in_progress"` and `onboarded` unchanged, then resume the first unresolved essential check derived from `pillars[].checks[]`.
5. Only after verification passes, merge `onboarding.status: "completed"` and `onboarded: true` into `.cursor/context/config.json` without removing other keys.
6. End with exactly one call to action:
   - `Next: /start-project` when the user wants to plan a deliverable.
   - `Next: finish setup` when no deliverable should start now.

Workspace skins remain available through later personalization or settings. External review is offered only when a plan reaches exhaustion.
