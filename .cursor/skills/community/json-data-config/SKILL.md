---
name: json-data-config
description: Validate, format, and manipulate JSON (configs, payloads, n8n workflows, AI responses).
version: 0.1.0
category: dados
---

# JSON - Config and payloads

## Valid JSON

- Double quotes on keys and strings; commas between items; no trailing comma; correct escaping (`\"`, `\n`).
- JSON does not support comments; use `_comment` key if you need notes in the object.

## Recommended patterns

- **AI response parsing:** remove markdown blocks (`` ```json ``), extract first `{ ... }`, handle `\n`/`\"`; return object with error handling (try/catch, clear message).
- **Configs:** unit structures, mappings; maintain consistent names (e.g., mapping-*.json).
- **n8n workflows:** JSON with `nodes`, `connections`, `settings`; keep readable (indented) when editing manually.

## Best practices

- Validate before saving (syntax); when available, follow schema (config or API).
- In parsing code: always try/catch; error message with relevant excerpt (e.g., first 100-200 chars of raw).
- Minification only for deploy/assets; in repo prefer readable JSON for diff and review.
