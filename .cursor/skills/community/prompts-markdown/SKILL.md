---
name: prompts-markdown
description: Create and edit agent prompts in Markdown (structure, system/user, versioning).
version: 0.1.0
category: prompts
---

# Prompts (Markdown)

**Routing:** small, in-scope prompt edit: apply this skill in the main window. Large or isolated batch (or when it needs its own context): hand to the `prompts-agents` Task subagent (demoted, dogfood-only).

## Recommended structure

- **Objective and general instructions:** agent role, channel, output format (e.g., HTML, plain text, WhatsApp formatting).
- **Classification:** categories and subtypes when applicable; JSON output when structured.
- **Actions/tools:** when to trigger each tool and with which parameters; request/response examples.
- **System/user pairs:** use .system.md files (instructions) and .user.md (input template) for extraction and formatting when applicable.

## Recommended patterns

- **Base model:** maintain a reference model for new prompts (e.g., modelo-guest.md for service).
- **Prompts per agent:** folders by context; naming `prompt-{name}-{context}.md` or `prompt-principal.md`.
- **Versioning:** V1, V2 in subfolders when there's version evolution.

## Best practices

- Clear and objective language; avoid ambiguity in instructions.
- Include expected output examples (JSON or text snippet) when output is structured.
- Reference knowledge base or tools when the agent depends on them; make explicit when to ask for user confirmation.
