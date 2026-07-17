# Domain packs (L1)

Initial L1 discipline packs for Agent Kit. Complements [layers-spec.md](layers-spec.md) and [coherence-inventory.md](coherence-inventory.md). Machine manifests live under `registry/packs/<id>/pack.json` (schema: [schemas/agent-kit.pack.schema.json](../schemas/agent-kit.pack.schema.json)).

**Status:** membership defined (`f1-domain-packs`). Install/catalog wiring is `f1-registry-packs` + `f2-cli-lifecycle`.

## Rules

1. A pack is **stack-agnostic discipline** knowledge (security, DevOps patterns, clean code, …).
2. Language/runtime/SaaS skills (n8n, SQL, Node, PHP, …) stay **L2** — not pack members.
3. Structural HITL loop (handoff, staging→prod, memory-loop, hygiene, docs-standard) stays **L0** even if a related agent sits in a pack.
4. `members[].source` points at today’s SoT path until packs ship bundled trees (`f1-registry-packs`).
5. `excludes` documents what must **not** move into the pack (still L0 or L2).

## Pack index

| Id | Title | Members (summary) | Stays out (L0 / L2) |
|----|-------|-------------------|---------------------|
| `cybersec` | Cybersecurity | skill `security-review`, agent `security-reviewer` | `check-secrets` hook (L0) |
| `devops` | DevOps | rule `cursor-skills-devops` | git spine rules/commands/agents (L0) |
| `engenharia-arquitetura` | Engineering & architecture | agent `tech-lead`, skill `docs-repo` | `docs-professional-standard` (L0) |
| `clean-code` | Clean code | skill `clean-code`, agent `cleancode-refactor` | registry SoT; former workspace id `code-deslop` merged |
| `gestao-projeto` | Project management | ClickUp rule/skill/agent, skill `jira` | plan/handoff commands + `plan-routine` (L0) |
| `gestao-contexto` | Context management | agents `context-librarian`, `memory-extractor`; command `context-status` | `context-guardian`, `memory-loop` (L0) |
| `quality` | Quality | rule `cursor-skills-testing`, agent `testes-roteiros` | language test runners (L2) |

## L2 — not packs

These remain on-demand registry/workspace skills or glob rules (see coherence inventory):

`n8n-workflows`, `sql-postgres`, `json-data-config`, `prompts-markdown`, `ux-message-flows`, and rules `cursor-skills-{n8n,node,php,python,sql,json,prompts,api,integrations,webdesign,mobile,groovy}`.

## Registry tier vs layer

Some skills sit under `registry/skills/core/` for historical catalog reasons. **Catalog “core” ≠ layer L0.** Example: `security-review` is catalogued under skills/core but **ships with the `cybersec` L1 pack**. L0 keeps only the structural secrets gate (`check-secrets`).

## Manifest usage

Projects list opted-in packs in `.cursor/agent-kit.json`:

```json
"packs": ["clean-code", "cybersec", "gestao-contexto"]
```

Empty `packs` = L0 only (+ any L2 `skills`).

## Acceptance (`f1-domain-packs`)

- [x] Seven pack ids with `pack.json` membership
- [x] Human index in this doc; layers-spec L1 points here
- [x] L2 language/SaaS explicitly excluded from packs
- [x] Registry catalog lists packs (`f1-registry-packs` — `registry.json` schemaVersion 2)
- [x] Full remote lifecycle `update`/`diff` (`f2-cli-lifecycle`)
