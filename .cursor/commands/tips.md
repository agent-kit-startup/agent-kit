# Tips: Cursor native commands (3.0+)

## `/worktree`

**Native** Cursor command for working in an isolated **git worktree** (a copy of the repo in another directory, same repository). Useful for experiments or staging without blocking the branch you are editing on. No custom command is needed in Agent Kit.

## `/best-of-n`

**Native** command to generate and **compare in parallel** several responses (models or attempts) for the same task. Use it when picking the right solution is critical. Also does not require implementation in the repository.

## Relation to `/continue-plan`

File-based handoff (`.cursor/HANDOFF.md`) still applies; `/worktree` and `/best-of-n` are **IDE tools**, not substitutes for the Context Pack.
