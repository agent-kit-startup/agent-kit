---
name: ux-message-flows
description: Conversational UX for chat agents (short messages, tone, confirmations, handoff).
version: 0.1.0
category: ux
---

# Skill: UX para Fluxos de Mensagens (Chatbots, WhatsApp, Telegram)

Boas práticas para criar fluxos conversacionais em agentes de chat.

## Quando Usar

- Ao criar prompts de agentes de chat
- Ao projetar workflows de atendimento
- Ao revisar fluxos conversacionais
- Ao trabalhar com WhatsApp, Telegram, chatbots em geral

## 1. Estrutura de Mensagens

- **Mensagens curtas:** Máximo 3 linhas por bloco.
- **Uma ação por mensagem:** Não misturar múltiplos pedidos.
- **Confirmações claras:** "Entendi! Você quer X, certo?"
- **Quebrar mensagens longas:** Dividir em múltiplas mensagens curtas.

### Exemplo

**Ruim:**
> "Olá! Bem-vindo ao nosso atendimento. Para prosseguir, preciso do seu CPF, nome completo, data de nascimento e e-mail. Depois disso, vou verificar sua conta e te informar sobre as opções disponíveis."

**Bom:**
> "Olá! Vou te ajudar a verificar sua conta."
> "Qual é o seu CPF?"

## 2. Tone of Voice

- **Amigável, direto, sem jargão desnecessário.**
- **Adaptar ao contexto:**
  - Formal para enterprise/B2B
  - Casual para consumer/B2C
- **Emojis com moderação:** Use para clareza, não para enfeitar.

### Tom por Contexto

| Contexto | Tom | Exemplo |
|----------|-----|---------|
| Suporte técnico | Profissional, calmo | "Entendi o problema. Vou resolver." |
| Atendimento ao cliente | Acolhedor, ágil | "Sem problemas! Já resolvo isso pra você." |
| Vendas | Entusiasmado, consultivo | "Boa escolha! Esse produto é perfeito pra..." |

## 3. Tratamento de Erros

- **Não culpar o usuário:** "Ops, algo deu errado" > "Você errou".
- **Oferecer próximo passo claro:** O que o usuário deve fazer agora.
- **Fallback gentil:** "Não entendi. Você pode reformular?"

### Exemplos de Fallback

- "Hmm, não consegui entender. Você quis dizer [opção A] ou [opção B]?"
- "Desculpa, não achei essa informação. Pode tentar de outro jeito?"
- "Não entendi. Quer falar com um atendente humano?"

## 4. Confirmações e Feedback

- **Sempre confirmar ações importantes:** "Reserva confirmada para 15/03."
- **Indicadores de progresso:** "Processando...", "Quase lá!", "Verificando..."
- **Fechamento claro:** "Pronto! Seu pedido foi registrado."

### Tipos de Confirmação

| Tipo | Quando usar | Exemplo |
|------|-------------|---------|
| Confirmação rápida | Ações simples | "Feito!" |
| Confirmação com resumo | Ações importantes | "Reserva confirmada: Hotel X, 15-17/03, 2 adultos." |
| Confirmação com próximo passo | Ações em fluxo | "Pagamento recebido! Agora vou enviar seu ingresso." |

## 5. Fluxos de Handoff (Agente → Humano)

Quando o agente precisa passar para um atendente humano:

1. **Avisar o usuário:** "Vou transferir para um atendente."
2. **Passar contexto resumido para o humano:** CPF, problema, o que já foi tentado.
3. **Confirmar quando humano assumir:** "Pronto! Você está falando com [Nome]."

### Exemplo de Handoff

> **Agente:** "Esse caso precisa de um atendente especializado. Vou te transferir agora."
> **Agente:** "Passando o contexto: cliente quer cancelar reserva #12345, já tentou pelo app."
> **Atendente:** "Olá! Sou a Maria. Vi que você quer cancelar a reserva. Vou resolver isso."

## 6. Padrões de Fluxo

### Menu de Opções

```
O que você precisa?
1️⃣ Fazer reserva
2️⃣ Cancelar reserva
3️⃣ Falar com atendente

(Digite o número ou escreva o que precisa)
```

### Coleta de Dados Sequencial

```
Agente: "Qual é o seu CPF?"
Usuário: "123.456.789-00"
Agente: "Perfeito! E o seu e-mail?"
Usuário: "joao@email.com"
Agente: "Ótimo! Dados confirmados. Agora vou verificar sua conta."
```

### Confirmação de Entendimento

```
Usuário: "quero mudar a data"
Agente: "Entendi! Você quer alterar a data da sua reserva. É isso?"
Usuário: "sim"
Agente: "Certo! Para qual data você quer mudar?"
```

## 7. Erros Comuns a Evitar

| Erro | Problema | Solução |
|------|----------|---------|
| Mensagens muito longas | Usuário não lê | Dividir em múltiplas mensagens curtas |
| Múltiplas perguntas de uma vez | Usuário confunde | Uma pergunta por vez |
| Jargão técnico | Usuário não entende | Linguagem simples |
| Sem próximo passo | Usuário fica perdido | Sempre indicar o que fazer |
| Tom robótico | Usuário desconecta | Tom amigável e natural |

## 8. Checklist Rápido

- [ ] Mensagens com máximo 3 linhas
- [ ] Uma ação por mensagem
- [ ] Próximo passo claro
- [ ] Tom adequado ao contexto
- [ ] Fallback gentil para erros
- [ ] Confirmação de ações importantes
- [ ] Handoff suave para humano quando necessário
