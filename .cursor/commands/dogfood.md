# Command: /dogfood

## Goal

File a private dogfood note from the current chat or explicit arguments into the local inbox. Factory (`agent-kit-dev`) writes to `dogfood/`; consumer projects write to `.cursor/dogfood/`. Never syncs upstream; never creates a public issue automatically.

## When to Use

- You hit Agent Kit friction, a bug, or a surprising behavior and want it tracked for internal analysis.
- You want a dated record of a session pattern without turning it into a public issue or PR.
- A memory WRITE is not yet warranted; the note is raw material for later triage.

## Usage

```
/dogfood <topic> [one-line summary]
```

Examples:
- `/dogfood plan-handoff context lost after long run`
- `/dogfood update-refresh personalization dropped`
- `/dogfood stale-pack-id install failed on pack migration`

Without arguments, summarize the current chat turn into the topic and body.

## Hard stops

1. **Detect lane before writing.**
   - **Factory lane** — this checkout is the canonical `agent-kit-dev` repository (`origin` remote contains `agent-kit-dev`, or `dogfood/` already exists at repo root). Write to `dogfood/cursor_<topic>_<date>.md` and update `dogfood/README.md` Unprocessed index.
   - **Consumer lane** — any other project with an Agent Kit install (`.cursor/agent-kit.json` exists). Write to `.cursor/dogfood/cursor_<topic>_<date>.md` and a local index. Do **not** track the folder in git; it should already be gitignored by the base install.
   - **Unknown lane** — stop and ask the operator which lane to use.
2. **Hygiene strip (mandatory).** Remove before writing:
   - Consumer workspace names, project names, domain names, or external product names.
   - People's names, Slack channels, client IDs, or organization names.
   - Chat-transient phrasing ("as I mentioned", "dear user", "conforme falamos").
   - Any value that looks like a secret, token, or credential.
3. **Session origin ≠ product use case.** The note describes an Agent Kit system pattern, not a specific consumer's business process. See `2026-07-17_session-origin-not-product-usecase.md`.
4. **No public issue or PR without explicit HITL.** If the operator wants a public issue, use `/dogfood` → local save first, then offer a separate `/contribute` or `gh issue create` step after the hygiene strip is verified.
5. **No Field Report cards.** Routine dogfood filing does not create or update Field Report cadence.

## What to Do

### Step 1: Determine lane

Check in order:
1. `git remote get-url origin` (or `git config remote.origin.url`) contains `agent-kit-dev` → factory lane.
2. A `dogfood/` directory exists at the repo root and contains this README → factory lane.
3. `.cursor/agent-kit.json` exists and the repo is not `agent-kit-dev` → consumer lane.
4. Neither → stop and ask: "This doesn't look like the factory or a migrated consumer. Save to `dogfood/` (factory) or `.cursor/dogfood/` (consumer)?"

### Step 2: Build filename and body

1. Normalize the topic: lowercase, spaces/hyphens/underscores to underscores, strip punctuation and trailing date. Keep it short (≤ 40 chars).
2. Date suffix: `YYYYMMDD` from today (`YYYY_MM_DD` for readability).
3. Filename: `cursor_<topic>_<date>.md`.
4. Body template:
   ```markdown
   # Dogfood: <topic>

   - **Date:** <YYYY-MM-DD>
   - **Lane:** factory | consumer
   - **Source:** chat summary | explicit /dogfood args

   ## Observation

   <hygiene-stripped description of the friction>

   ## Impact

   <how this affects the Agent Kit system or operator experience>

   ## Triage (initial)

   - Fix now / Park / Ignore
   - **Tags:** <lowercase comma-separated keywords>
   ```
5. Run the hygiene strip. If you cannot strip enough context to make it generic, file the note but flag it as `needs-anonymization` in the body and stop before any memory WRITE or public issue.

### Step 3: Write and index

**Factory lane:**
- Write `dogfood/cursor_<topic>_<date>.md`.
- Append the file to the `### Unprocessed Files` section of `dogfood/README.md` with a one-line summary and the capture date.

**Consumer lane:**
- Ensure `.cursor/dogfood/` exists (create if missing).
- Write `.cursor/dogfood/cursor_<topic>_<date>.md`.
- Write or append to `.cursor/dogfood/README.md` with the same Unprocessed/Processed structure as the factory README.
- The folder is local-only; do not `git add` it.

### Step 4: Cross-repo bridge (optional, operator-initiated only)

A consumer project does **not** write directly into the factory repo. If the operator wants a note from `.cursor/dogfood/` to reach the canonical `agent-kit-dev` inbox, the supported path is a manual bridge:

1. **Configure factory root** (optional). In `.cursor/context/config.json` add:
   ```json
   {
     "dogfood": {
       "factoryRoot": "/absolute/path/to/agent-kit-dev"
     }
   }
   ```
   The path is advisory only; the command never writes there automatically.
2. **Operator copies the file** with `cp` or the IDE file explorer from `.cursor/dogfood/cursor_<topic>_<date>.md` to `dogfood/cursor_<topic>_<date>.md` in the factory checkout.
3. **Re-apply hygiene** in the factory context before committing. The file must be re-reviewed because the factory README index and triage cycle are separate from the consumer inbox.
4. **No bridge for routine friction.** Most consumer notes should stay in `.cursor/dogfood/` as local project memory. Only copy patterns that are clearly Agent Kit system gaps.

If `dogfood.factoryRoot` is absent, omit the bridge step and file locally. Never invent a factory path or guess from repo history.

### Step 5: Optional public issue (HITL only)

After filing locally, you may offer a public GitHub issue **only if**:
1. The pattern is an upstream Agent Kit gap, not a project-specific workaround.
2. The hygiene strip has already been applied (no consumer identities, no session-origin detail).
3. The operator explicitly agrees via Ask questions with options:
   - `Create public issue`
   - `Keep local only`

If the operator chooses `Create public issue`:
- Use `gh issue create` against the public `agent-kit-startup/agent-kit` repository.
- Title format: `[Dogfood] <topic>`.
- Body: a concise, anonymized summary plus the local dogfood file path for reference.
- Do **not** paste the full local dogfood file if it contains any non-public detail.
- Never create a Field Report card or cadence warning for this step.

If the operator chooses `Keep local only`, stop. The local file is the record.

### Step 6: Respond

> Dogfood filed: `dogfood/cursor_<topic>_<date>.md` (factory) or `.cursor/dogfood/cursor_<topic>_<date>.md` (consumer). Next: analyze → memory WRITE → triage, or ask for a public issue if the pattern is upstream-relevant.

## Related

- `dogfood/README.md` — factory inbox and ingest ritual
- `.cursor/memory/decisions/2026-07-31_dogfood-factory-consumer-lanes.md` — lane decision
- `.cursor/memory/decisions/2026-07-31_dogfood-ingest-contract.md` — ingest contract
- `.cursor/memory/decisions/2026-07-17_session-origin-not-product-usecase.md` — hygiene
- Cursor product-update gaps may route here via `/cursor-update-awareness` (Ask → `/dogfood`)
