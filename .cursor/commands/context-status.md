# Comando: /context-status

## Objetivo
Mostrar o estado atual do contexto: tarefa ativa, handoff, arquivados.

## Quando Usar
- Quando quiser saber o que está em andamento
- Para verificar se há tarefa ativa
- Para listar tarefas arquivadas

## O Que Fazer

1. **Verificar tarefa ativa:**
   - Checar `.cursor/context/current/` para Context Pack ativo
   - Mostrar nome da tarefa e resumo do estado

2. **Verificar HANDOFF.md:**
   - Checar se existe `.cursor/HANDOFF.md`
   - Mostrar última atualização e próximos passos

3. **Listar arquivados (últimos 5):**
   - Checar `.cursor/context/archive/` para tarefas concluídas

4. **Responder ao usuário:**

```
📋 Status do Contexto

**Tarefa ativa:** feature-auth (desde 2024-01-15)
  - Fase: 2/5
  - Próximo to-do: implementar-jwt

**Handoff:** Atualizado em 2024-01-16 14:30
  - Instrução: "Continuar implementação do JWT middleware"

**Arquivados (últimos):**
  - 2024-01/setup-inicial
  - 2024-01/configurar-db
```

## Alternativa via CLI

```bash
./cursor-handoff status
```
