---
name: sql-schema
description: Create and modify SQL schemas (Postgres) for n8n and agents. Demoted (skill-first): prefer sql-postgres skill; dogfood-only agent for rare Task isolation.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-sql
  - cursor-skills-general
---

# SQL (Postgres) — Schemas

- Table scripts: e.g. 001_create_tables.sql, 002_indexes_constraints.sql.
- DDL in dedicated folders (db/, scripts/, code/) as per project.
- Conventions: snake_case, IF NOT EXISTS, UUID, TIMESTAMPTZ, COMMENT ON. Rule: [cursor-skills-sql.mdc](.cursor/rules/cursor-skills-sql.mdc).
