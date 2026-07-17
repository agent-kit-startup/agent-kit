---
name: prompts-markdown
description: Create and edit agent prompts in Markdown (structure, system/user, versioning).
version: 0.1.0
category: prompts
---

# Prompts (Markdown)

## Estrutura recomendada

- **Objetivo e instruções gerais:** papel do agente, canal, formato de saída (ex.: HTML, texto puro, formatação WhatsApp).
- **Classificação:** categorias e subtipos quando aplicável; saída em JSON quando for estruturada.
- **Ações/ferramentas:** quando acionar cada tool e com quais parâmetros; exemplos de request/response.
- **Pares .system/.user:** usar arquivos .system.md (instruções) e .user.md (template de input) para extração e formatação quando aplicável.

## Padrões recomendados

- **Modelo base:** manter um modelo de referência para novos prompts (ex.: modelo-guest.md para atendimento).
- **Prompts por agente:** pastas por contexto; nomenclatura `prompt-{nome}-{contexto}.md` ou `prompt-principal.md`.
- **Versionamento:** V1, V2 em subpastas quando houver evolução de versão.

## Boas práticas

- Linguagem clara e objetiva; evitar ambiguidade nas instruções.
- Incluir exemplos de saída esperada (JSON ou trecho de texto) quando a saída for estruturada.
- Referenciar base de conhecimento ou tools quando o agente depender delas; deixar explícito quando pedir confirmação ao usuário.
