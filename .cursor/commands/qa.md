---
name: qa
description: Test a release, reproduce a bug, and verify CHANGELOG claims against install journey, tests, and hygiene.
---

# Command: /qa

## Goal

Test a **release**, **reproduce a bug**, or check that CHANGELOG feat/fix/chore claims work (install journey included). Consumers get this slash with L0. Playbook: [qa skill](../skills/core/qa/SKILL.md). HITL: [hitl-gates](../skills/core/hitl-gates/SKILL.md). ADR: `2026-09-16_qa-l0-slash-no-new-agent.md`.

## Hard stops (kit failure if skipped)

1. **No new L0 agent.** Do not add `qa-engineer.md`. `test-suites` stays L1 pack `quality`; Task-dispatch it when present, else run `readiness.json` / profile `testCommands` in-session.
2. **One checkout per run.** Refuse to implement or install into a second repo. Ask before leaving the invocation root.
3. **Report, do not silent-fix.** Pass/fail with evidence. Residuals go through `/backlog-add`. Never invent Field Report cards for `/qa`.
4. **Not** `/plan-external-review` or `/plan-review-triage` (plan audits) and **not** `/dogfood` (inbox).
5. **Never `/git-prod`.** Never commit secrets. Landing stamp is factory-only (`HOSTINGER_API_TOKEN`).

## Ask labels

| Gate | Labels |
|------|--------|
| Mode (when ambiguous) | `QA this release` / `Repro this bug` / `Claims only` / `Cancel` |
| Scratch install | `Use a scratch git repo` / `QA this checkout only` / `Cancel` |

Numbered-list fallback is **path 1** when Ask questions is missing. Skipped or cancelled means stop.

## Procedure

1. Broad Intake (Plans = index + HANDOFF only). Ask for missing version, symptom, or checkout.
2. Build the claim matrix from CHANGELOG (public feat/fix/chore; factory private Changed when this is the factory). Docs are indicative.
3. Run the journey and tests the case needs. Hygiene-strip the report.
4. Return pass/fail with evidence. Enqueue residuals via `/backlog-add`. Stop.
