---
name: clickup
description: Create and update ClickUp tasks via MCP. Optional - only if the project uses ClickUp. Not part of Core Pack.
version: 0.1.0
category: pm
---

# ClickUp - Task management (optional stack)

**Not part of the Core Pack.** Install/use only when the repository integrates ClickUp. Aligned with rule [cursor-skills-clickup.mdc](.cursor/rules/cursor-skills-clickup.mdc) (`alwaysApply: false`).

## When to Use

- The project already uses ClickUp and has MCP configured.
- Create or update tasks/subtasks; feature breakdown.
- Update status after `git staging` / `git prod` **if** the integration exists.
- Resolve list_id by list name from the **current project** (no hardcoded IDs from another workspace).

## Process (task creation)

1. **Define list:** use `clickup_get_list` with `list_name` (or `list_id` if known).
2. **Title:** follow pattern `[Project/Module] Verb + Object`.
3. **Description:** fill in Markdown - Objective, Scope, Acceptance criteria, References.
4. **Status:** start at `backlog` or `scope defined` depending on maturity.
5. **Priority:** always define (`urgent`, `high`, `normal`, `low`).
6. **Assignee:** define assignee(s); for subtasks, inherit or specify.
7. **Tags:** add cross-cutting tags (n8n, prompt, api, etc.) if applicable.
8. **Due date:** define for milestone/delivery tasks.
9. **Subtasks:** create as actionable steps; max 1 level; if you need sub-items, promote subtask to task.

## Conventions (details)

### Titles

- Task: `[Project/Module] Verb + Object` - e.g., "Checkout - Integrate reservation request".
- Subtask: imperative verb + object - e.g., "Validate reservation flow in n8n", "Update prompt with validation rules".

### Description (Markdown template)

```markdown
## Objective
1-2 sentences about what is expected from the task.

## Scope
- Deliverable 1
- Deliverable 2

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## References
- [Module README](path/in/repo)
- Related task: [ClickUp link]
```

### Status (pipeline order)

| Status             | Use |
|--------------------|-----|
| backlog            | Not yet prioritized/refined |
| scope defined      | Scope defined, ready for dev |
| in progress        | In implementation |
| staging            | In testing/staging; also after `git staging` |
| blocked            | External blocker (always comment the reason) |
| complete           | Completed; also after `git prod` |

### Priority and assignee

- Priority: always inform when creating task.
- Parent task: always with at least one assignee.
- Subtasks: can inherit (leave empty) or have specific assignee.

### Suggested tags

- By type: `n8n`, `prompt`, `api`, `agente`, `hotfix`, `docs`, `testes`.
- Use existing tags in the space when possible.

## Workspace Reference

Do not hardcode `list_id` from a specific workspace in the kit. Always resolve with `clickup_get_list` (`list_name`) or `clickup_get_workspace_hierarchy` in the user's environment.

## Examples

### Well-formatted task

- **Name:** "Checkout - Integrate reservation request in email flow"
- **Description:** Objective (1-2 sentences), Scope in bullets, Criteria in checklist, References (links).
- **Status:** in progress
- **Priority:** high
- **Assignees:** defined
- **Tags:** n8n, prompt

### Poorly formatted task (avoid)

- **Name:** "Integrate thing" (vague, no project).
- **Description:** empty or just one line.
- **Status:** complete without having gone through development/staging.
- **Priority:** omitted.
- **Assignees:** none on parent task.

## Decision Tree

- **Do I need to track this item individually (dates, assignee, status)?**
  - **Yes** → It's a **subtask** (if it belongs to a larger delivery) or **task** (if it's a complete delivery).
  - **No** → Use **checklist** within the task.

- **Does this item have multiple steps that also need tracking?**
  - **Yes** → Create a **task** for this item (not subtask with sub-subtasks).
  - **No** → Keep as **subtask** or checklist.

- **Is it a complete delivery or a step of a delivery?**
  - Complete delivery → **Task** in appropriate list.
  - Step of a delivery → **Subtask** of the task representing the delivery.

## Quality checklist (before creating/updating)

- [ ] Title follows pattern [Project/Module] Verb + Object (or imperative for subtask).
- [ ] Description has Objective, Scope, Acceptance criteria and References (for tasks; subtasks can be shorter).
- [ ] Status compatible with pipeline (don't skip from backlog to complete).
- [ ] Priority defined.
- [ ] Parent task with assignee.
- [ ] Subtasks only 1 level; if you need more, promote subtask to task.
- [ ] Tags applied when it makes sense.
