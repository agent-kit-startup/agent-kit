# Command: /field-report-resolve

## Goal

Dismiss one or more Field Report **attention ids** by appending them to the local dismissals store. Paste ids into chat (or run this command with explicit ids); the agent turn writes the file. No transcript body, no open-chat mutation, no in-panel write.

Mission Control **Flight Log** shows HANDOFF Gaps only. It does **not** host Resolve all / Review all / per-row resolve CTAs. Cadence, prompts, and External-review attention remain data-layer / chat-command concerns (`buildAttentionItems`, dismissals, cadence ledger). Dismissable ids are `attention:report:<slug>`, `attention:prompt:<chatId>`, and `attention:cadence:<windowId>`. Plan-state and HANDOFF ids are not valid targets.

## When to Use

- An External-review, agent-prompt, or cadence attention id remains after you handled it outside the strong auto-clear signals (triage heading / follow-up plan / terminal reviewed-plan demotion / later user reply / unreviewed set cleared)
- You pasted `/field-report-resolve` with one or more attention ids (from chat, memory, or a prior copy)
- You want a durable local hide without deleting the monitor file or answering the chat

Prefer `/plan-review-triage` when you intend to actually triage a review; use this command only to hide a row you have already resolved.

## How to invoke (no Mission Control header button)

There is **no** Flight Log **Resolve all** header button and no per-row resolve CTAs on that card. Paste ids yourself:

```
/field-report-resolve <attention-id> [<attention-id>...]
```

Multi-id paste is equivalent to dismissing several claims in one turn. The allowlist and copy-target builder live in `fieldReportResolveAction(ids)` in `dashboard/lib/semantic-model.mjs` (data layer; not a Flight Log UI control).

**Review all** is also retired from Mission Control. Use `/plan-review-triage` with explicit monitor path(s) (or the autonomous audit arm → wait → triage Ask path).

## Usage

```
/field-report-resolve <attention-id> [<attention-id>...]
```

Allowed ids (exact shapes; space-separated when dismissing several):

- `attention:report:<slug>`
- `attention:prompt:<chatId>`
- `attention:cadence:<windowId>`

Examples:

- `/field-report-resolve attention:report:dashboard-field-report-and-skins`
- `/field-report-resolve attention:prompt:02201329-ab93-47d9-bcf4-0e76b8e5977d`
- `/field-report-resolve attention:cadence:w-20260727153000`
- `/field-report-resolve attention:report:widget-rollout attention:prompt:abc-123`

## What to Do

1. **Validate** each `<attention-id>` against the shapes above. Skip invalid tokens with a one-line note; if none are valid, stop. Do not invent ids.

2. **Load** `.cursor/context/field-report-dismissals.json` if it exists; otherwise start from `{ "dismissals": [] }`. Missing or unreadable file is not an error.

3. **Check/update each claim** before deciding to dismiss. For each valid id that is not already in the store, locate the claim, verify its current state, and decide whether dismiss is eligible. The full claim-check contract is in the plan file; this is the actionable summary.

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

4. **Append** eligible ids. For each id that passed the check (eligible for dismiss), add it to the store:

   ```json
   {
     "dismissals": [
       { "id": "attention:report:<slug>", "at": "YYYY-MM-DDTHH:mm:ss.sssZ" },
       { "id": "attention:prompt:<chatId>", "at": "YYYY-MM-DDTHH:mm:ss.sssZ" },
       { "id": "attention:cadence:<windowId>", "at": "YYYY-MM-DDTHH:mm:ss.sssZ" }
     ]
   }
   ```

   Optional short `reason` (≤120 chars) is allowed per entry. **Never** store transcript text, AskQuestion prompts, monitor body, or chat content.

5. **Write** the file under `.cursor/context/` (gitignored local state, same class as `readiness.json`).

6. **Confirm:**
   > "Dismissed N attention id(s). Those claims drop from the attention data layer on the next snapshot (Flight Log Gaps UI is unchanged)."
   Report per-id outcomes:
   - Dismissed: `<id>`
   - Already present (skipped): `<id>`
   - Skipped (not eligible): `<id>` — reason

## Hard stops

1. **IDs only** in the store. No conversation content.
2. **Copy-only / chat path:** invoke via pasted `/field-report-resolve <attention-id> [...]`. No in-panel mutation, no server-side dismiss API, no Flight Log Resolve all / Review all UI.
3. **Never `/git-prod`** from this command. Do not commit the dismissals file (it is gitignored).
4. Prefer strong auto-clear / resolve signals (answered prompt, subject-resolved named evidence, triage heading / follow-up plan, terminal reviewed-plan demotion, cadence unreviewed set cleared) when those signals already apply; this command is the explicit local override when auto-clear is narrower than resolve.

## Related

- Flight Log panel: `.cursor/memory/decisions/2026-07-27_mc-flight-log-panel.md`
- Field Report source contract: `.cursor/memory/decisions/2026-07-25_mission-control-field-report-source-contract.md`
- Dismissals + triage persistence: `.cursor/memory/decisions/2026-07-25_mission-control-field-report-dismissals.md`
- Activity review cadence: `.cursor/memory/decisions/2026-07-27_field-report-activity-review-cadence.md`
- External review triage (writes `## Triage note`): `/plan-review-triage`
- Copy-only paste destinations: `.cursor/memory/decisions/2026-07-25_mission-control-copy-only-paste-destinations.md`
