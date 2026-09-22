---
name: [Plan name]
overview: "[1-2 sentences — expected result]"
# agent: docs-repo   (optional — kit agent id from .cursor/agents/; used by the dashboard for attribution)
todos:
  - id: phase0-example
    content: "Phase 0 — …"
    status: pending
    # Context budget (optional — recommended in loop/orchestrated):
    # read_scope: ["path/glob/*.ts", "docs/FOO.md"]
    # worker_contract: "summary + tests + staging-ready (lint)"
    # max_ticks: 3
    # worker_type: docs-repo   # ADR/docs-only ticks: docs-repo or omit (not security-reviewer / tech-lead)
    # inline_first: true       # opt-in only; ignored unless every lightweight check passes (see below)
    # force_task: true         # always Task; use when isolation is intentional
  - id: phase1-example
    content: "Phase 1 — …"
    status: pending
isProject: true
---

# [Plan name]

**Goal:** … (what and why first; how belongs in Phases / Constraints)

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
| `worker_contract` | string | Return format (e.g.: `summary + tests + staging-ready (lint)`). Prefer naming lint evidence when the to-do touches formatted/linted files |
| `max_ticks` | number | Ticks on this to-do before forced HANDOFF |
| `worker_type` | string | Preferred Task `subagent_type` (orchestrated strategy); omit = routing table in `/run-plan` |
| `inline_first` | boolean | Opt-in signal for orchestrated `/run-plan` in-session implement. **Not force-inline.** Ignored unless every lightweight check passes (see `/run-plan` and authoring note below) |
| `force_task` | boolean | Always Task dispatch; overrides inline-first even when lightweight |

### Authoring `inline_first` (do not mislead)

`inline_first: true` does **not** bypass qualification. When any lightweight check fails, `/run-plan` **ignores** the flag and dispatches **Task** (quota risk under Auto). Full checks: `/run-plan` "Inline-first lightweight to-dos". ADR: `decisions/2026-07-27_run-plan-inline-first-qualification-gap.md`.

For a tick whose **only** deliverable is ADR / memory / CHANGELOG / L0 markdown:

- Prefer `worker_type: docs-repo` or omit `worker_type`
- Keep every `read_scope` entry on the docs-only allowlist in `/run-plan` (e.g. `CHANGELOG.md`, `docs/**`, `.cursor/memory/**`, `.cursor/commands/**`, `.cursor/rules/**`, `.cursor/context/templates/**`)
- Set `inline_first: true` **only** when those checks will pass
- Do **not** pair `inline_first: true` with `security-reviewer`, `tech-lead`, `explore`, or product paths unless the intent is Task (`force_task: true`)

### Mission Control dashboard SoT path

When a to-do touches Mission Control HTML/CSS/JS in the dashboard shell, put **`dashboard/dashboard.html`** (repo-root) in `read_scope` and edit that file. Do **not** list `packages/cli/dashboard/dashboard.html`: that path is a gitignored prepack mirror (`scripts/sync-cli-dashboard.mjs`), not the source of truth. Pins in `plugin-ux-validation.test.ts` already resolve the repo-root SoT.

### Durable mid-batch monitor pointers

When a plan watches another monitor mid-batch (e.g. a residual closeout references a sibling monitor), record the pointer in a **tracked** surface, not in `.cursor/HANDOFF.md`. The canonical durable pointer is the Audits row in `.cursor/memory/_index.md` for the watched monitor. Keep HANDOFF as session state only.

**Pattern:**

- Add the watched monitor file by name in the same commit as its `_index.md` Audits row (R14 pairing).
- In the plan body or monitor notes, cite the `_index.md` row rather than a HANDOFF line.
- Do not write acceptance criteria that depend on a gitignored HANDOFF line as evidence.

### Product-context reasoning stage

When `/start-project`, `/backlog-add`, or `/run-plan` (first tick) encounters operator-provided source material that mixes personal operations with product intent, run a **single-scan product-context reasoning stage** before proposing or writing the plan:

1. **Ingest** the source (attachment, cited document, or inline payload). Chat citation alone is not intake; a paraphrase in the plan body alone is not a durable extract.
2. **Split personal vs product.** Identify product facts (positioning, stack, licensing) and separate them from personal operations (consulting rates, family, PII, org politics, people's names, client-specific IDs).
3. **Persist a hygiene-stripped extract** to a tracked path under `docs/product-context/` (not gitignored `.cursor/plans/assets/` or session-local `.cursor/context/current/`). The extract is written in inheritable project voice per `docs-professional-standard`: no people, no PII, no chat metalanguage, no session-specific references.
4. **Point the plan** at the extract path (a relative link in the plan body, not a HANDOFF line).
5. **Later ticks read the extract**, not the session origin or a chat paraphrase. The extract is the durable SoT for product context used during planning and execution.

**Single-scan only.** Do not graft a multi-question interview loop onto intake (ADR `decisions/2026-08-24_boostprompt-discovery-reject-adapt-concepts-thin-adapter.md`). The existing Broad Intake Review + Ask questions gates remain the bounded HITL surface.

**Do not commit raw operator attachments.** Hygiene-strip first; the extract replaces the raw file for git purposes. If the source is no longer on disk, use product facts already captured in the plan's Broad Intake table (seed the extract from those, not from memory).

**When no mixed source exists:** skip the stage. Pure-code or pure-docs plans without operator product context do not require an extract. Major Tom (ADR `2026-09-04_major-tom-autonomous-mode.md`) is not this stage and is not `/start-project` intake.

Closes the parked use case in `decisions/2026-08-13_plan-intake-persist-originals.md`.

### Ledger regeneration boundary

Do not confuse "a companion plan owns the stale-ledger residual" with "ledger regeneration is forbidden here." The knowledge-classification evidence gate resolves Audits targets against git-tracked files, so any change that introduces or reclassifies a tracked `.cursor/memory/**` file must regenerate `docs/evidence/knowledge-classification.json` in the same commit. Regeneration is required for the technical necessity of tracking new files; it is only forbidden as a duplicate residual-cleanup to-do when another plan has already committed to that specific stale-ledger residual. ADR: `decisions/2026-08-08_ledger-regen-policy.md`.

### Split docs-only vs product ticks

When a phase would mix markdown close-out with product evidence, **author two to-dos** so Auto can inline-first the docs tick and Task-isolate the product tick. Do not put `packages/**`, `dashboard/**`, or other product paths on a docs close-out `read_scope` "for context." ADR: `decisions/2026-07-27_auto-run-no-regression-invariants.md`.

Bad (burns Task despite the flag):

```yaml
worker_type: security-reviewer
read_scope: ["dashboard/**", ".cursor/memory/decisions/"]
inline_first: true   # ignored → Task
```

Bad (product path on docs close-out):

```yaml
worker_type: docs-repo
read_scope: ["CHANGELOG.md", "dashboard/**"]
inline_first: true   # ignored → Task
```

Good (qualifies for inline-first):

```yaml
worker_type: docs-repo
read_scope: [".cursor/memory/decisions/", ".cursor/commands/run-plan.md"]
inline_first: true
```

Good split (product then docs):

```yaml
- id: phase2-impl
  worker_type: generalPurpose
  read_scope: ["dashboard/**"]
  force_task: true
- id: phase3-closeout
  worker_type: docs-repo
  read_scope: ["CHANGELOG.md", ".cursor/memory/_index.md"]
  inline_first: true
```

## Plan attribution (`agent:`)

Optional **plan-level** frontmatter field (not per to-do). Holds a kit agent identity: the basename of a file under `.cursor/agents/` (e.g. `docs-repo`, `security-reviewer`, `cleancode-refactor`). The dashboard resolves Monitor delivery and plan-progress events to this identity for "who did what" grouping.

- Absent or invalid value: consumers emit `agent: null` and the UI groups the rows under `system`. Absent is a valid state; do not force an id that does not fit the plan's domain.
- `agent:` is not `worker_type`: `worker_type` is a per-to-do Task routing hint for the orchestrated strategy; `agent:` is the plan's owning identity. Cursor built-in subagent types (`generalPurpose`, `explore`, `shell`) are not valid `agent:` values unless a matching `.cursor/agents/<id>.md` exists.

**`staging-ready` means lint evidence:** `Staging ready: yes` requires that applicable formatter/linter checks passed on touched files (or the summary states none applicable). See `/run-plan` and `autogit/plan-routine.md` section 6. Cross-links: `.cursor/memory/errors/2026-07-21_ci-biome-blocked-440-publish.md`, `2026-07-23_biome-format-blocked-446-tag-ci.md`, process note in `plan-monitor-dashboard-field-report-and-skins.md`.

## Plan attribution (`agent:`)

Optional **plan-level** frontmatter field (not per to-do). Holds a kit agent identity: the basename of a file under `.cursor/agents/` (e.g. `docs-repo`, `security-reviewer`, `cleancode-refactor`). The dashboard resolves Monitor delivery and plan-progress events to this identity for "who did what" grouping.

- Absent or invalid value: consumers emit `agent: null` and the UI groups the rows under `system`. Absent is a valid state; do not force an id that does not fit the plan's domain.
- `agent:` is not `worker_type`: `worker_type` is a per-to-do Task routing hint for the orchestrated strategy; `agent:` is the plan's owning identity. Cursor built-in subagent types (`generalPurpose`, `explore`, `shell`) are not valid `agent:` values unless a matching `.cursor/agents/<id>.md` exists.

**`staging-ready` means lint evidence:** `Staging ready: yes` requires that applicable formatter/linter checks passed on touched files (or the summary states none applicable). See `/run-plan` and `autogit/plan-routine.md` section 6. Cross-links: `.cursor/memory/errors/2026-07-21_ci-biome-blocked-440-publish.md`, `2026-07-23_biome-format-blocked-446-tag-ci.md`, process note in `plan-monitor-dashboard-field-report-and-skins.md`.

Example:

```yaml
- id: phase7-example
  content: "..."
  status: pending
  read_scope: ["db/002_*.sql", "docs/QUEUES.md"]
  worker_contract: "summary + tests + staging-ready (lint)"
  max_ticks: 3
  worker_type: sql-schema
```

Omit budget fields = legacy behavior (no explicit budget / no forced worker). In orchestrated mode, the orchestrator passes the fields to the worker and resolves `subagent_type` via `worker_type` or the routing table.
