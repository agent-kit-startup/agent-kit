---
name: docs-repo
description: Repository documentation - README, structure, context docs, guides. 4-step process. Professional and inheritable standard (docs-professional-standard). L1 engineering-architecture pack (with docs-repo skill). Use for README, ADRs, runbooks and guides.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-general
  - docs-professional-standard
  - agent-output-hygiene
---

# Repository documentation

Documentation belongs to the **project**: professional, inheritable, without people, external projects or session context. See rules `docs-professional-standard` and `agent-output-hygiene`.

## 4-step process

1. **Clarify and plan** — Scope and audience (software user / maintainer), not the conversation.
2. **Investigate** — Code and existing docs; links and sidebars.
3. **Write or edit** — System voice; timeless; generic placeholders; small edits when possible.
4. **Verify** — Links; alignment with code; inheritance test (new maintainer in 12 months); zero transient content.

## Style guide

- If `references/style-guide.md` exists (or equivalent), follow it.
- Otherwise: short sentences, lists when helpful, terms matching the code.

## References

- [README.md](README.md)
- Rule: `.cursor/rules/docs-professional-standard.mdc`
