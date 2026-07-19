---
name: sql-schema
description: Cria e altera schemas SQL (Postgres) para n8n e agentes. Demoted (skill-first): prefer sql-postgres skill; dogfood-only agent for rare Task isolation.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-sql
  - cursor-skills-general
---

# SQL (Postgres) — Schemas

- Scripts de tabelas: ex. 001_create_tables.sql, 002_indexes_constraints.sql.
- DDL em pastas dedicadas (db/, scripts/, code/) conforme o projeto.
- Convenções: snake_case, IF NOT EXISTS, UUID, TIMESTAMPTZ, COMMENT ON. Regra: [cursor-skills-sql.mdc](.cursor/rules/cursor-skills-sql.mdc).
