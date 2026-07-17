---
name: n8n-workflows
description: Workflows n8n — only when the project uses n8n (stack, not Core Pack). Edit workflow JSON or when the user mentions n8n.
version: 0.1.0
category: integrations
---

# n8n Workflows (stack opcional)

**Não faz parte do Core Pack.** Usar somente quando o repositório contém ou exige workflows n8n.

## Estrutura de workflow JSON

- **nodes:** array de nós (Webhook, HTTP Request, Code, Postgres, Switch, IF, Execute Workflow, Respond Webhook, etc.).
- **connections:** mapeamento de saídas de um nó para entradas de outro.
- **settings:** metadados do workflow (name, pinData, etc.).
- **credentials:** referências por id; nunca commitar secrets no JSON.

## Padrões recomendados

- **Webhook → Switch/IF → Execute Workflow → Respond Webhook:** fluxo típico para rotear por state entre sub-workflows.
- **State machine:** sessões com `state` (ex.: START, WAIT_INPUT, WAIT_CONFIRM, DONE); documentar em `docs/context/` ou README.
- **Documentação:** manter ou criar `docs/context/`, `docs/n8n-manual-update-*.md` para alterações manuais sem reimportar.

## Boas práticas

- Credenciais via **Credentials** do n8n ou variáveis de ambiente (`$env.VAR`); nunca valores fixos no JSON.
- Após importar workflows, ajustar IDs dos sub-workflows nos nós **Execute Workflow** (IDs são gerados pelo n8n).
- Usar `$json`, `$env`, `queryReplacement` (Postgres) conforme docs; em Postgres com `$1`, `$2`, preencher **Query Parameters** (ex.: `{{ [$json.field] }}`).
- Versionar os JSONs no Git; manter idempotência e documentar credenciais necessárias em README ou env.example.
