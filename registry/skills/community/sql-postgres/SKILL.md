---
name: sql-postgres
description: Write and review Postgres SQL (DDL, DML, indexes, constraints). Use for .sql, schemas, or Postgres mentions.
version: 0.1.0
category: dados
---

# SQL (Postgres)

## DDL e convenções

- **CREATE TABLE:** usar `IF NOT EXISTS`; chave primária explícita; tipos adequados (UUID, TEXT, TIMESTAMPTZ, JSONB).
- **Nomes:** snake_case para tabelas e colunas.
- **Documentação:** `COMMENT ON TABLE ...` e `COMMENT ON COLUMN ...` quando ajudar manutenção.

## Padrões recomendados

- Scripts de tabelas: ex. `001_create_tables.sql`, `002_indexes_constraints.sql`; extensão `uuid-ossp` quando usar UUID.
- Sequências para protocolos ou IDs numéricos quando aplicável.
- DDL para integrações (filtros, logs, eventos) em pastas dedicadas (ex.: db/, scripts/, code/).

## Boas práticas

- Scripts idempotentes: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`; evitar falha em reexecução.
- TIMESTAMPTZ para datas/horas; UUID para ids quando aplicável.
- Alterações de schema: documentar em docs ou README do módulo.
