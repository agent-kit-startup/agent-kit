# Grok community manager bot

Operator-run community manager for Mission Kit channels, powered by **Grok (xAI API)**. It monitors, triages, and drafts; a human publishes. Same contract as the rest of the comms tree: **nothing posts to a public network without a recorded HITL yes**.

Related: [comms hub](comms.md), [channel map](comms-channel-map.md), [calendar](comms-content-calendar.md), [publish pipeline](comms-publish-pipeline.md), system prompt: [comms-templates/grok-system-prompt.md](comms-templates/grok-system-prompt.md).

## What the bot does

| Duty | Description | Autonomy |
|------|-------------|----------|
| Monitor | Watch X mentions/keywords (Mission Kit, Agent Kit, `@dadado/agent-kit-cli`, missionkit.io) via Grok Live Search or the X API; watch GitHub issues/PRs on the public repo | Autonomous (read-only) |
| Triage | Classify inbound as: support question, bug report, feature request, contributor interest, commercial inquiry, spam/off-topic | Autonomous (labels/log only) |
| Draft replies | Answer support questions grounded in shipped docs (getting-started, README, install.md); route bugs to GitHub issues; route commercial to `sales@missionkit.io` | Draft → HITL Ask → human posts |
| Draft posts | Recap / release / contributor-ask copy per the [calendar](comms-content-calendar.md) and [templates](comms-templates/recap.md) | Draft → HITL Ask → human posts |
| Report | Weekly community digest: mention volume, sentiment, top questions, open-issue movement | Autonomous (local file / DM to operator) |
| Escalate | Security reports → private path in `.github/SECURITY.md`; CoC violations → maintainer; anything ambiguous → operator | Always to a human |

**Never (hard rules, same as the comms loop):**

- No autonomous posting or replying on any network. `--publish`-style paths fail closed.
- No Discord/Slack presence until an operator-owned workspace exists ([channel map](comms-channel-map.md) says defer).
- No posting in GitHub Discussions (not enabled per `.github/SUPPORT.md`).
- No claims beyond the newest closed `CHANGELOG.md` version live on npm and missionkit.io.
- No paid ads, no Cursor Marketplace submit, no npm/CLI rename to Mission Kit.
- Secrets never enter git; env **names** only in docs.

## Channels it manages

Follows the [channel map](comms-channel-map.md) dispositions:

| Channel | Bot role | Posting |
|---------|----------|---------|
| X / Twitter | Monitor mentions and keywords; draft replies and recap/release posts | Human, after Ask |
| GitHub issues / PRs | Triage labels, draft first-response and contributor-funnel replies | Human, after Ask (routine triage may follow existing maintainer HITL) |
| Hacker News | Draft occasional release/Show HN copy only when the calendar has a real release row | Human, after Ask |
| Medium / newsletter | Fill recap/release templates | Human, after Ask |
| Discord / Slack | **Deferred** — do not create or join until an operator-owned workspace exists | — |

## Architecture

```text
X API / Grok Live Search / GitHub events
        │ (read)
        ▼
  Grok (xAI API) — system prompt: comms-templates/grok-system-prompt.md
        │ classify + draft
        ▼
  Draft queue (local files or DM to operator)  ←— fail closed here
        │ operator Ask: Post / Edit / Discard
        ▼
  Human publishes on the network
```

The bot process is operator-owned and runs outside this repo (a small script, an n8n flow **only if the operator already runs n8n**, or manual paste into Grok chat). This repo ships the contract and the prompt, not the runner.

## Configuration

### 1. xAI API

- Endpoint: `https://api.x.ai/v1` (OpenAI-compatible chat completions).
- Suggested models: a top Grok model (e.g. `grok-4`) for drafting; a mini model for high-volume triage/classification.
- Enable Live Search parameters when monitoring X mentions through the API instead of the X API directly.

### 2. Env contract (names only — values stay in the operator's untracked `.env`)

| Name | Used for | Required to draft? | Required to post? |
|------|----------|--------------------|-------------------|
| `MISSION_KIT_GROK_API_KEY` | xAI API (triage + drafting) | yes | no |
| `MISSION_KIT_COMMS_X_BEARER` | X API read (mentions) and human-driven post | no (Live Search can cover reads) | yes, if the human posts via API |
| `GITHUB_TOKEN` (fine-grained, public repo, read + issues) | Issue/PR triage | only for GitHub duty | yes, for label writes |

Same rules as the [publish pipeline](comms-publish-pipeline.md): the bot must not print env values; webhooks that post without a recorded HITL decision are forbidden.

### 3. System prompt

Paste [comms-templates/grok-system-prompt.md](comms-templates/grok-system-prompt.md) as the system message (API) or project/custom instructions (Grok chat). It encodes dual-name, claim sources, tone, HITL, per-channel checklists, and escalation.

### 4. Cadence

- **Continuous:** monitor + triage (read-only).
- **On inbound:** draft reply within the operator's SLA (suggest < 24h), queue for Ask.
- **Weekly:** recap draft only when `[Unreleased]` has merged staging work; community digest to operator.
- **On release:** release draft when a new closed CHANGELOG version + GitHub Release exist.
- One public post per calendar row per channel; draft ids `{kind}-{channel}-{YYYY-MM-DD}` (matches [publish pipeline](comms-publish-pipeline.md)).

## Escalation rules

| Signal | Route |
|--------|-------|
| Security vulnerability mention | Private reporting path in `.github/SECURITY.md`; never discuss publicly |
| Commercial/licensing question | PolyForm Noncommercial + `sales@missionkit.io` |
| CoC violation / harassment | Operator/maintainer; bot does not moderate publicly |
| Docs contradiction (CHANGELOG vs missionkit.io vs Releases) | Stop drafting; flag to operator to fix docs first |
| Anything the checklists don't cover | Operator |

## Claim check (every draft, inherited from the calendar)

- [ ] Mission Kit = product; Agent Kit = CLI/npm/slash/pack; Mission Control = dashboard
- [ ] Version/features match the newest closed `CHANGELOG.md` version live on npm and missionkit.io
- [ ] HITL / staging→prod confirmation stated; no "full autonomy" claims
- [ ] Public GitHub: `https://github.com/agent-kit-startup/agent-kit`
- [ ] No Marketplace listing claimed as done
