# Command: /cursor-update-awareness

## Goal

Run an **opt-in advisory** check for Cursor product updates (changelog + `docs/cursor-native-audit.md` inventory), then route **confirmed** gaps into the existing conveyor with HITL. Never apply kit/IDE changes. Never auto-create Field Reports or public issues.

**Detection source ADR:** `.cursor/memory/decisions/2026-08-01_cursor-update-detection-source.md` (changelog fetch primary; sessionStart = delivery; readiness = optional storage only).

## When to Use

- After a Cursor IDE upgrade or when `cursorUpdateCheck.enabled` sessionStart nudge mentions gaps
- When reviewing whether Agent Kit should adopt a new Cursor surface (hooks, MCP, skills, commands, SDK)
- Before `/backlog-add` or `/dogfood` for Cursor-integration work

## Hard stops

1. **Check ≠ apply.** CLI and this command only report. No silent rewrite of `.cursor/`, no Marketplace submit, no native-audit version-prose refresh (owned by parked `submit-cursor-marketplace`).
2. **No auto Field Reports** and no auto GitHub issues.
3. **Lane separation:** `/dogfood` stays factory vs consumer aware (ADR `2026-07-31_dogfood-factory-consumer-lanes.md`). Do not write consumer notes into factory `dogfood/` without an explicit operator bridge.
4. **HITL before enqueue.** Confirmed gaps go through Ask → `/backlog-add` or Ask → `/dogfood`, never silent backlog rows.
5. **Never `/git-prod`.**

## Check-only (CLI)

```bash
agent-kit cursor-awareness --check [--json] [--respect-prefs] [--stamp] [--offline]
```

- Fetches `https://cursor.com/changelog` (override via `cursorUpdateCheck.changelogUrl`) unless `--offline`.
- Diffs against `docs/cursor-native-audit.md` (open Action items, refresh staleness) and validates `docs/cursor-3-features.md` presence.
- Prefs in `.cursor/context/config.json` under `cursorUpdateCheck` (`enabled` default `false`, `intervalDays`, `lastSeenCursorVersion`). Distinct from kit `updateCheck`.
- `applyRecommended` and `fieldReportRecommended` are always `false`.

## What to Do

1. **Run the check** (prefer CLI JSON):
   ```bash
   agent-kit cursor-awareness --check --json
   ```
   Fallback: inventory-only `agent-kit cursor-awareness --check --offline --json`.

2. **Summarize gaps** for the operator (id, severity, evidence, suggestedRoute). If status is `current` or `skipped-*`, report and stop.

3. **Confirm routing via Ask questions** (chat numbered-list fallback). One question:

   > Cursor awareness found N advisory gap(s). Route confirmed work?

   Options (labels exact):
   - `Enqueue via /backlog-add`
   - `File /dogfood note`
   - `Not now`

4. **Handlers:**
   - `Enqueue via /backlog-add`: hand off to `/backlog-add` with a goal summarizing the confirmed gaps (Broad Intake + write Ask still apply). Do not activate or run the new plan.
   - `File /dogfood note`: hand off to `/dogfood` with a hygiene-stripped topic/summary. Respect factory vs consumer lane.
   - `Not now` / skipped: stop. Optionally offer enabling `cursorUpdateCheck.enabled` for future sessionStart nudges (do not mutate config without Ask).

5. **Out of scope:** refreshing Marketplace plugin version prose; kit self-release (`/update` / `updateCheck`); auto-remediation of product code.

## Related

- Kit consumer autoupdate (separate): `/update`, ADR `2026-07-27_consumer-autoupdate-check-opt-in.md`
- Dogfood ingest: `/dogfood`, ADR `2026-07-31_dogfood-ingest-contract.md`
- Triage residuals path: `/plan-review-triage` → Write residuals → `/backlog-add`
