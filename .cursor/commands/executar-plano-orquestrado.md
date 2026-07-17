# Comando: /executar-plano-orquestrado

## Objetivo

Executar o **plano ativo** com janela principal **magra** (orquestrador) + **workers** que implementam. A principal não escreve código — só lê estado, despacha, confere, grava HANDOFF e faz staging.

Resolve o que o loop não resolve: ticks na mesma sessão **incham** a janela. Aqui o trabalho pesado fica no worker (contexto fresco); a principal só orquestra.

**Nunca** `/git-prod` neste modo — produção só com confirmação explícita (HITL).

## Quando usar

- Planos longos / multi-fase onde a janela da sessão não pode acumular implementação
- IDE com suporte a subagentes / Task (ex.: Cursor)
- Querem staging automático por to-do (1 tema ≈ 1 MR), sem o orquestrador “sujar” o transcript

## Pré-condição

- Plano em `.cursor/plans/` com to-dos no frontmatter
- Sem plano: criar via `/iniciar-projeto` / plan-routine **antes**

## Fallback (IDE sem Task / subagentes)

Se a ferramenta **Task** (ou equivalente de worker) **não estiver disponível**:

1. Informar: *"Orquestrado precisa de workers. Sem Task, degradando."*
2. Oferecer e seguir um dos modos:
   - **`/executar-plano-loop`** — cadência na mesma sessão (aceita inchar a janela)
   - **`/continuar-plano`** — manual, 1 fase ≈ 1 chat
3. Não fingir orquestração implementando na principal.

Orquestrador **externo** headless (`scripts/plan-loop.sh`) é outro caminho: cada tick = agente novo via shell. Não misturar com este comando (ver `/executar-plano-loop`, seção orquestrador externo).

## Papéis

| Papel | Faz | Não faz |
|-------|-----|---------|
| **Orquestrador** (janela principal) | Ler HANDOFF/plano; escolher to-do; marcar `in_progress`; despachar worker; conferir summary; marcar `completed`; HANDOFF; `/git-staging` se diff | Implementar código; dumps de diff/log; `/git-prod` |
| **Worker** (Task) | Executar **só** o to-do; respeitar `read_scope` se existir; devolver summary no contrato | Pedir `/continuar-plano` ao usuário; `/git-prod`; empilhar o próximo to-do |

## Tick (uma iteração do orquestrador)

### 1. Ler estado (principal)

- `.cursor/HANDOFF.md` (obrigatório)
- Plano ativo (frontmatter `todos`)
- Context Pack `.cursor/context/current/` se existir
- Memory CHECK se a fase tocar erro/decisão conhecida

### 2. Escolher o próximo to-do

Ordem do frontmatter. Pular `completed` / `cancelled` / `dogfood-poc` contínuo se não for o foco do tick.

Marcar `in_progress` no plano **antes** de despachar.

**Parar (não despachar / não rearmar) se:**

| Condição | Ação |
|----------|------|
| Blocker externo sem workaround versionável | HANDOFF + mensagem; staging só se houver diff |
| To-dos implementáveis esgotados | HANDOFF final; sugerir `/git-prod` se staging à frente de `main` |
| Usuário pediu stop | Não rearmar |
| Decisão humana (escopo, PII, prod) | Pausar e perguntar |

### 3. Despachar worker

Usar a ferramenta **Task** (ou subagente equivalente) com prompt **auto-contido** — o worker **não** herda o transcript da principal.

Incluir no prompt:

1. Path do repo e do plano
2. Trecho útil do HANDOFF (fase, próximo to-do)
3. `id` + `content` do to-do
4. Se existirem no frontmatter do to-do (`autogit/plan-routine.md` § budget): `read_scope`, `worker_contract`, `max_ticks`
5. Contrato de output abaixo
6. Regras: um to-do só; hygiene; nunca `/git-prod`; não rearmar loop

**Template de prompt do worker:**

```text
Você é um worker do Agent Kit. Execute SÓ o to-do abaixo e encerre.

Repo: <path>
Plano: .cursor/plans/<arquivo>
HANDOFF (resumo): <fase / próximo>
To-do id: <id>
To-do: <content>
read_scope (se houver): <globs — só leia o necessário fora disso>
max_ticks deste to-do (se houver): <N>

Regras:
- Implemente só este to-do; não empilhe o próximo
- Atualize status no frontmatter do plano (in_progress → completed) se a principal não tiver feito
- Hygiene: commits/docs técnicos; sem transitório
- Nunca /git-prod
- Não peça /continuar-plano ao usuário

Devolva APENAS o summary no contrato (sem dump de diff/log):
## Worker summary
- Todo: <id>
- Changed: <paths ou “nenhum”>
- Gaps: <none | lista curta>
- Staging ready: sim|não
- Notes: <1–2 frases opcionais>
```

Preferir `run_in_background: false` para o orquestrador conferir o retorno no mesmo tick. Escolher `subagent_type` adequado (`generalPurpose` ou domínio: `docs-repo`, `git-autogit`, etc.).

### 4. Conferir retorno (principal)

- Summary no formato? Gaps bloqueantes?
- Se worker falhou ou saiu do escopo: corrigir com **um** re-despacho focado, ou pausar e perguntar — não implementar na principal
- Contar ticks deste to-do; se `max_ticks` existir e for atingido → HANDOFF + pedir nova conversa (`/continuar-plano`), mesmo em modo orquestrado

### 5. Fechar tick — status + staging

1. Garantir to-do `completed` no frontmatter
2. Atualizar `.cursor/HANDOFF.md` (`Modo: orquestrado`)
3. Se `git status` tiver diff commitável (não só HANDOFF/memory trivial):
   - `/git-staging` **sem pedir confirmação** (autorizado pelo modo)
4. Memory WRITE se decisão/erro não óbvio

### 6. Rearmar ou parar

- Ainda há to-do implementável e a principal **não** está inchada → próximo tick (despachar de novo ou skill Loop com prompt de wake)
- Principal inchada / contexto crítico → HANDOFF + pedir nova conversa com `/continuar-plano` ou `/executar-plano-orquestrado`
- Parou → reportar motivo; **não** rearmar

## Prompt do wake (próximo tick na mesma sessão)

```text
/executar-plano-orquestrado — próximo tick. Ler HANDOFF + plano. Marcar próximo to-do in_progress. Despachar worker (Task) com prompt auto-contido; NÃO implementar na principal. Conferir summary; completed + HANDOFF + git staging se diff. Parar se blocker ou plano esgotado. Sem Task → degradar para loop ou manual. Nunca git prod.
```

## Resposta ao usuário (por tick)

Curto:

> Orq: [to-do id]. Worker: [summary em 1 linha]. Plano: [N completed / total]. Staging: [PR #N / sem diff]. Próximo: … | **Parado:** [motivo]

## Stop

Usuário: “para o orquestrador” / “stop” → não rearmar; HANDOFF com estado atual.

## HITL (invariantes)

- `/git-prod` **nunca** neste modo
- Risco (PII, secrets, escopo ambíguo) → parar e perguntar
- Orquestrador magro: se a principal começar a editar código de feature, está errado — despachar de novo ou degradar
