# Comms draft → HITL → publish pipeline

Kit-native first: community skill `mission-kit-comms`, agent `.cursor/agents/mission-kit-comms.md`, Ask questions (numbered-list fallback), optional local draft script. **n8n is not wired** and is not a Core Pack or factory dependency.

Nothing in this pipeline performs an HTTP post to X, Discord, Slack, Medium, Substack, or HN today. The release mirror below exists as a dry-run script with every network gated: no network has a posting client yet.

## Flow

```text
CHANGELOG / Release / calendar row
  → draft (agent or comms-draft.mjs)
  → operator Ask: Post / Edit / Discard
  → only the human publishes on the network
```

Fail closed: if Ask is skipped, do not publish. The script's `--publish` flag exits non-zero on purpose.

## Release mirror (decided 2026-11-19; script landed 2026-11-22, every network gated)

```text
/kit-prod Done for version X (operator production confirmation)
  → local post-Done step (factory-only, never CI)
  → release template for X from the closed CHANGELOG section
  → one native API client per network, dry-run by default
  → one evidence line per network
```

- Only a release already live on npm and missionkit.io, and only the [release template](comms-templates/release.md). Authored posts keep the Ask flow above.
- One client per network on its native API; no third-party scheduler. Hacker News is excluded.
- Idempotent per version and network; never prints a token; tokens come from the operator's untracked `.env` by the names in the env contract below, one secret per network (public identifiers such as a handle or an instance URL live in the script's network row, not in `.env`).
- A step after Done never gates Done, never reopens it and never authorizes another tag. A failed or pending network is recorded as one follow-up line per network in the release's HANDOFF record (network, evidence, next step), with no automatic retry beyond the idempotent re-run, and is fixed outside the release. The fail-closed Done and post-prod rows of `/kit-prod` are unchanged.
- Discord receives the release from the GitHub Release webhooks into `#releases` ([automation](community/discord-server.md#automation-zero-hosting)), not from the script; those webhooks count as the release mirror, limited to Release events.

```bash
node .cursor/scripts/release-mirror.mjs --version X.Y.Z            # dry run: one line per network
node .cursor/scripts/release-mirror.mjs --version X.Y.Z --apply --done-evidence "<the /kit-prod Done line>"
```

The script refuses a version without a closed `CHANGELOG.md` section, renders only the two blocks of the release template (English, Short), keeps a ledger under `.cursor/comms-drafts/mirror/` (gitignored) so a re-run skips networks already posted, and prints `gated: <reason>` for a network whose client does not exist yet. A client is added to a network row only after that network's gate in [comms-presence.md](comms-presence.md) "Release mirror candidates" (spend Ask, app approval, account, instance). `/kit-prod` section 6 runs it after Done. Tests: `node --test .cursor/scripts/release-mirror.test.mjs` (no network).

Record: ADR `2026-11-21_community-presence-discord-and-release-mirror` (Accepted 2026-11-22, amended for the rename). Channel dispositions: [comms-channel-map.md](comms-channel-map.md).

## Draft script

```bash
node .cursor/scripts/comms-draft.mjs --kind recap --channel x
node .cursor/scripts/comms-draft.mjs --kind release --channel medium --version 5.0.0
node .cursor/scripts/comms-draft.mjs --kind contributor-ask --channel github
```

Writes under `.cursor/comms-drafts/` (gitignored). Idempotent: same kind+channel+UTC day reuses the file unless `--force-new`. `--publish` always refuses.

Tests: `node --test .cursor/scripts/comms-draft.test.mjs`.

## Discord provisioning script

```bash
node .cursor/scripts/discord-provision.mjs                      # plan against an empty server, no network
node .cursor/scripts/discord-provision.mjs --guild <id>         # read the live server (GET only) and plan
node .cursor/scripts/discord-provision.mjs --guild <id> --apply --ask-provenance "<recorded operator decision>"
```

Reads the machine-readable block of [community/discord-server.md](community/discord-server.md) and converges the server to it: roles, categories, channels, permission overwrites, server settings, AutoMod rules and pinned messages. Dry-run by default; `--apply` refuses without the token, the server id and the recorded apply decision. Re-running after an apply plans zero changes. Pins with an unresolved placeholder (`--var discussionsUrl=...`) are skipped. Community, onboarding and the banner print as operator steps. The token is never printed. Tests: `node --test .cursor/scripts/discord-provision.test.mjs` (no network).

## Profile kits

```bash
node .cursor/scripts/presence-kits.mjs                 # every network and name
node .cursor/scripts/presence-kits.mjs --network mastodon
node .cursor/scripts/presence-kits.mjs --check         # validate only
```

Generates one paste-ready profile kit per network and name (handle candidates in order, display name, bio, links, avatar and banner sources) from [community/presence-source.json](community/presence-source.json), under `.cursor/comms-drafts/presence/` (gitignored). The operator pastes them while creating each account and records the live URL in [comms-presence.md](comms-presence.md). Field limits are applied only where an official page states them; elsewhere the kit shows both bios and says the limit is not verified. It never truncates a bio and never calls a network. The names are Mission Kit, Outpost and Oligarchy (Colony renamed Outpost, 2026-11-21); the Outpost links and avatar still point at `colony.missionkit.io` and `agent-kit-startup/colony`, which resolve today, until plan `missionkit-rename-2026-11-22` moves them. Tests: `node --test .cursor/scripts/presence-kits.test.mjs`.

## Env contract (names only)

Do **not** create a committed `.env` file (`.env` and `.env.*` are gitignored). Document names here. Live values stay in the operator's local `.env` (untracked).

| Name | Used for | Required to draft? | Required to post? |
|------|----------|--------------------|-------------------|
| `MISSION_KIT_COMMS_X_BEARER` | X API: operator tools, and the release mirror once the X client exists (after the spend Ask) | no | yes, if the human uses an API client; mirror: yes |
| `MISSION_KIT_COMMS_BLUESKY_APP_PASSWORD` | Release mirror, Bluesky app password (client after the account exists) | no | mirror: yes |
| `MISSION_KIT_COMMS_MASTODON_TOKEN` | Release mirror, own instance (client after the instance exists; deferred) | no | mirror: yes |
| `MISSION_KIT_COMMS_THREADS_TOKEN` | Release mirror, Threads (client after App Review) | no | mirror: yes |
| `MISSION_KIT_COMMS_LINKEDIN_TOKEN` | Release mirror, LinkedIn page (client after the Community Management approval) | no | mirror: yes |
| `MISSION_KIT_COMMS_TELEGRAM_BOT_TOKEN` | Release mirror, Telegram channel (Tier 3 hold) | no | mirror: yes |
| `MISSION_KIT_COMMS_MATRIX_TOKEN` | Release mirror, Matrix room (Tier 3 hold) | no | mirror: yes |
| `MISSION_KIT_COMMS_DISCORD_WEBHOOK` | Discord webhook | no | yes, if used |
| `MISSION_KIT_DISCORD_BOT_TOKEN` | Discord bot token for [server provisioning](community/discord-server.md) (`discord-provision.mjs`); posts only the spec's pinned messages, after the apply Ask | no | yes, to apply |
| `MISSION_KIT_DISCORD_GUILD_ID` | Discord server id (not a secret; kept beside the token) | no | yes, to apply |
| `MISSION_KIT_COMMS_SLACK_WEBHOOK` | Slack webhook | no | yes, if used |
| `MISSION_KIT_COMMS_MEDIUM_TOKEN` | Medium | no | yes, if used |
| `MISSION_KIT_COMMS_SUBSTACK_SESSION` | Substack | no | yes, if used |
| `MISSION_KIT_GROK_API_KEY` | xAI API for the [Grok community manager bot](grok-community-manager.md) (triage/drafting only) | yes, for that bot | no |

The draft script must not print env values. Webhooks that post without a recorded HITL decision are forbidden. For the release mirror only, the recorded decision is the `/kit-prod` production confirmation of that version; no other webhook, bot or client posts without a per-post Ask.

## Rate limits and idempotency

- One public post per calendar row per channel unless the operator explicitly asks to retry.
- Draft ids: `{kind}-{channel}-{YYYY-MM-DD}`.
- Recaps must not duplicate the previous day's file without `--force-new`.

## GitHub Action

No workflow in this repo posts comms. A `workflow_dispatch` that published would still need a human click; even that is deferred so secrets never sit on CI for social posts.
