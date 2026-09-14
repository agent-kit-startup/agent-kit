---
name: tips
description: Reference for Cursor native commands (worktree, best-of-n) and how Agent Kit relates to them.
---

# Tips: Cursor native commands (3.0+)

## `/worktree`

**Native** Cursor command for working in an isolated **git worktree** (a copy of the repo in another directory, same repository). Useful for experiments or staging without blocking the branch you are editing on. No custom command is needed in Agent Kit.

## `/best-of-n`

**Native** command to generate and **compare in parallel** several responses (models or attempts) for the same task. Use it when picking the right solution is critical. Also does not require implementation in the repository.

## Projects (beta, 2026-09-10)

**Native** Cursor feature: a cloud-hosted **coordinator agent** for work that outlives a single chat (a feature, a migration, a full app). The coordinator plans and delegates to implementing agents, keeps a set of project files synced across cloud and local machines, and can be told to watch a Slack channel, run on a schedule, or follow all your PRs. No custom command is needed in Agent Kit; nothing in the kit reads from or writes to a Project.

**When to reach for it vs `/run-plan`:** Projects is long-lived, event-driven, and Cursor-cloud-native — reach for it when you want recurring or unattended work (a migration worked through PR by PR, CI fixes on your open PRs, a Slack-triggered fix) that should keep going without you starting a new chat each time. `/run-plan` stays the kit's own bounded, one-to-do-per-tick loop over a Markdown plan, gated by HITL Ask questions and never auto-promoting to production. The two do not compose today: per ADR `2026-09-12_cursor-projects-thin-adapter.md`, `.cursor/HANDOFF.md` and plan frontmatter stay the continuity source of truth regardless of which tool you use, and the kit's plan-loop `--backend` values (`cursor-agent`, `claude`) do not grow a third value for Projects. See `docs/research/cursor-projects-study.md` for what is and isn't documented yet.

## Relation to `/continue-plan`

File-based handoff (`.cursor/HANDOFF.md`) still applies; `/worktree`, `/best-of-n`, and Projects are **IDE tools**, not substitutes for the Context Pack.
