# Roteiro de Planos — Criação e Sincronização

O Agent Kit **começa pelo plano**: sem plano com to-dos, não há execução estruturada. Criar/atualizar o plano antes de implementar.

Quando o usuário solicitar a **criação de um novo plano** (ou o agente estiver no modo planner criando planos), seguir **sempre** este roteiro:

---

## 1. Criar o plano com to-dos

- **Sempre incluir to-dos** no frontmatter do plano (array com `id`, `content`, `status`).
- Respeitar ordem de fases (0 → 1 → 2 → …).
- Cada fase com to-dos acionáveis e rastreáveis.
- Durante a execução, manter `status` atualizado (`pending` → `in_progress` → `completed`) para o usuário acompanhar no painel do plano.

---

## 2. Incluir verificação de segurança

Quando o plano envolver **fluxos, APIs, integrações ou deploy**:

- Adicionar fase ou seção **"Verificação completa de segurança"** com:
  - **Fluxo e integridade:** webhook, filtros, timeouts, error handling
  - **Segredos e credenciais:** nenhum no código; env.example sem valores reais; tokens ofuscados em docs
  - **Boas práticas:** PII, rate limits, HTTPS, idempotência
  - **Checklist pré-produção:** check-secrets, CHANGELOG, documentação

---

## 3. Sincronizar com gerenciador de projetos (opcional)

**Só se o projeto usar um PM tool** (ClickUp, Jira, Linear, etc.) e o usuário indicar task pai ou integração ativa.

Quando houver task pai:

1. Criar subtarefa por fase (ou to-do acionável) na tool do **projeto**.
2. Seguir convenções da skill/rule dessa tool (se existir) — o kit **não** assume ClickUp.
3. Registrar IDs no plano para atualização entre fases.

Se não houver PM tool: pular. Planos + HANDOFF + Git bastam para o spine estrutural.

---

## 4. Manter PM atualizado entre fases (se existir)

- **Ao concluir cada fase:** atualizar status da subtarefa correspondente.
- **Ao fim do plano:** após `git prod`, marcar entrega como complete na tool do projeto.
- **Ao atualizar HANDOFF.md:** mencionar subtarefas só se existirem.

---

## 5. Três modos de execução

| Modo | Comando | Comportamento |
|------|---------|---------------|
| **Manual** | `/continuar-plano` | 1 fase ≈ 1 chat; sugere `/git-staging`; handoff se contexto cheio |
| **Loop** | `/executar-plano-loop` | Ticks na mesma sessão; status do plano a cada tick; `/git-staging` automático se houver diff; **nunca** `/git-prod` |
| **Orquestrado** | `/executar-plano-orquestrado` | Janela principal magra + workers (Task); staging automático se houver diff; **nunca** `/git-prod`. Sem Task/subagentes: degradar para loop ou manual |

Em **qualquer** modo: plano primeiro → atualizar to-dos → HANDOFF → staging. O painel do plano é o placar para o humano acompanhar.

---

## 6. Budget de contexto por to-do (opcional)

Template canônico: [`.cursor/context/templates/plan.md`](../.cursor/context/templates/plan.md).

Cada item de `todos` no frontmatter pode incluir campos de **budget** (além de `id`, `content`, `status`):

| Campo | Tipo | Semântica |
|-------|------|-----------|
| `read_scope` | lista de globs/paths | Escopo de leitura do worker; fora disso, só HANDOFF + plano + o estritamente necessário |
| `worker_contract` | string | Formato do retorno (padrão de facto: `summary + staging-ready` — ver `/executar-plano-orquestrado`) |
| `max_ticks` | número inteiro ≥ 1 | Ticks neste to-do antes de HANDOFF forçado + nova conversa |

Exemplo:

```yaml
todos:
  - id: fase7-exemplo
    content: "Aplicar migration e atualizar docs de filas"
    status: pending
    read_scope: ["db/002_*.sql", "docs/FILAS.md"]
    worker_contract: "summary + staging-ready"
    max_ticks: 3
```

**Regras:**

- Campos **opcionais**. Omitir = sem budget explícito (legado).
- Em **orquestrado**: a principal copia os campos para o prompt do worker; o worker respeita `read_scope` e devolve no `worker_contract`.
- Em **loop** / **manual**: `read_scope` e `max_ticks` ainda valem como guia; se `max_ticks` for atingido → HANDOFF + pedir nova conversa (mesmo em loop).
- `max_ticks` estourado **não** autoriza `/git-prod`.

Ao criar planos (`/iniciar-projeto` ou planner): preferir o template; preencher budget em to-dos longos ou multi-arquivo.

---

## 7. Atualizar HANDOFF ao fim de cada fase

Conforme [cursor-plan-handoff.mdc](.cursor/rules/cursor-plan-handoff.mdc):

- Registrar fase concluída, to-dos concluídos, próxima fase.
- Incluir instrução para o próximo agente.
- Modo **manual**: se a fase gerou código commitável, **sugerir** `/git-staging` (não executar sem pedido).
- Modo **loop**: executar `/git-staging` ao fim do tick se houver diff (autorizado pelo comando).
- Modo **orquestrado**: mesma regra de staging; a principal só despacha/confere (não implementa).
- Produção só via `/git-prod` com confirmação explícita.
- Se tarefas de PM tool foram atualizadas, mencionar no HANDOFF.

---

## 8. Fechar fase no Git (spine DevOps)

| Momento | Comando | Efeito |
|---------|---------|--------|
| Código pronto para pré-prod | `/git-staging` | Promote → branch de staging + HANDOFF |
| Pré-prod aprovada | `/git-prod` | Promote → `main` + HANDOFF (+ memory se couber) |
| Incidente/decisão no caminho | memory-loop WRITE | Persistir em `.cursor/memory/` |

Sem staging/prod, o handoff descreve trabalho que o Git ainda não “lembra”.

---

## Resumo para o agente

| Momento | Ação |
|---------|------|
| **Criar plano** | Template `plan.md` + to-dos no frontmatter (+ budget se couber) + fase de segurança (se aplicável) — **sempre antes de executar** |
| **Durante execução** | Atualizar `status` dos to-dos no plano (placar); honrar `read_scope` / `max_ticks` |
| **PM tool + task pai** | Subtarefas por fase (opcional — só se o projeto usar) |
| **Fim de cada fase / tick** | Atualizar HANDOFF; staging (sugerir ou automático conforme o modo) |
| **Pré-prod** | `/git-staging` |
| **Fim do plano / release** | `/git-prod`; complete na PM tool se existir |

---

## Referências

- [`.cursor/context/templates/plan.md`](../.cursor/context/templates/plan.md) — template canônico com budget
- [cursor-plan-handoff.mdc](.cursor/rules/cursor-plan-handoff.mdc)
- [cursor-skills-git-workflow.mdc](.cursor/rules/cursor-skills-git-workflow.mdc)
- [autogit/gitupdate.md](autogit/gitupdate.md) (`git staging`, `git prod`)
- [`.cursor/commands/executar-plano-loop.md`](../.cursor/commands/executar-plano-loop.md)
- [`.cursor/commands/executar-plano-orquestrado.md`](../.cursor/commands/executar-plano-orquestrado.md)
- PM tools (ClickUp, Jira, …): skills/rules **opcionais** — só se o projeto exigir
