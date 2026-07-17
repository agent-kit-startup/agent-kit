---
name: clickup-tasks
description: Tasks ClickUp via MCP — só se o projeto usar ClickUp (fora do Core Pack). Use para criar/editar tasks quando a integração existir.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-clickup
  - cursor-skills-general
---

# ClickUp — Tarefas e convenções

- Seguir sempre as convenções da rule [cursor-skills-clickup.mdc](.cursor/rules/cursor-skills-clickup.mdc).
- Usar a skill [clickup/SKILL.md](.cursor/skills/community/clickup/SKILL.md) para processo detalhado, exemplos e checklist.

## Ao criar ou atualizar tasks

1. **Título** no padrão `[Projeto/Módulo] Verbo + Objeto` (ou imperativo para subtask).
2. **Descrição** em Markdown: Objetivo, Escopo, Critérios de aceite, Referências.
3. **Status** compatível com o pipeline (backlog → escopo refinado → desenvolvimento → homologação → complete).
4. **Prioridade** sempre definida (urgent, high, normal, low).
5. **Responsável** na task pai; subtarefas com responsável quando fizer sentido.
6. **Tags** para categorias transversais (n8n, prompt, api, etc.).

## Listas

- Resolver `list_id` por nome quando necessário: usar `clickup_get_list` com `list_name` (list do projeto atual).
- Para hierarquia do workspace: `clickup_get_workspace_hierarchy`.

## Integração com Git

- Após `git staging`: atualizar status da(s) task(s) relacionada(s) para **homologação**/staging.
- Após `git prod`: atualizar status para **complete** na(s) task(s) entregues.
- Detalhes em [autogit/gitupdate.md](autogit/gitupdate.md) passo 10.5.
