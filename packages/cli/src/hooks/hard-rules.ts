/** Shared session hard rules injected on sessionStart (deny/annotate only; no stop). */
export const HARD_RULES = `# Agent Kit session hard rules (manual mode default)

1. **One phase per chat.** Finish the current phase (or one to-do if the phase is huge), update \`.cursor/HANDOFF.md\`, then STOP and ask the user before starting the next phase.
2. **Do not burn the window.** Never run an entire multi-phase plan in one conversation unless the user explicitly ran \`/run-plan\` (or a deprecated alias \`/run-plan-loop\` / \`/run-plan-orchestrated\`).
3. **Context questions are not optional.** If the user asks about context / contexto / window size, run the context-guardian protocol: warn, offer handoff, do NOT dismiss with "it's fine" and keep coding.
4. **Read HANDOFF first** when resuming. Do not restart the plan from scratch.
5. **Git:** suggest \`/git-staging\` after a phase with a diff; never \`/git-prod\` without explicit confirmation.
6. **HITL slash commands win.** When waiting for confirmation on \`/git-staging\` or \`/git-prod\` (or similar), do not divert to continue-plan / phase-boundary chatter; stay on that routine until the user answers.
7. **\`/start-project\` is plan bootstrap, not execute.** Broad Intake Review first, then two gates: (A) single composite question (with active plan: backlog+write / park+write / modify / cancel; without: write / modify / cancel) — approve/write the plan file only, (B) approve the first unit. Goal text in the same message is NOT permission to edit product files. Never "create plan and start Phase 1" in one turn. If HANDOFF already has an active plan, disposition is merged into Gate A composite options; never park silently. Gates use Ask questions per \`.cursor/rules/hitl-ask-questions.mdc\`. Fallback: one numbered list per message.
8. **\`/continue-plan\` waits for yes.** Summarize next \`[to-do-id]\`, then stop until the user confirms before editing.
9. **\`/run-plan-all\` is a pure orchestrator.** After the confirm queue Ask, dispatch one Task subagent per plan (run the \`/run-plan\` tick contract inside it); never implement to-dos, run tests, or write changelogs in the orchestrator window.
10. **Backlog CRUD never activates.** \`/backlog-add\` enqueues (Broad Intake + write Ask + plan file + HANDOFF Backlog) without park, activate, or Gate B. \`/backlog-edit\` / \`/backlog-delete\` / \`/backlog-cancel\` require Ask confirm before mutate; delete archives from Backlog, cancel is soft in place. No Field Report cards for routine backlog CRUD.
11. **HANDOFF machine fields are bullet fields, not \`##\` headings.** Mission Control parses \`- **Plan:**\`, \`- **Backlog plans:**\`, \`- **Parked plans:**\`, \`- **Run queue:**\` (etc.). Canonical Plan: \`- **Plan:** \\\`name.plan.md\\\`\` or \`none\`. Nested backlog/parked rows: \`- \\\`other.plan.md\\\`\`. Never invent \`## Backlog plans\` / \`## Parked plans\` / \`## Run queue\` headings in place of those fields (Checklist / Current mission go empty or idle).`;

export const DOGFOOD_INBOX_HINT = `## Dogfood inbox

Unprocessed files are listed under \`dogfood/README.md\` (### Unprocessed Files). Follow the ingest ritual there (detect → analyze → memory WRITE → triage). Do not auto-start analysis unless the user asks.`;

export const UPDATE_CHECK_NUDGE = `## Agent Kit update available

Installed **v{installed}**; latest public **v{latest}**.

This is an advisory only (no files were changed). To apply, run \`/update\` and confirm via Ask questions. Bare \`agent-kit update\` is an explicit operator invoke, not a background job.`;
