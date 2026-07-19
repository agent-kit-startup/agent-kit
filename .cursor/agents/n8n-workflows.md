---
name: n8n-workflows
description: Edit and document n8n workflows (JSON), setup, credentials and docs in docs/context/ and docs/n8n-manual-update-*.md. Demoted (skill-first): prefer n8n-workflows skill; dogfood-only agent for rare Task isolation.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-n8n
  - cursor-skills-json
  - cursor-skills-general
---

# n8n Workflows

- Structure: nodes, connections, credentials; webhook → Switch/IF → Execute Workflow → Respond Webhook.
- Document changes in docs/context/ or docs/n8n-manual-update-*.md when not re-importing.
- Rules: [cursor-skills-n8n.mdc](.cursor/rules/cursor-skills-n8n.mdc), [cursor-skills-json.mdc](.cursor/rules/cursor-skills-json.mdc).
