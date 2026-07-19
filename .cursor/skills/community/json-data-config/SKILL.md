---
name: json-data-config
description: Validate, format, and manipulate JSON (configs, payloads, n8n workflows, AI responses).
version: 0.1.0
category: dados
---

# JSON - Config e payloads

## JSON válido

- Aspas duplas em chaves e strings; vírgulas entre itens; sem vírgula final; escapamento correto (`\"`, `\n`).
- JSON não suporta comentários; usar chave `_comment` se precisar de nota no objeto.

## Padrões recomendados

- **Parse de resposta de IA:** remover blocos markdown (`` ```json ``), extrair primeiro `{ ... }`, tratar `\n`/`\"`; retornar objeto com tratamento de erro (try/catch, mensagem clara).
- **Configs:** estruturas de unidades, mapeamentos; manter nomes consistentes (ex.: mapeamento-*.json).
- **Workflows n8n:** JSON com `nodes`, `connections`, `settings`; manter legível (indentação) quando editar manualmente.

## Boas práticas

- Validar antes de salvar (sintaxe); quando existir, seguir schema (config ou API).
- Em código que parseia: sempre try/catch; mensagem de erro com trecho relevante (ex.: primeiros 100–200 chars do raw).
- Minificação apenas para deploy/asset; no repo preferir JSON legível para diff e revisão.
