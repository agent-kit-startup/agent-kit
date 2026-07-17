# Comando: /iniciar-projeto

## Objetivo
Primeiro uso após instalação ou quando não há plano ativo.

## Quando Usar
- Primeira vez usando o Agent Kit
- Quando não há plano nem Context Pack ativo
- Quando quiser começar um novo projeto/tarefa

## O Que Fazer

### Se for primeira execução (sem plano/Context Pack):

1. **Perguntar objetivo:**
   > "E aí! Qual é o objetivo do seu projeto? (Em 1-2 frases)"

2. **Criar plano com to-dos:**
   - Ajudar o usuário a definir as principais etapas
   - Criar plano em `.cursor/plans/` a partir do template [`.cursor/context/templates/plan.md`](../context/templates/plan.md)
   - Frontmatter com `todos` (`id`, `content`, `status`); em to-dos longos, preencher budget (`read_scope`, `worker_contract`, `max_ticks`) — ver `autogit/plan-routine.md`
   - Sugerir fases se o projeto for grande

3. **Iniciar primeira tarefa:**
   > "Plano criado! Vou começar pelo primeiro to-do: [descrição]. Pode ser?"

### Se já houver plano/Context Pack:

1. **Ler estado atual:**
   - Checar `.cursor/HANDOFF.md`
   - Checar `.cursor/context/current/`
   - Checar `.cursor/plans/`

2. **Resumir e sugerir:**
   > "Já tem um plano em andamento: [nome]. Fase 2/5. Quer continuar ou começar algo novo?"

## Fluxo de Onboarding

```
Usuário: /iniciar-projeto
Agente: E aí! Qual é o objetivo do seu projeto?
Usuário: Criar uma API de autenticação com JWT
Agente: Beleza! Vou criar um plano com as etapas principais:
        1. Setup do projeto (deps, estrutura)
        2. Implementar login/registro
        3. Implementar JWT (access + refresh)
        4. Middleware de autenticação
        5. Testes
        Posso criar esse plano e começar pelo setup?
Usuário: sim
Agente: [Cria plano e inicia primeira tarefa]
```

## Dica

Se o usuário não souber o que quer, ajudar a definir:
> "Tá em dúvida? Me conta um pouco do que você quer construir e a gente define juntos."
