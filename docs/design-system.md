# Design System

Agent Kit maintains a remote design system in the **Claude Design** project
*Startup Kit — Design System* (project id `4451a0e9-5258-45cd-91f7-a837bdcbde81`).
The project documents three products: Startup Kit (`auto.startupkit.com.br`),
Mission Control (the `dashboard/dashboard.html` UI), and the Agent Kit landing
page (`missionkit.io`).

## Upstream and downstream

The repo is the **source of truth**. The remote design project is a downstream
mirror — it was populated from tree-extracted sources and is updated manually
when the repo changes. If any value in the remote DS differs from the code, the
code wins.

| Surface | Upstream (repo) | What was mirrored |
|---------|-----------------|-------------------|
| Mission Control | `dashboard/dashboard.html` | Token tables, skin variables, component classes |
| Landing page | `.cursor/context/landing-missionkit/remote/` | CSS, component markup, production PNGs |
| Startup Kit marketing site | off-repo CSS tree (local design export; not tracked here) | Tokens, painel CSS, component markup |

## Token divergence: `--text-muted`

`dashboard/dashboard.html` sets `--text-muted: #6d8094`.
The landing sets `--text-muted: #7f93a8`.
The difference is intentional: the landing value was chosen to meet the AA
contrast ratio over the marketing gradient. Do not unify these tokens without
redoing the contrast math. See the comment beside the token in `dashboard.html`
and residual D in the transport monitor.

## Update the remote DS

To keep the remote DS current after a token or component change:

1. Extract the relevant section from the source file (`awk` or copy).
2. Open the Claude Design project and update the affected page.
3. Record the sync in a commit message or CHANGELOG entry.

Do not treat the remote DS as ground truth; always compare against the repo.

## References

- [Landing page runbook](agentkit-landing.md)
- Landing source-of-record decision: `.cursor/memory/decisions/2026-08-05_landing-external-design-source-of-record.md` (factory private; not a markdown link, so public sync does not emit a dead URL)
- Transport closeout monitor: `.cursor/memory/plan-monitor-design-system-transport-claude-design.md` (factory private; plain path, not a link)
