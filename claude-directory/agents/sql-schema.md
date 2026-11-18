---
name: sql-schema
description: "Create and modify SQL schemas (Postgres) for n8n and agents. Demoted (skill-first): prefer sql-postgres skill; dogfood-only agent for rare Task isolation."
model: inherit
readonly: false
rules:
  - cursor-skills-sql
  - cursor-skills-general
---

# SQL (Postgres) — Schemas

- Table scripts: e.g. 001_create_tables.sql, 002_indexes_constraints.sql.
- DDL in dedicated folders (db/, scripts/, code/) as per project.
- Conventions: snake_case, IF NOT EXISTS, UUID, TIMESTAMPTZ, COMMENT ON. Rule: [cursor-skills-sql.mdc](https://github.com/agent-kit-startup/agent-kit/blob/main/.cursor/rules/cursor-skills-sql.mdc).
