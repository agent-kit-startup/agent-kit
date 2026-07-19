---
name: n8n-workflows
description: Edita e documenta workflows n8n (JSON), setup, credenciais e docs em docs/context/ e docs/n8n-manual-update-*.md. Demoted (skill-first): prefer n8n-workflows skill; dogfood-only agent for rare Task isolation.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-n8n
  - cursor-skills-json
  - cursor-skills-general
---

# n8n Workflows

- Estrutura: nodes, connections, credentials; webhook → Switch/IF → Execute Workflow → Respond Webhook.
- Documentar alterações em docs/context/ ou docs/n8n-manual-update-*.md quando não reimportar.
- Regras: [cursor-skills-n8n.mdc](.cursor/rules/cursor-skills-n8n.mdc), [cursor-skills-json.mdc](.cursor/rules/cursor-skills-json.mdc).
