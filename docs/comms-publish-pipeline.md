# Comms draft → HITL → publish pipeline

Kit-native first: community skill `mission-kit-comms`, agent `.cursor/agents/mission-kit-comms.md`, Ask questions (numbered-list fallback), optional local draft script. **n8n is not wired** and is not a Core Pack or factory dependency.

Nothing in this pipeline performs an HTTP post to X, Discord, Slack, Medium, Substack, or HN.

## Flow

```text
CHANGELOG / Release / calendar row
  → draft (agent or comms-draft.mjs)
  → operator Ask: Post / Edit / Discard
  → only the human publishes on the network
```

Fail closed: if Ask is skipped, do not publish. The script's `--publish` flag exits non-zero on purpose.

## Draft script

```bash
node .cursor/scripts/comms-draft.mjs --kind recap --channel x
node .cursor/scripts/comms-draft.mjs --kind release --channel medium --version 5.0.0
node .cursor/scripts/comms-draft.mjs --kind contributor-ask --channel github
```

Writes under `.cursor/comms-drafts/` (gitignored). Idempotent: same kind+channel+UTC day reuses the file unless `--force-new`. `--publish` always refuses.

Tests: `node --test .cursor/scripts/comms-draft.test.mjs`.

## Env contract (names only)

Do **not** create a committed `.env` file (`.env` and `.env.*` are gitignored). Document names here. Live values stay in the operator's local `.env` (untracked).

| Name | Used for | Required to draft? | Required to post? |
|------|----------|--------------------|-------------------|
| `MISSION_KIT_COMMS_X_BEARER` | X API (operator tools only) | no | yes, if the human uses an API client |
| `MISSION_KIT_COMMS_DISCORD_WEBHOOK` | Discord webhook | no | yes, if used |
| `MISSION_KIT_COMMS_SLACK_WEBHOOK` | Slack webhook | no | yes, if used |
| `MISSION_KIT_COMMS_MEDIUM_TOKEN` | Medium | no | yes, if used |
| `MISSION_KIT_COMMS_SUBSTACK_SESSION` | Substack | no | yes, if used |

The draft script must not print env values. Webhooks that post without a recorded HITL decision are forbidden.

## Rate limits and idempotency

- One public post per calendar row per channel unless the operator explicitly asks to retry.
- Draft ids: `{kind}-{channel}-{YYYY-MM-DD}`.
- Recaps must not duplicate the previous day's file without `--force-new`.

## GitHub Action

No workflow in this repo posts comms. A `workflow_dispatch` that published would still need a human click; even that is deferred so secrets never sit on CI for social posts.
