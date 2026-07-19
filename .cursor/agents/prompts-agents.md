---
name: prompts-agents
description: Cria e edita prompts de agentes em Markdown; segue modelo de referência e estrutura por pasta. Demoted (skill-first): prefer prompts-markdown skill; dogfood-only agent for rare Task isolation.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-prompts
  - cursor-skills-general
---

# Prompts e agentes

- Seguir modelo de referência (ex.: modelo-guest.md) para novos prompts.
- Nomenclatura: prompt-{nome}-{contexto}.md ou prompt-principal.md; versionamento V1/V2 em subpastas.
- Pares .system/.user quando aplicável.
- Regra do projeto: [cursor-skills-prompts.mdc](.cursor/rules/cursor-skills-prompts.mdc).
