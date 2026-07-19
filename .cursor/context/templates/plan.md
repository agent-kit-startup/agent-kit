---
name: [Plan name]
overview: "[1-2 sentences — expected result]"
todos:
  - id: phase0-example
    content: "Phase 0 — …"
    status: pending
    # Context budget (optional — recommended in loop/orchestrated):
    # read_scope: ["path/glob/*.ts", "docs/FOO.md"]
    # worker_contract: "summary + staging-ready"
    # max_ticks: 3
    # worker_type: docs-repo
  - id: phase1-example
    content: "Phase 1 — …"
    status: pending
isProject: true
---

# [Plan name]

**Goal:** …

## Phases

### Phase 0
- …

### Phase 1
- …

## Context budget (per to-do)

Optional fields in the frontmatter of each `todos` item (see `autogit/plan-routine.md`):

| Field | Type | Use |
|-------|------|-----|
| `read_scope` | list of globs/paths | What the worker can read beyond HANDOFF/plan |
| `worker_contract` | string | Return format (e.g.: `summary + staging-ready`) |
| `max_ticks` | number | Ticks on this to-do before forced HANDOFF |
| `worker_type` | string | Preferred Task `subagent_type` (orchestrated); omit = routing table in `/run-plan-orchestrated` |

Example:

```yaml
- id: phase7-example
  content: "..."
  status: pending
  read_scope: ["db/002_*.sql", "docs/QUEUES.md"]
  worker_contract: "summary + staging-ready"
  max_ticks: 3
  worker_type: sql-schema
```

Omit budget fields = legacy behavior (no explicit budget / no forced worker). In orchestrated mode, the orchestrator passes the fields to the worker and resolves `subagent_type` via `worker_type` or the routing table.
