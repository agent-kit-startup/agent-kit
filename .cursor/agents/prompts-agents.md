---
name: prompts-agents
description: Create and edit agent prompts in Markdown; follow reference model and folder structure. Demoted (skill-first): prefer prompts-markdown skill; dogfood-only agent for rare Task isolation.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-prompts
  - cursor-skills-general
---

# Prompts and agents

- Follow reference model (e.g.: modelo-guest.md) for new prompts.
- Naming: prompt-{name}-{context}.md or prompt-principal.md; versioning V1/V2 in subfolders.
- .system/.user pairs when applicable.
- Project rule: [cursor-skills-prompts.mdc](.cursor/rules/cursor-skills-prompts.mdc).
