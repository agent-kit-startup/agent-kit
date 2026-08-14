# Five-layer claim matrix (public)

Public storefront summary of how **Mission Kit** / **Agent Kit** maps to a five-layer production-agent lens (marketing name vs technical install identifiers; see naming ADR `2026-08-06_mission-kit-vs-agent-kit-naming`). Documentation alone is not proof of behavior. The private factory keeps a fuller evidence ledger under `docs/evidence/` (sync-denied); this page cites only paths that ship on the public lane.

Classification: **shipped core** (L0), **optional pack** (L1/L2), **planned**, **unsupported**.

## Layer summary

| Layer | What ships in core | Explicit non-claim |
|-------|--------------------|--------------------|
| Prompt + HITL | Plan gates, Ask questions, `/git-prod` confirmation | Not full autonomy without review |
| Context + memory | HANDOFF, hooks, memory loop, personas (chrome only) | Not a hosted control plane or cloud HANDOFF sync |
| Safeguards | Staging-first git, shell/secrets hooks, output hygiene | Not a guarantee that every install is production-ready |
| Iterative review | Opt-in external monitor, triage, Field Report cadence | Not autonomous model self-improvement |
| Workflow coordination | `/run-plan`, `/run-plan-all`, headless CLI, local Mission Control | Not a general graph / DAG engine |

## Claim anchors (public paths)

| Layer | Representative claims | Class | Public evidence |
|-------|----------------------|-------|-----------------|
| Prompt + HITL | Broad Intake + Gate A/B; Ask questions; prod promote HITL; backlog CRUD confirms | shipped core | `.cursor/commands/start-project.md`, `.cursor/rules/hitl-ask-questions.mdc`, `.cursor/commands/git-prod.md`, backlog commands |
| Context + memory | HANDOFF resume; Context Guardian hooks; memory loop; personas chrome-only | shipped core | `.cursor/rules/cursor-plan-handoff.mdc`, `.cursor/hooks.json`, `.cursor/rules/memory-loop.mdc`, `docs/personas-contract.md` |
| Safeguards | Staging-first hooks; shell/secrets guards; output hygiene | shipped core | `git-hooks/pre-commit`, `git-hooks/pre-push`, `.cursor/hooks.json`, `.cursor/rules/agent-output-hygiene.mdc` |
| Iterative review | Opt-in external plan review; findings-only default; durable audits | shipped core | `docs/external-plan-review.md`, `.cursor/scripts/plan-external-review.sh`, `.cursor/commands/plan-review-triage.md` |
| Workflow | Manual vs continuous run; multi-plan queue; headless runner; local Mission Control | shipped core | `.cursor/commands/run-plan.md`, `.cursor/commands/run-plan-all.md`, `scripts/plan-loop.sh`, `dashboard/` |
| Optional packs | Domain / stack packs beyond L0 | optional pack | `docs/domain-packs.md`, `docs/layers-spec.md` |
| Marketplace | Cursor Marketplace plugin submission | planned | Release-gate / parked submission checklist (not claimed shipped) |

## Explicit unsupported list

1. Autonomous model self-improvement or self-training.
2. General graph / DAG execution engine.
3. Hosted multi-tenant control plane or cloud HANDOFF sync.
4. Guaranteed production readiness without lane-qualified release evidence.
5. Silent auto-remediation of product code from external review when `autoRemediate` is false (default).
6. Silent cross-network social posting (adoption comms draft with HITL only; community skill `mission-kit-comms`).

## Lane note

Released consumer lane (npm / public GitHub) is version-qualified separately from private staging. Pin or check `@dadado/agent-kit-cli` when you need a reproducible floor. See [getting started](getting-started.md), [layers](layers-spec.md), and [external plan review](external-plan-review.md).
