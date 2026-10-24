# /field-report-resolve claim-check contract

Per-id-shape locate/check/dismiss-eligibility detail for `.cursor/commands/field-report-resolve.md` (Phase 2, `contract-read-budget-lazy-layers-2026-09-19` plan — moved out of the L0 command to fit its size budget; the top-level Validate/Load/Append/Write/Confirm steps and Hard stops stay in the command itself).

   **For `attention:prompt:<chatId>`:**
   - **Locate (delegated):** the transcript + subject-context scan is delegated to a **Task(explore)** subagent. Fill the worker prompt template (`.cursor/context/templates/command-worker-prompt.md`) with:
     - **Task description:** "Read the transcript at `~/.cursor/projects/<project-slug>/agent-transcripts/<id>/<id>.jsonl` (chatId is the UUID portion; bounded to 30-day window, 60 files, 1 MB per file). Determine whether the last agent-question tool call is followed by a user entry (`answered`). Also check named local project context (HANDOFF machine fields, exact `*.plan.md` refs + lifecycle, backlog/parked/archive matching the gated action) for whether the *subject* of that pending question is already settled (`subject_resolved`). Return path/plan basenames only as evidence; never return transcript or AskQuestion body."
     - **worker_contract:** "answered: true|false; subject_resolved: true|false; evidence: none | list of path/plan basenames only"
     - **read_scope:** `["~/.cursor/projects/<project-slug>/agent-transcripts/<id>/<id>.jsonl", ".cursor/HANDOFF.md", ".cursor/plans/*.plan.md", ".cursor/plans/archive/*.plan.md"]`
   - Dispatch the Task. Read the worker summary.
   - **Fallback:** if Task dispatch is unavailable, run the same locate/check inline.
   - **Check:** use the worker summary to determine eligibility. Dismiss eligible when `answered` **or** `subject_resolved` (and the id is not already in the store). Prefer false negatives: uncertain subject keeps the row.
   - **Update allowed:** none directly in resolve. Strong signals: (1) later user transcript entry after the agent question (`answered`), (2) every exact `*.plan.md` reference terminal from plan+HANDOFF, (3) named subject-resolved evidence per source-contract ADR (HANDOFF fields / plan state / backlog-parked-archive matching the gated action). No plan reference and no matchable named evidence keeps the row.
   - **Dismiss eligible:** if `answered` or `subject_resolved`, or the operator explicitly confirms hide-after-check.
   - **Skip when:** both `answered` and `subject_resolved` are false and no hide-after-check confirmation. Also skip when the id is already present in the store.

   **For `attention:report:<slug>`:**
   - **Locate (delegated):** the monitor/plan/HANDOFF scan is delegated to a **Task(explore)** subagent. Fill the worker prompt template (`.cursor/context/templates/command-worker-prompt.md`) with:
     - **Task description:** "Read the monitor file at `.cursor/memory/plan-monitor-<slug>.md`, the plan file referenced in the report's `**Plan:**` header, and `.cursor/HANDOFF.md` for lifecycle (bounded to 90-day window, 20 files, 512 KB per file). Return whether the report is already triaged (has a `## Triage note`, `## Follow-up plan`, or `## Residuals plan` heading, or a follow-up plan names the report slug or the reviewed plan)."
     - **worker_contract:** "triaged: true|false — whether the report has a triage heading, follow-up plan, or terminal lifecycle; lifecycle: completed|exhausted|parked|active|none"
     - **read_scope:** `[".cursor/memory/plan-monitor-<slug>.md", "<plan-file>", ".cursor/HANDOFF.md"]`
   - Dispatch the Task. Read the worker summary.
   - **Fallback:** if Task dispatch is unavailable, read the monitor/plan/HANDOFF inline.
   - **Check:** use the worker summary to determine eligibility. If triaged (has a triage heading) and not already in the store, the report is eligible for dismiss. If the slug is already in the store, skip. Demotion to Review debt (terminal lifecycle without triage heading) is NOT a dismiss signal.
   - **Update allowed:** none directly in resolve. Prefer `/plan-review-triage` when real triage is needed. Do not invent triage headings from the resolve command.
   - **Dismiss eligible:** only if the report is already triaged (has a triage heading) or the operator confirms hide-after-check. Demotion to Review debt is NOT a dismiss signal; the row remains visible.
   - **Skip when:** the report is untriaged (no heading, no follow-up plan, no terminal lifecycle) and the operator has not explicitly confirmed. Also skip when the id is already present in the store.

   **For `attention:cadence:<windowId>`:**
   - **Locate:** read `.cursor/context/field-report-cadence.json` (pendingPlanFiles / activeWarningId) and recompute the live unreviewed set (untriaged monitors + terminal plans without monitors) via the same named-local rules as the cadence ADR.
   - **worker_contract / inline:** `subject_resolved: true|false; evidence: none | list of path/plan basenames only`
   - **Check:** `subject_resolved` when every plan in `pendingPlanFiles` (or the live unreviewed set for this window) no longer needs review: each either has a triaged monitor or is no longer terminal-without-monitor. Prefer false negatives.
   - **Dismiss eligible:** `subject_resolved` or operator hide-after-check.
   - **On dismiss:** also run `.cursor/scripts/field-report-cadence-bump.sh clear` so the tick counter resets. Do not store monitor body or review prose in dismissals JSON.
   - **Skip when:** unreviewed work remains and no hide-after-check confirmation.
