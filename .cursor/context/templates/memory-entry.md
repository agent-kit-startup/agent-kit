# Memory entry - WRITE-time formats

Read at memory-loop WRITE time (`.cursor/rules/memory-loop.mdc`). File names and write criteria stay in the rule.

## Format: errors (`errors/*.md`)

H1 title = short summary. Compact body:

- **Date:** YYYY-MM-DD
- **Error:** symptom / message / context
- **Cause:** root cause
- **Solution:** what to do
- **Files:** paths touched (optional)
- **Tags:** lowercase keywords, comma-separated

## Format: decisions (`decisions/*.md`)

- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Deprecated | Superseded by `<file>` (required for new writes; evidence policy progression)
- **Evidence:** optional paths to code, tests, runtime matrices, or ledgers when the decision is Accepted
- **Context:** 1-2 sentences
- **Decision:** what was chosen
- **Discarded alternative:** brief
- **Tags:**

**Active catalog:** `.cursor/memory/decisions/_index.md` lists only index-active rows (`Proposed` | `Accepted` | `Deprecated` | missing Status pending review). Fully `Superseded by …` rows are omitted. When a compaction verdict is archive, move the file to `decisions/archive/` and drop it from that table (do not delete history). Prefer glob/grep on entry files over reading the full parent `_index.md` Decisions section (ADR `2026-09-23_memory-index-changelog-growth-contracts.md`).

## Index

After each new entry, add a line to `.cursor/memory/_index.md` with: title (relative link), date, tags. Also add or refresh the matching row in `decisions/_index.md` when Status is index-active; remove the row when Status becomes fully superseded or the file moves to `archive/`.
