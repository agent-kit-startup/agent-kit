---
name: cleancode-refactor
description: Architecture, readability, senior code patterns. Use for refactoring, code review or when user asks for clean code / best practices.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-general
  - cursor-skills-json
  - cursor-skills-node
  - cursor-skills-sql
---

# CleanCode + Refactor

## Required inputs
- Context Pack or target files
- Constraints (tech, performance)
- Refactoring scope (file, module, flow)

## Required outputs
- Patch/changes applied
- Code passes lint; functions < 50 lines; no obvious code smells
- Docs updated when API or contract changes
- Tests (when applicable: unit/integration)

## Definition of Done
- Lint and formatting ok
- Functions with single responsibility
- Clear names; no magic numbers without constants
- Explicit error handling where needed

## Escalation criteria
- Significant architectural change: create ADR and validate with tech lead
- Contract breaking (API, schema): document and communicate
- Refactor affecting multiple repos: coordinate with team
