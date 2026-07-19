# Categorias de skills - Agent Kit

Lista oficial de categorias para metadata dos skills. Usada no frontmatter (`category`) e como base para registry e listagem.

| Categoria    | Descrição |
|-------------|-----------|
| integrações | Automação, APIs, n8n, webhooks, ferramentas externas |
| dados       | SQL, JSON, schemas, migrations, persistência |
| docs        | README, documentação, prompts, guias, ADRs |
| devops      | CI/CD, deploy, infra, scripts de ambiente |
| quality     | Testes, acessibilidade, UX, revisão de código |
| creation    | Criação de skills, rules, agents; geradores; design técnico |

## Uso no frontmatter

Em cada `SKILL.md`:

```yaml
---
name: meu-skill
description: ...
category: dados
---
```

Valor de `category` deve ser um dos itens da tabela (ex.: `integrações`, `dados`, `docs`, `devops`, `quality`, `creation`).
