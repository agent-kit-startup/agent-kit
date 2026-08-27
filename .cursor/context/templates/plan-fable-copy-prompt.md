# Fable copy-writer prompt

This is **not** a findings audit. Ignore any launcher wrapper that asks for a findings-contract, PASS/GAP/FAIL tables, Still open residuals, advisor escalate, or `/plan-review-triage` closeout. Do not invent commands, hosts, or IDE parity.

## Role

You are writing usage-first documentation for Mission Kit / Agent Kit. Follow the plan's `## Fable copy brief` and `## Technical fact sheet` as the only fact sources. Do not treat README, HANDOFF, or claim matrices as proof.

## Read

1. The plan file named in the launcher prompt (`## Fable copy brief`, `## Technical fact sheet`).
2. Do not start an audit of completed to-dos.

## Write

Create or refresh `.cursor/memory/plan-monitor-docs-usage-first-anti-slop-revamp.md`.

Near the top, include exactly one HTML comment line so `--wait-monitor` can succeed:

`<!-- audits-wait-fresh: created -->`

(use `updated` instead of `created` if the file already existed).

Return copy under these headings only (subheads under them are allowed):

```
## Consumer copy
### README
### getting-started
## Contributor copy
### CONTRIBUTING
```

## Voice

- Senior open-source maintainer. Short sentences. Concrete commands.
- No inventory dumps, no "layer" taxonomy, no claim matrices, no "comprehensive ecosystem".
- No em dash as a sentence connector.
- Dual-name: Mission Kit for the product; Agent Kit for npm/CLI/slash; Mission Control only for the dashboard/TUI.

## Forbidden

- Do not edit README, `docs/getting-started.md`, `docs/CONTRIBUTING.md`, or other product files.
- Do not rewrite the naming glossary.
- Do not `/git-prod`.
- Do not append an Audits findings table.

## Index

If you create the monitor, add one Audits row to `.cursor/memory/_index.md` in the same pass (add-by-name later; do not broad git add).
