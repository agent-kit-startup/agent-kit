# How to add and install skills - Agent Kit

This guide explains how to **create** new skills in your workspace and how to **install** skills (from the kit or by category/name) using the registry.

---

## 1. Create a new skill (generator)

The `scripts/new-skill.sh` script generates the folder and `SKILL.md` with standardized template.

**Usage:**

```bash
# In project root (where .cursor/ is located or where agent-kit is)
agent-kit/scripts/new-skill.sh <skill-slug> [category]

# Examples
agent-kit/scripts/new-skill.sh excel-reports data
agent-kit/scripts/new-skill.sh slack-bot integrations
```

**Valid categories:** `integrations`, `data`, `docs`, `devops`, `quality`, `creation` (see [categories.md](categories.md)).

The generator creates `.cursor/skills/<skill-slug>/SKILL.md` with:

- Frontmatter: `name`, `description`, optionally `category`
- Sections: **When to use**, **Process / Instructions**, **Conventions and best practices**, **Examples**, **Notes**
- A suggested decision tree (skill vs subagent) and space for checklist

**Good descriptions:** action + context + criteria. Ex.: *"Validates and formats JSON from configs and payloads; use when user edits .json or mentions schema."* Avoid vague descriptions like "Helps with code".

After creation, edit the file to fill the sections and, if you want the skill to appear in the registry, run the registry build script (below).

---

## 2. Registry and installation by category or name

The **registry** (`skills-registry.json`) is an index of available skills, generated from files in `.cursor/skills/`. It is used to list and install only what you need.

### Generate or update the registry

In project root (where `.cursor/skills/` is located):

```bash
agent-kit/scripts/build-registry.sh .cursor/skills agent-kit/skills-registry.json
```

Registry format: [registry-schema.md](registry-schema.md).

### List skills

```bash
agent-kit list              # all, grouped by category
agent-kit list data         # only from "data" category  
agent-kit list integrations
```

### Install with profile

When installing Agent Kit in the workspace you choose the profile:

| Profile    | What it installs |
|-----------|----------------|
| `complete` | Everything (rules, skills, agents, hooks, commands, templates, autogit) - default |
| `minimal`   | Only handoff, context and git (without rules, skills, agents) |
| `custom`   | Prompts: install by **category** or by skill **name** |

Example:

```bash
agent-kit install custom
```

If the registry exists, the `custom` install uses the category and skill list for you to choose what to copy to `.cursor/`. Without registry, install maintains the behavior of copying the kit's fixed set.

---

## 3. Recommended SKILL.md structure

- **Frontmatter:** `name` (identifier), `description` (one line; actionable), `category` (optional; one of those listed in [categories.md](categories.md)).
- **When to use:** scenarios where the agent should apply the skill; decision tree skill vs subagent helps not to use skill for overly complex flows.
- **Process:** specific and actionable steps.
- **Conventions:** project or stack standards (ex.: names, formats, where to place files).
- **Examples:** snippets or real cases (optional).
- **Notes:** limits, dependencies, links (optional).

Keep SKILL.md focused and smaller than ~500 lines; very long details can go in files in subfolder (ex.: `references/`) and the skill instructs the agent to load them when necessary.

---

## 4. Summary

| Action | Command or file |
|------|--------------------|
| Create new skill | `agent-kit/scripts/new-skill.sh <slug> [category]` |
| Update registry | `agent-kit/scripts/build-registry.sh .cursor/skills agent-kit/skills-registry.json` |
| List skills | `agent-kit list [category]` |
| Install (profile) | `agent-kit install [complete\|minimal\|custom]` |
| Categories | [categories.md](categories.md) |
| Registry format | [registry-schema.md](registry-schema.md) |
