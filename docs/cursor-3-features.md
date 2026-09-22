# Cursor Native Features - How Mission Kit Uses Them

Mission Kit helps develop without losing context and uses native Cursor features as **complement**, not replacement. Install and CLI identifiers stay Agent Kit (`agent-kit`, `@dadado/agent-kit-cli`).

## Mission Kit position

File-based handoff (`.cursor/HANDOFF.md`) is the **source of truth** for continuity. No IDE guarantees infinite memory; context limits are real, and new sessions start from zero. That's why Mission Kit maintains state on disk: structured plans, progress, and suggested routines.

## Native features and how to use them

| Feature | What it does | How Mission Kit uses it |
|---------|-----------|----------------------|
| `/resume` | Resume previous conversation | Complement to HANDOFF - good for quick reference, doesn't replace file state |
| Summaries | Automatic summary of long sessions | Useful for revisiting decisions; handoff remains mandatory |
| Transcripts / @mentions | Search in previous chats | Cross-reference; doesn't replace plan with todos |
| Agents Window | Multiple agents in parallel | Each agent reads HANDOFF before acting; shared state is in file |
| `/worktree` | Isolated git worktree | For risky changes without dirtying the working tree |
| `/best-of-n` | Compare approaches side by side | For architecture decisions |
| Plans (Plan Mode) | Native Cursor plans in the host UI | Kit `.cursor/plans/*.plan.md` stay SoT for Gate A/B. Host Plan Mode does not replace those gates. If a native plan already exists, copy it into `.cursor/plans/` then run Gate A (ADR `2026-09-15_kit-plans-sot-over-host-plan-mode.md`). HANDOFF names the active kit plan. |
| Projects (beta, 2026-09-10) | Cloud-hosted coordinator agent that plans and delegates to implementing subagents, keeps synced project files across cloud/local machines, and can watch a Slack channel, run on a schedule, or follow PRs | No kit integration; Cursor-native surface the operator may use directly. ADR `2026-09-12_cursor-projects-thin-adapter.md`: no structural change. HANDOFF/plans stay the continuity SoT, `BackendId` stays `cursor-agent`/`claude` only, Mission Control stays local-only/copy-only, hooks stay thin adapters. See [`docs/research/cursor-projects-study.md`](research/cursor-projects-study.md). |
| Custom modes | Pin a skill as an always-on chat mode | Cursor-native. Kit `agentPersona` stays chat chrome only. |
| `/goal` | Long-lived native objective until complete | Does not replace kit plan to-dos, Gate A/B, or `/run-plan`. |
| `/loop` | Recurring native check-ins | Distinct from kit `/run-plan` ticks. No kit `/loop` slash. |
| Steering | Follow-up waits for the next tool call (Send now / double Enter) | IDE input UX. No kit hook. |
| Origin | Origin Code Hosting / Origin Repos: Bring your GitHub repos, Pull requests, Agents in every repo, App extensions for Cursor repos. Includes start from scratch, without a repo; turn it into a real repo, whenever you want; a live preview, right in the browser; and publish your work | Not the kit git spine (`/git-staging` → staging → `/git-prod`). |
| Self-hosted machines | My Machines, team pools, dynamic pool scheduling, run on your sandboxes, computer use on Linux and Mac | Operator infra. Cloud Agents stay the opt-in audits reviewer only. |
| Subagents on their own machines | Isolated cloud VMs per subagent | Cursor cloud. Kit Task stays local IDE. |
| Automations | Desktop scheduled-agent UI (Cloud Agent subscriptions: PR / Slack thread / schedule) | Cursor-cloud automation. Kit scheduling withdrawn. |

## MCP, hooks and SDK

**Agent gateways parallel to Cursor are not part of the Mission Kit stack** - we don't document or version config for that.

For extensions and automation, use what Cursor itself offers:

- **MCP** - servers supported by Cursor (ex.: official integrations or documented in ecosystem; in IDE, prefer what comes enabled or project `mcp.json` for stable tools).
- **Hooks** - agent events in workspace (see `create-hook` skill in your Cursor installation, if applicable).
- **Cursor Cloud Agents / `@cursor/sdk`** - agents and flows outside the IDE. Cloud Agents and Cursor Harness improvements (subscriptions, custom modes, `/goal`, steering) stay Cursor-native. The kit uses Cloud Agents in exactly **one** place: the opt-in `externalPlanReview.backend: "cloud"` audits reviewer, driven over the Cloud Agents REST API (`https://api.cursor.com`) so the kit keeps zero runtime dependencies. See [`external-plan-review.md`](external-plan-review.md#cloud-agents-backend-backend-cloud) and ADR `2026-08-14_cursor-cloud-agents-sdk-audits-backend.md`.
  - The SDK itself (`@cursor/sdk`, Node 22.13+; `cursor-sdk` for Python) is **not** a kit dependency. Scripting it directly outside the kit is supported and documented, not a gap: `Agent.prompt` (one-shot), `Agent.create` + `agent.send` (durable/stream), `Agent.resume` (re-attach by `bc-` id). Always set `local` or `cloud` explicitly.
  - `CURSOR_API_KEY` is a secret: environment or gitignored `.env` only, empty placeholder in `.env.example`, never committed or logged.
  - Kit-load (`CLAUDE.md` / `/agent-kit`), audits, and `agent-kit run-plan --backend` stay three separate surfaces. Cloud Agents are not a plan-loop tick backend.

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
