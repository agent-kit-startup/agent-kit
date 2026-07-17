# Comando: /handoff

## Objetivo
Atualizar o documento de handoff para preservar o estado atual e permitir continuação em nova conversa.

## Quando Usar
- Ao fim de cada fase de um plano
- Quando o contexto estiver ficando cheio
- Antes de pausar o trabalho por tempo prolongado
- Quando quiser registrar progresso

## O Que Fazer

1. **Verificar tarefa ativa:**
   - Checar se existe Context Pack em `.cursor/context/current/`
   - Checar se existe plano ativo em `.cursor/plans/`

2. **Atualizar `.cursor/HANDOFF.md` com:**
   - Nome do plano (arquivo)
   - Última atualização (timestamp)
   - Fase concluída
   - To-dos concluídos (ids)
   - Próxima fase
   - Próximos to-dos (ids)
   - Instrução clara para o próximo agente (1-3 frases)

3. **Spine DevOps (sugerir, não executar sem pedido):**
   - Se a fase gerou código commitável → sugerir `/git-staging` para promover à pré-prod.
   - Se houve erro/decisão com tradeoff → sugerir memory-loop WRITE (`.cursor/memory/`).
   - Nunca sugerir commit direto em `main`; produção só via `/git-prod` após staging.

4. **Responder ao usuário:**
   > "Handoff atualizado! Continuar: `/continuar-plano`. Com código pronto: `/git-staging`. Produção: `/git-prod`."

## Alternativa via CLI

```bash
./cursor-handoff handoff
# ou: agent-kit handoff
```

Isso atualiza o HANDOFF.md com base no plano / Context Pack ativo.

## Loop completo

```
plano → trabalho → /handoff → /git-staging → (aprovação) → /git-prod → memory
```
