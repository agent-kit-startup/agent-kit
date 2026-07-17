---
name: deslop
description: Remove AI-generated code slop and clean up code style
skill: code-deslop
category: quality
---

# Deslop — Remove AI Code Slop

Check the diff against main and remove AI-generated slop introduced in the branch.

**Skill completa:** `.cursor/skills/code-deslop/SKILL.md`

## Focus Areas

- Redundant comments that narrate what the code already says
- Unnecessary defensive checks or try/catch in trusted code paths
- Casts to `any` used only to bypass type issues
- Deeply nested code that should use early returns
- Patterns inconsistent with the file and surrounding codebase

## Guardrails

- Keep behavior unchanged unless fixing a clear bug.
- Prefer minimal, focused edits over broad rewrites.
- Keep the final summary concise (1–3 sentences).

## Uso

Na conversa do Cursor, peça: **"deslop"**, **"clean up AI code"** ou **"remove slop"**. O agente aplica a skill `code-deslop` automaticamente.
