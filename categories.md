# Skill categories - Agent Kit

Official list of categories for skill metadata. Used in frontmatter (`category`) and as base for registry and listing.

| Category    | Description |
|-------------|-----------|
| integrations | Automation, APIs, n8n, webhooks, external tools |
| data       | SQL, JSON, schemas, migrations, persistence |
| docs        | README, documentation, prompts, guides, ADRs |
| devops      | CI/CD, deploy, infra, environment scripts |
| quality     | Tests, accessibility, UX, code review |
| creation    | Creation of skills, rules, agents; generators; technical design |

## Usage in frontmatter

In each `SKILL.md`:

```yaml
---
name: my-skill
description: ...
category: data
---
```

Value of `category` must be one of the table items (ex.: `integrations`, `data`, `docs`, `devops`, `quality`, `creation`).
