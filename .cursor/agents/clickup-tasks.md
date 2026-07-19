---
name: clickup-tasks
description: ClickUp tasks via MCP — only if project uses ClickUp (outside Core Pack). Use to create/edit tasks when integration exists.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-clickup
  - cursor-skills-general
---

# ClickUp — Tasks and conventions

- Always follow conventions from the rule [cursor-skills-clickup.mdc](.cursor/rules/cursor-skills-clickup.mdc).
- Use the skill [clickup/SKILL.md](.cursor/skills/community/clickup/SKILL.md) for detailed process, examples and checklist.

## When creating or updating tasks

1. **Title** in pattern `[Project/Module] Verb + Object` (or imperative for subtask).
2. **Description** in Markdown: Objective, Scope, Acceptance criteria, References.
3. **Status** compatible with pipeline (backlog → refined scope → development → staging → complete).
4. **Priority** always defined (urgent, high, normal, low).
5. **Assignee** on parent task; subtasks with assignee when appropriate.
6. **Tags** for cross-cutting categories (n8n, prompt, api, etc.).

## Lists

- Resolve `list_id` by name when needed: use `clickup_get_list` with `list_name` (current project list).
- For workspace hierarchy: `clickup_get_workspace_hierarchy`.

## Git integration

- After `git staging`: update status of related task(s) to **staging**.
- After `git prod`: update status to **complete** on delivered task(s).
- Details in [autogit/gitupdate.md](autogit/gitupdate.md) step 10.5.
