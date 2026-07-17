---
name: [Nome do plano]
overview: "[1–2 frases — resultado esperado]"
todos:
  - id: f0-exemplo
    content: "Fase 0 — …"
    status: pending
    # Budget de contexto (opcional — recomendado em loop/orquestrado):
    # read_scope: ["path/glob/*.ts", "docs/FOO.md"]
    # worker_contract: "summary + staging-ready"
    # max_ticks: 3
  - id: f1-exemplo
    content: "Fase 1 — …"
    status: pending
isProject: true
---

# [Nome do plano]

**Objetivo:** …

## Fases

### Fase 0
- …

### Fase 1
- …

## Budget de contexto (por to-do)

Campos opcionais no frontmatter de cada item de `todos` (ver `autogit/plan-routine.md`):

| Campo | Tipo | Uso |
|-------|------|-----|
| `read_scope` | lista de globs/paths | O que o worker pode ler além do HANDOFF/plano |
| `worker_contract` | string | Formato do retorno (ex.: `summary + staging-ready`) |
| `max_ticks` | número | Ticks neste to-do antes de HANDOFF forçado |

Exemplo:

```yaml
- id: fase7-exemplo
  content: "..."
  status: pending
  read_scope: ["db/002_*.sql", "docs/FILAS.md"]
  worker_contract: "summary + staging-ready"
  max_ticks: 3
```

Omitir os três = comportamento legado (sem budget explícito). Em modo orquestrado, o orquestrador passa os campos ao worker.
