# Planos arquivados

Ficheiros `*.plan.md` nesta pasta são **histórico local** (fases antigas). Não devem ser commitados no remoto — estão cobertos por `.cursor/plans/**/*.plan.md` no `.gitignore`.

O plano ativo do repositório fica na **raiz** de `.cursor/plans/` (ficheiro `.plan.md` atual). Motivo: `agent-kit handoff` e agentes paralelos usam um único plano “vivo” sem sobrescrever estado entre si.

## A1 dispositions (2026-10-01)

Archived (completed): `claude-adapters-discoverability-issue-92`, `consumer-signature-gate-hook`, `factory-experiments-off-public`, `hotfix-landing-precompile-dc-logic`, `run-plan-all-defer-operator-gates`, `ultracode-factory-consolidation-2026-09-28`.

Closed + archived: `ci-self-hosted-runner` (billing resolved; attempt 2 green, CI running since).

Not archived: `claude-guard-pretooluse-2026-09-27` — park/note until p6 moves to roadmap n1 (p6-headless-smoke-hitl + p7 still pending).
