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

## Token contrast: `--text-muted`

`--text-muted` must reach at least 4.5:1 (WCAG AA, normal text) against every
surface a skin defines: `--bg-primary`, `--bg-secondary`, `--bg-card` and
`--bg-card-hover`. Hover is the lightest surface in both skins, so it sets the
floor.

| Skin (`data-dashboard-skin`) | `--text-muted` | bg-primary | bg-secondary | bg-card | bg-card-hover |
|------------------------------|----------------|-----------:|-------------:|--------:|--------------:|
| `bare-metal` (default) | `#8b8b8b` | 5.41 | 5.21 | 5.00 | 4.56 |
| `legacy` | `#7f93a8` | 6.11 | 5.73 | 5.38 | 4.96 |

Semantic tints (`--yellow-bg` and the other `--*-bg` tokens, 12% over a bg-*
surface) are not in the table: `--text-muted` drops below 4.5:1 on them, so text
on a tinted surface uses `--text-secondary` or the tint's own color.

The `legacy` value is the same `#7f93a8` the landing uses (chosen there for the
marketing gradient), so the dashboard and the landing no longer diverge. The
trade-off is that `legacy` muted and secondary (`#8899aa`) text are now close
(1.08:1 between them); landing parity was preferred over a wider step. The
`bare-metal` value stays a neutral gray with a clear step below `--text-secondary`
(`#a0a0a0`, 1.30:1). Downstream hosts take these tokens from
[`contracts/mission-control-skins.json`](contracts/mission-control-skins.json) and must keep the same
values; redo the contrast math against every surface before moving either value.

## Update the remote DS

To keep the remote DS current after a token or component change:

1. Extract the relevant section from the source file (`awk` or copy).
2. Open the Claude Design project and update the affected page.
3. Record the sync in a commit message or CHANGELOG entry.

Do not treat the remote DS as ground truth; always compare against the repo.

## References

- [Landing page runbook](agentkit-landing.md)
- Landing Claude Design / `/design` paste template: `.cursor/context/landing-missionkit/CLAUDE-DESIGN-TEMPLATE.md` (factory private; plain path)
- Landing source-of-record decision: `.cursor/memory/decisions/2026-08-05_landing-external-design-source-of-record.md` (factory private; not a markdown link, so public sync does not emit a dead URL)
- Transport closeout monitor: `.cursor/memory/plan-monitor-design-system-transport-claude-design.md` (factory private; plain path, not a link)
