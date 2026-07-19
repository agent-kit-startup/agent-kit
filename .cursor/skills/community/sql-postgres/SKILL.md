---
name: sql-postgres
description: Write and review Postgres SQL (DDL, DML, indexes, constraints). Use for .sql, schemas, or Postgres mentions.
version: 0.1.0
category: dados
---

# SQL (Postgres)

## DDL and conventions

- **CREATE TABLE:** use `IF NOT EXISTS`; explicit primary key; appropriate types (UUID, TEXT, TIMESTAMPTZ, JSONB).
- **Names:** snake_case for tables and columns.
- **Documentation:** `COMMENT ON TABLE ...` and `COMMENT ON COLUMN ...` when it helps maintenance.

## Recommended patterns

- Table scripts: e.g. `001_create_tables.sql`, `002_indexes_constraints.sql`; `uuid-ossp` extension when using UUID.
- Sequences for protocols or numeric IDs when applicable.
- DDL for integrations (filters, logs, events) in dedicated folders (e.g., db/, scripts/, code/).

## Best practices

- Idempotent scripts: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`; avoid failure on re-execution.
- TIMESTAMPTZ for dates/times; UUID for ids when applicable.
- Schema changes: document in docs or module README.
