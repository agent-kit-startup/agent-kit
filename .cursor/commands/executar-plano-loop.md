# Comando: /executar-plano-loop

## Objetivo

Executar o **plano ativo** em loop contínuo nesta sessão — sem pedir `/continuar-plano` nem nova conversa entre fases.

Cada tick:
1. Lê estado (HANDOFF + plano)
2. Executa **um** to-do (ou o par da fase atual)
3. **Atualiza status** no frontmatter do plano (`pending` → `in_progress` → `completed`) para o usuário acompanhar no painel
4. Atualiza `.cursor/HANDOFF.md`
5. Se houver diff commitável → **`/git-staging`** (autorizado pelo loop)
6. Rearma o próximo tick (skill Loop) ou para

**Nunca** `/git-prod` no loop — produção só com confirmação explícita (HITL).

## Quando usar

- Usuário pediu loop / execução contínua / “roda até o fim”
- Querem staging automático por fase (1 tema ≈ 1 MR)

Modo manual (`/continuar-plano`) continua válido fora do loop.

## Pré-condição

- Existe plano em `.cursor/plans/` com to-dos no frontmatter
- Se não houver plano: criar via `/iniciar-projeto` / plan-routine **antes** de entrar no loop — o Agent Kit **começa pelo plano**

## Modo contínuo (override)

Enquanto o loop estiver ativo, **ignora** a regra “1 fase = 1 chat / peça nova conversa”. Ainda obrigatório:

1. Atualizar to-dos do plano a cada mudança de estado (visível no painel do Cursor)
2. Atualizar `.cursor/HANDOFF.md` ao fim de **cada** tick/fase
3. Memory WRITE se decisão/erro não óbvio
4. Parar e perguntar em risco (prod, PII, escopo ambíguo, secrets)

## Tick (uma iteração)

### 1. Ler estado

- `.cursor/HANDOFF.md` (obrigatório)
- Plano ativo em `.cursor/plans/` (frontmatter `todos`)
- Context Pack `.cursor/context/current/` se existir
- Memory CHECK se a fase tocar erro/decisão conhecida

### 2. Escolher o próximo to-do

Ordem do frontmatter. Pular `completed` / `cancelled`.

Campos opcionais por to-do (budget — ver `autogit/plan-routine.md` §6): se `max_ticks` existir e for atingido neste to-do → HANDOFF + pedir nova conversa, mesmo em loop.

Ao escolher: marcar o to-do como `in_progress` no plano **antes** de implementar (o usuário vê o status mudar).

**Parar o loop (não armar próximo wake) se:**

| Condição | Ação |
|----------|------|
| Próximo to-do é **blocker** externo sem workaround versionável | HANDOFF + mensagem clara; `git staging` só se houver diff |
| Todos os to-dos implementáveis estão `completed` | HANDOFF final; sugerir `/git-prod` se staging à frente de `main` |
| Usuário pediu stop / “para o loop” | Não rearmar |
| Diff exige decisão humana (escopo, risco prod, PII) | Pausar e perguntar — não inventar |

### 3. Executar só este to-do / fase

- Não empilhar a fase seguinte no mesmo tick
- Respeitar skills/rules do repo
- Manter hygiene: commits técnicos, sem transitório no repo

### 4. Review + melhoria (opcional, se o plano tiver)

| Prefixo | O que fazer |
|---------|-------------|
| `review-*` | Revisar entregáveis: gaps, segurança, contratos vs docs. Achados no HANDOFF / memory se tradeoff |
| `melhoria-*` | Aplicar só melhorias objetivas da review. Sem refator cosmética |

Se a review não achar nada: marcar `melhoria-*` como `completed` com nota no HANDOFF e seguir.

### 5. Fechar tick — status + staging

1. Marcar to-do(s) do tick como `completed` no frontmatter do plano
2. Atualizar `.cursor/HANDOFF.md` (incluir `Modo: loop-contínuo`)
3. Se `git status` tiver mudanças commitáveis **e** não for só HANDOFF/memory trivial:
   - Executar rotina `/git-staging` **sem pedir confirmação** (autorizado pelo loop)
   - 1 MR/PR → branch de staging → merge
4. Sem diff commitável: só HANDOFF + status do plano

### 6. Rearmar ou parar

- Ainda há to-do implementável → armar próximo wake (skill Loop / delay curto) com o prompt abaixo
- Parou (blocker / fim / stop) → **não** rearmar; reportar motivo

## Prompt do wake

```text
/executar-plano-loop — próximo tick. Ler HANDOFF + plano. Marcar próximo to-do in_progress. Executar só esse to-do. Ao fechar: completed no plano + HANDOFF + git staging se houver diff. Parar se blocker externo ou plano esgotado. Não pedir /continuar-plano ao usuário. Nunca git prod.
```

## Resposta ao usuário (por tick)

Curto, acompanhável:

> Tick: [to-do id]. Feito: …. Plano: [N completed / total]. Staging: [PR #N / sem diff]. Próximo: … | **Loop parado:** [motivo]

## Stop

Usuário: “para o loop” / “stop” → não rearmar; HANDOFF com estado atual.

## Modo orquestrador externo (`scripts/plan-loop.sh`)

Quando o tick chega via `plan-loop.sh` (o prompt se identifica), cada tick roda num **agente headless novo** (janela de contexto limpa) e o rearme é do shell, não da sessão:

- **Não** usar a skill Loop / não rearmar internamente — executar um to-do e encerrar.
- Terminar a resposta com exatamente uma linha: `LOOP_TICK_RESULT: continue` ou `LOOP_TICK_RESULT: stop — <motivo>`.
- Todo o resto vale igual: um to-do por tick, status no plano, HANDOFF, `/git-staging` se houver diff, **nunca** `/git-prod`.
- Parar o shell no meio: `touch .cursor/loop.stop` ou Ctrl+C.
