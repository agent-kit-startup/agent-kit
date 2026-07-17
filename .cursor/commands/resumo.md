# Comando: /resumo

## Objetivo
Dar um resumo rápido do estado atual para usuário perdido.

## Quando Usar
- Quando o usuário parecer perdido
- Quando pedir "onde estamos?", "o que falta?", "resumo"
- Após longos intervalos sem interação

## O Que Fazer

1. **Identificar contexto:**
   - Ler `.cursor/HANDOFF.md` se existir
   - Ler Context Pack ativo se existir
   - Considerar o histórico da conversa atual

2. **Montar resumo em 3 partes:**
   - **O que foi feito:** Lista curta (máx 3 itens)
   - **O que está em andamento:** Tarefa/to-do atual
   - **O que falta:** Próximos passos (máx 3 itens)

3. **Perguntar próximo passo:**
   > "Quer continuar de onde paramos ou fazer outra coisa?"

## Formato da Resposta

```
📍 Resumo Rápido

✅ Feito:
- Estrutura de pastas criada
- Autenticação básica implementada

🔄 Em andamento:
- Implementar refresh token (to-do: refresh-token)

📋 Próximos:
- Testes de autenticação
- Documentação da API

Quer continuar com o refresh token ou pular para outra coisa?
```

## Dica

Manter o resumo curto. Se o usuário quiser detalhes, vai pedir.
