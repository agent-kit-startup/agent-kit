# Cursor 3.0 Features - How Agent Kit Uses Them

Agent Kit helps develop without losing context and uses native Cursor features as **complement**, not replacement.

## Agent Kit Position

File-based handoff (`.cursor/HANDOFF.md`) is the **source of truth** for continuity. No IDE guarantees infinite memory; context limits are real, and new sessions start from zero. That's why Agent Kit maintains state on disk: structured plans, progress, and suggested routines.

## Native features and how to use them

| Feature | What it does | How Agent Kit uses it |
|---------|-----------|----------------------|
| `/resume` | Resume previous conversation | Complement to HANDOFF - good for quick reference, doesn't replace file state |
| Summaries | Automatic summary of long sessions | Useful for revisiting decisions; handoff remains mandatory |
| Transcripts / @mentions | Search in previous chats | Cross-reference; doesn't replace plan with todos |
| Agents Window | Multiple agents in parallel | Each agent reads HANDOFF before acting; shared state is in file |
| `/worktree` | Isolated git worktree | For risky changes without dirtying the working tree |
| `/best-of-n` | Compare approaches side by side | For architecture decisions |
| Plans | Native Cursor plans | Agent Kit generates plans with todos in frontmatter; HANDOFF references active plan |

## MCP, hooks and SDK

**Agent gateways parallel to Cursor are not part of the Agent Kit stack** - we don't document or version config for that.

For extensions and automation, use what Cursor itself offers:

- **MCP** - servers supported by Cursor (ex.: official integrations or documented in ecosystem; in IDE, prefer what comes enabled or project `mcp.json` for stable tools).
- **Hooks** - agent events in workspace (see `create-hook` skill in your Cursor installation, if applicable).
- **`@cursor/sdk`** - agents and flows outside IDE when it makes sense (see SDK documentation).

This maintains a single source of truth for agent tools and avoids duplicating session control outside the native model.

## Practical rule

1. **Plan each task for ~50% of window** - leaves space for execution + handoff
2. **After each task**: record HANDOFF, update todos, suggest git staging
3. **New conversation**: `/continue-plan` reads HANDOFF and resumes
4. **Parallel agents**: each one reads HANDOFF before starting

## What NOT to trust

- **Infinite memory in same thread** - doesn't exist
- **Other agent knowing what you did** - contexts are separate
- **Automatic continuity between sessions** - summaries help but don't guarantee
- **`/resume` as handoff replacement** - good for remembering, not for resuming complex work
