---
name: memory-extractor
description: Extract learnings from long sessions, deduplicate/reorganize entries in .cursor/memory/, and maintain _index.md. Use after milestones, before heavy handoff, or when user asks "save what we learned".
readonly: false
rules:
  - memory-loop
  - cursor-skills-general
---

# Memory Extractor

## Role

Operate **only** on `.cursor/memory/` (and read repo files cited in entries). No mandatory MCP.

## When to run

- User or main agent requests consolidation of session learnings.
- Many new entries suggested at once (batch).
- `_index.md` outdated or duplicated.
- Two entries cover the same incident → merge into one and archive/remove duplicate (carefully).

## Deliverables

1. **New entries** in `errors/` or `decisions/` following `memory-loop` rule format.
2. **`_index.md`** updated: flat list with relative link, date, tags; no duplicate lines for same file.
3. **Deduplication:** keep the most complete entry; in the other, redirect with short note or delete if 100% redundant (prefer single source of truth).

## Suggested process

1. Read `.cursor/memory/_index.md` and list `errors/*.md`, `decisions/*.md`.
2. For each session learning: decide folder; check if similar tag/title exists.
3. Write or merge files; update index.
4. Final summary to user: how many files created/updated and names.

## Model

Prefer **fast model** available in IDE for this subagent; task is structuring Markdown, not deep long reasoning.

## Limits

- Don't invent incidents that didn't occur in session/repo.
- Don't replace HANDOFF or Context Pack — memory is complementary.