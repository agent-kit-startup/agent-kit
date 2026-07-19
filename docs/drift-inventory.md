# Drift inventory - workspaces × Agent Kit

Snapshot of how Agent Kit (or a folder copy) appears across local workspaces. Used as input to the layer model (L0–L3), manifest, and CLI lifecycle. Counts are from a filesystem scan on 2026-07-16; they will drift again until distribution stops being “copy the folder”.

**Source of truth (SoT):** Agent Kit monorepo at this repo (package version `3.0.0` in `package.json`; product release notes at `3.1.0`).

## Summary

| Signal | Finding |
|--------|---------|
| Full `agent-kit/` copy inside project | **Removed** from fleet targets. SoT monorepo only. |
| Heavy copy (packages + node_modules) | consumer-3 nested copy deleted in `f4-migrar-frota` |
| Manifest `agent-kit.json` | Fleet targets above + SoT dogfood |
| Version of installed kit | Only readable where `agent-kit/package.json` exists (consumer-2, consumer-3 → `3.0.0`); others → unknown |
| Structural spread | Rules 1–27; commands 5–21; skills 1–12; hooks 0–8 |
| Staging vs homolog | `git-prod` almost universal; `git-staging` canonical; `git-homolog` removed |

**Root cause (solved via registry):** previous distribution = one-shot folder copy. Registry-based installation provides versioned updates and protected L3 paths.

## Per-workspace table

| Workspace | `.cursor` | Rules | Cmds | Skills | Hooks | Agents | `agent-kit/` copy | Heavy copy | Kit version | Notes |
|-----------|-----------|------:|-----:|-------:|------:|-------:|-------------------|------------|-------------|-------|
| agent-kit (SoT) | yes | 23 | 9 | 7 | 4 | 13 | no | - | 3.0.0 | memory + plans; dogfood of the registry system |
| consumer-1 | yes | L0+L3 | L0+1 | mixed | 1 | pack agents | **no** (migrated) | - | 3.0.0 via manifest | Registry installation; orchestration commands available |
| consumer-2 | yes | L0+L3 | L0+ | mixed | yes | pack | **no** | - | 3.0.0 via manifest | Migrated `f4-migrar-frota`; L3 strong |
| consumer-3 | yes | L0+L3 | L0+ | mixed | yes | pack | **no** | - | 3.0.0 via manifest | Nested ~118M removed; pack `cybersec` |
| consumer-4 | yes | L0+L3 | L0+ | mixed | yes | pack | **no** | - | 3.0.0 via manifest | Migrated; keep L3 (project-specific rules) |
| consumer-5 | yes | L0+L3 | L0+ | mixed | yes | pack | **no** | - | 3.0.0 via manifest | Migrated |
| consumer-6 | yes | L0+L3 | L0+ | mixed | yes | pack | **no** | - | 3.0.0 via manifest | Migrated |
| consumer-7 | yes | L0+L3 | L0+ | mixed | yes | pack | **no** | - | 3.0.0 via manifest | Migrated |
| consumer-8 | yes | L0+L3 | L0+ | mixed | yes | pack | **no** | - | 3.0.0 via manifest | Migrated |
| consumer-9 | yes | 15 | 7 | 3 | 6 | 10 | no | - | - | kit-like `.cursor` without folder copy |
| consumer-10 | **no** | 0 | 0 | 0 | 0 | 0 | no | - | - | not onboarded |
| consumer-11 | yes | 1 | 5 | 1 | 0 | 0 | no | - | - | thin / alternate command names |
| consumer-12 | yes | 27 | 21 | 12 | 6 | 17 | no | - | - | department OS; largest L3 surface |
| consumer-13 | yes | 11 | 12 | 4 | 1 | 3 | no | - | - | site-specific commands/skills |
| consumer-14 | yes | 18 | 8 | 5 | 6 | 11 | no | - | - | memory |

## Denominator comum → L0 candidates

Present in **≥10 / 13** non-SoT workspaces that have `.cursor` (structural loop, not stack):

| Artifact | Approx. coverage | Layer hint |
|----------|------------------|------------|
| `cursor-plan-handoff.mdc` | 12/13 | L0 |
| `ux-tone.mdc` | 12/13 | L0 (tone for chat) |
| `cursor-skills-general.mdc` | 11/13 | L0 spine / merge with hygiene |
| `cursor-skills-git-workflow.mdc` | 11/13 | L0 |
| `context-guardian.mdc` | 11/13 | L0 / gestao-contexto |
| `continue-plan.md`, `handoff.md`, `start-project.md`, `summary.md`, `context-status.md` | 12/13 | L0 commands |
| `git-prod.md` | 13/13 | L0 |
| `git-staging.md` | 5/13 | L0 (canonical; migrate homolog) |
| `git-homolog.md` | 0/13 | Removed (was legacy alias) |

**Promote upstream (already in SoT or promoted to L0):**

| Artifact | Where seen | Action |
|----------|------------|--------|
| `memory-loop.mdc` | SoT and registry installations | L0 - available via registry |
| `/run-plan-loop` | Registry-based installations | L0 - shipped with orchestration commands |
| `git-staging` adoption | minority | L0 - finish homolog→staging migration in fleet |

## Stack noise often mistaken for core

Present in many workspaces but **not** L0 (belong in L1 packs or L2 skills):

- Rules: `cursor-skills-n8n`, `node`, `sql`, `php`, `python`, `api`, `clickup`, `testing`, `webdesign`, `mobile`, `groovy`, `prompts`, `json`, `devops`, `integrations`
- Skills: `n8n-workflows`, `sql-postgres`, `json-data-config`, `prompts-markdown`, `ux-message-flows`, `clickup` (registry community; not L0)

These inflate “everyone has 20 rules” without being structural.

## L3 - project-unique (keep local; never overwrite)

Examples worth preserving on migrate (`f4-*`):

| Workspace | Unique examples |
|-----------|-----------------|
| consumer-1 | `project-context.mdc`, `lessons-learned.mdc` (orchestration commands now L0) |
| consumer-2 | domain rules (`<project>-*.mdc`), scope-guard rule, domain-specialist skill, deploy cmds |
| consumer-3 | security-domain rules, finding/report commands |
| consumer-4 | i18n-sync rule, design skills, deploy/dev-check cmds |
| consumer-12 | department-OS rules/commands/skills (inbox, triage) - large L3 |
| consumer-13 | site-prefixed rules, site build/deploy/edit commands |
| consumer-11 | architecture rule, alternate handoff command names |
| consumer-8 | stack-specific rules (messaging API, framework dev safety) |

## Orphans to evaluate for upstream

| Item | Location | Recommendation |
|------|----------|----------------|
| `deslop.md` | consumer-4 `agent-kit/` | Prefer skill `clean-code` (registry SoT; alias code-deslop); drop loose md on migrate |
| `benchmark.md` | consumer-5 `agent-kit/` | Project reference → L3 or docs in that workspace; not core |
| `/run-plan-loop` | Registry installations | Promoted to L0 - available via core pack |
| Nested full monorepo under `agent-kit/` | consumer-3 | Delete copy; install via CLI/manifest only |

## Implications for next phases

1. **`f0-spec-camadas`** - encode the L0 list above; mark stack rules as L1/L2; L3 = basename not in registry.
2. **`f1-manifest`** - every project needs `agent-kit.json` with version + packs + protected L3 paths.
3. **`f2-kill-folder-copy`** - **done** as install contract ([bootstrap.md](bootstrap.md)); fleet nested copies removed in `f4-migrar-frota`.
4. **Migration runbook** - **documented** in [migrate-consumer.md](migrate-consumer.md) as generic process for any project; applied to development fleet.
5. **Staging-first** - fleet still split homolog/staging; migration is part of dogfood, not a separate product.

## How to refresh

Re-run a directory scan over the same workspace list: count `.cursor/{rules,commands,skills,hooks,agents}`, detect `agent-kit/` and whether `node_modules`/`packages` exist, diff basenames against SoT `.cursor/`. Update this file and the date in the intro.
