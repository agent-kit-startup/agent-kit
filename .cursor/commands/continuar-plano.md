# Comando: /continuar-plano

## Objetivo
Retomar um plano ou tarefa a partir do último handoff.

## Quando Usar
- Ao iniciar uma nova conversa após handoff
- Quando quiser continuar de onde parou

## O Que Fazer

1. **Ler `.cursor/HANDOFF.md`** (obrigatório)
   - Se não existir: informar que não há handoff registrado e sugerir `/iniciar-projeto`

2. **Identificar o estado:**
   - Qual plano está ativo
   - Qual fase foi concluída
   - Quais to-dos estão pendentes
   - Instrução do agente anterior

3. **Ler Context Pack** (se existir):
   - Checar `.cursor/context/current/` para detalhes do estado
   - Verificar arquivos tocados, decisões, constraints

4. **Resumir para o usuário:**
   > "[Fase X/Y concluída] Último passo: [descrição]. Próximo: [to-do]. Bora?"

5. **Continuar a partir do próximo to-do indicado**

## Fluxo Típico

```
Usuário: /continuar-plano
Agente: Lendo HANDOFF.md... Fase 2/5 concluída. Próximo: implementar autenticação.
Agente: Vou começar pelo to-do "criar-auth-service". Pode ser?
Usuário: sim
Agente: [Inicia a tarefa]
```

## Dica

Se o handoff estiver desatualizado ou confuso, o usuário pode pedir um resumo:
> "Me explica onde paramos e o que falta fazer"
