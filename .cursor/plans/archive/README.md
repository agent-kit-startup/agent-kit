# Planos arquivados

Ficheiros `*.plan.md` nesta pasta são **histórico local** (fases antigas). Não devem ser commitados no remoto — estão cobertos por `.cursor/plans/**/*.plan.md` no `.gitignore`.

O plano ativo do repositório fica na **raiz** de `.cursor/plans/` (ficheiro `.plan.md` atual). Motivo: `agent-kit handoff` e agentes paralelos usam um único plano “vivo” sem sobrescrever estado entre si.
