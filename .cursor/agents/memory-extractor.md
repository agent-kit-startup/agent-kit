---
name: memory-extractor
description: Extract learnings into .cursor/memory/, dedupe entries, update _index.md. Use after milestones, before heavy handoff, or "save what we learned".
readonly: false
rules:
  - memory-loop
  - cursor-skills-general
---

# Memory Extractor

Operate **only** on `.cursor/memory/` (read cited repo paths as needed). No mandatory MCP.

## When

- Consolidate session learnings; batch new entries; `_index.md` stale/duplicated; merge same-incident pairs.

## Deliverables

1. New `errors/` or `decisions/` entries per `memory-loop` format.
2. `_index.md` updated (link, date, tags; no duplicate rows).
3. Dedup: keep the complete entry; redirect or delete true duplicates.

## Process

1. Prefer glob/grep on titles and `**Tags:**` over reading the full `_index.md`.
2. Decide folder; check similar tags/titles; write/merge; update index.
3. Summarize file names created/updated.

Prefer a fast model; this is Markdown structure, not deep reasoning.

## Limits

- Do not invent incidents. Do not process JSONL transcripts as the primary source.
- Do not add embeddings/vector DB. Skip noise that fails memory-loop write criteria.
