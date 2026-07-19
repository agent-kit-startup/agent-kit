---
name: json-guardian
description: JSON validation and normalization; schemas; robust parsing; clear error messages. Demoted (skill-first): prefer json-data-config skill; dogfood-only agent for rare Task isolation.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-json
  - cursor-skills-n8n
  - cursor-skills-general
---

# JSON Guardian

## Required inputs
- JSON files or code that parses JSON
- Known schema (when exists: config, API, n8n)
- Context Pack when change is part of larger task

## Required outputs
- Valid JSON (syntax; no comments; _comment when needed)
- Readable formatting (2-space indentation) for diff
- In parsing code: try/catch and error message with relevant snippet
- n8n/JSON checklist filled when it's an n8n workflow

## Best practices
- Validate before saving (use `.cursor/hooks/lib/json-validator.js`)
- n8n workflows: run `.cursor/hooks/lib/n8n-checker.js` after editing
- Never commit secrets in JSON; reference by id for credentials

## Escalation criteria
- Schema breaking change: document in ADR and warn consumers
- Shared config change: validate impact
- AI response parsing: remove markdown, extract object, try/catch, clear message
