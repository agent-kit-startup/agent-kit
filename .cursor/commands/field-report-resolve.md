---
name: field-report-resolve
description: Dismiss Field Report attention ids by appending them to the local dismissals store.
---

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

3. **Check/update each claim** before deciding to dismiss. For each valid id that is not already in the store, locate the claim, verify its current state, and decide whether dismiss is eligible. Dismiss eligible in all three shapes means: a strong auto-clear signal already applies (answered prompt, subject-resolved named evidence, triage heading / follow-up plan, terminal reviewed-plan demotion, cadence unreviewed set cleared), or the operator explicitly confirms hide-after-check; otherwise skip.
   Full per-shape locate/check detail (delegated Task(explore) template fields, worker contracts, exact eligibility rules for `attention:prompt:`, `attention:report:`, and `attention:cadence:`): [procedure.md](../skills/core/field-report-resolve/procedure.md).

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
