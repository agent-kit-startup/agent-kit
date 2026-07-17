---
name: n8n-workflows
description: Edita e documenta workflows n8n (JSON), setup, credenciais e docs em docs/context/ e docs/n8n-manual-update-*.md. Use para alterações em workflows, novos workflows, atualização manual e README n8n.
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
