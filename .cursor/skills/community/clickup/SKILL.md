---
name: clickup
description: Create and update ClickUp tasks via MCP. Optional — only if the project uses ClickUp. Not part of Core Pack.
version: 0.1.0
category: pm
---

# ClickUp — Gestão de tarefas (stack opcional)

**Não faz parte do Core Pack.** Instalar/usar só quando o repositório integrar ClickUp. Alinhado à rule [cursor-skills-clickup.mdc](.cursor/rules/cursor-skills-clickup.mdc) (`alwaysApply: false`).

## When to Use

- O projeto já usa ClickUp e há MCP configurado.
- Criar ou atualizar tasks/subtarefas; breakdown de features.
- Atualizar status após `git staging` / `git prod` **se** a integração existir.
- Resolver list_id pelo nome da list do **projeto atual** (sem IDs hardcodados de outro workspace).

## Processo (criação de task)

1. **Definir lista:** usar `clickup_get_list` com `list_name` (ou `list_id` se conhecido).
2. **Título:** seguir padrão `[Projeto/Módulo] Verbo + Objeto`.
3. **Descrição:** preencher em Markdown — Objetivo, Escopo, Critérios de aceite, Referências.
4. **Status:** iniciar em `backlog` ou `escopo refinado` conforme maturidade.
5. **Prioridade:** sempre definir (`urgent`, `high`, `normal`, `low`).
6. **Responsável:** definir assignee(s); para subtarefas, herdar ou especificar.
7. **Tags:** adicionar tags transversais (n8n, prompt, api, etc.) se aplicável.
8. **Due date:** definir em tasks de milestone/entrega.
9. **Subtasks:** criar como passos acionáveis; máx. 1 nível; se precisar de sub-itens, promover subtask a task.

## Convenções (detalhamento)

### Títulos

- Task: `[Projeto/Módulo] Verbo + Objeto` — ex.: "Checkout - Integrar solicitação de reserva".
- Subtask: verbo no imperativo + objeto — ex.: "Validar fluxo de reserva no n8n", "Atualizar prompt com regras de validação".

### Descrição (template Markdown)

```markdown
## Objetivo
1-2 frases sobre o que se espera da task.

## Escopo
- Entregável 1
- Entregável 2

## Critérios de aceite
- [ ] Critério 1
- [ ] Critério 2

## Referências
- [README do módulo](caminho/no/repo)
- Task relacionada: [link ClickUp]
```

### Status (ordem do pipeline)

| Status             | Uso |
|--------------------|-----|
| backlog            | Ainda não priorizado/refinado |
| escopo refinado    | Escopo definido, pronto para dev |
| desenvolvimento    | Em implementação |
| homologação        | Em teste/staging; também após `git staging` |
| pendência          | Bloqueio externo (sempre comentar o motivo) |
| complete           | Concluído; também após `git prod` |

### Prioridade e responsável

- Prioridade: sempre informar ao criar task.
- Task pai: sempre com pelo menos um responsável.
- Subtasks: podem herdar (deixar vazio) ou ter responsável específico.

### Tags sugeridas

- Por tipo: `n8n`, `prompt`, `api`, `agente`, `hotfix`, `docs`, `testes`.
- Usar tags já existentes no space quando possível.

## Workspace Reference

Não hardcodar `list_id` de um workspace específico no kit. Sempre resolver com `clickup_get_list` (`list_name`) ou `clickup_get_workspace_hierarchy` no ambiente do usuário.

## Exemplos

### Task bem formatada

- **Nome:** "Checkout - Integrar solicitação de reserva no fluxo de email"
- **Descrição:** Objetivo (1-2 frases), Escopo em bullets, Critérios em checklist, Referências (links).
- **Status:** desenvolvimento
- **Prioridade:** high
- **Assignees:** definido
- **Tags:** n8n, prompt

### Task mal formatada (evitar)

- **Nome:** "Integrar coisa" (vago, sem projeto).
- **Descrição:** vazia ou só uma linha.
- **Status:** complete sem ter passado por desenvolvimento/homologação.
- **Prioridade:** omitida.
- **Assignees:** nenhum na task pai.

## Decision Tree

- **Preciso rastrear este item individualmente (datas, responsável, status)?**
  - **Sim** → É **subtask** (se pertencer a uma entrega maior) ou **task** (se for entrega completa).
  - **Não** → Use **checklist** dentro da task.

- **Este item tem vários passos que também precisam de tracking?**
  - **Sim** → Crie uma **task** para esse item (não subtask com sub-subtasks).
  - **Não** → Mantenha como **subtask** ou checklist.

- **É uma entrega completa ou um passo de uma entrega?**
  - Entrega completa → **Task** na list apropriada.
  - Passo de uma entrega → **Subtask** da task que representa a entrega.

## Checklist de qualidade (antes de criar/atualizar)

- [ ] Título segue padrão [Projeto/Módulo] Verbo + Objeto (ou imperativo para subtask).
- [ ] Descrição tem Objetivo, Escopo, Critérios de aceite e Referências (para tasks; subtasks podem ser mais curtas).
- [ ] Status compatível com o pipeline (não pular de backlog para complete).
- [ ] Prioridade definida.
- [ ] Task pai com responsável.
- [ ] Subtasks apenas 1 nível; se precisar mais, promover subtask a task.
- [ ] Tags aplicadas quando fizer sentido.
