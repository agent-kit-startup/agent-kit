# Comms channel map and cadence

Inventory of where Mission Kit may be talked about, with priority, effort, posting policy, and HITL depth. Cadence is inspired by public recap/release cycles (weekly shipped notes, release-tied longer posts). Do not copy another project's brand, assets, or claims.

Related: [comms hub](comms.md), naming ADR `2026-08-06_mission-kit-vs-agent-kit-naming`, HITL ADR `2026-07-09_framework-hitl-positioning`, claim matrix [five-layer-claim-matrix.md](five-layer-claim-matrix.md).

## Dual-name (locked)

| Use | Name |
|-----|------|
| Product / marketing / site | Mission Kit / MissionKit / missionkit.io |
| CLI, npm, slash, manifest, pack | Agent Kit / `agent-kit` / `@dadado/agent-kit-cli` |
| Local dashboard | Mission Control |

Do not market unchecked full autonomy. Staging may be automatic; production (`/git-prod`) stays a human confirmation.

## Channel map

| Channel | Priority | Effort | Disposition | Policy | HITL depth |
|---------|----------|--------|-------------|--------|------------|
| missionkit.io / blog-equivalent | High | Med | **include** | Product voice; dual-name; claims match the current release's shipped docs | Ask before any public publish |
| Copy-paste social (X / Twitter) | High | Low | **include** | Short; no autonomy-first slogans; link site + public GitHub | Ask before an authored post or reply; release mirror per below |
| Medium | Med | Med | **include** | Same claims as [public-launch-announcement.md](public-launch-announcement.md) and getting-started | Ask before publish |
| Newsletter / Substack | Med | High | **include** | Digest of recaps and releases only; no unshipped features | Ask before send |
| Hacker News | Med | Low | **include** | Operator's personal account only, no brand account. Occasional Show HN or comment on a real release; no daily spam; never mirrored or automated | Ask before submit or reply |
| GitHub Issues / PR discussion | High | Low | **include** | Contributor funnel, not ads. Align with CoC and SUPPORT | Ask before maintainer reply that is promotional; routine triage is existing maintainer HITL |
| GitHub Discussions | High | Low | **include** (decided 2026-11-19; not enabled yet) | Q&A on the public repo; Discord is for chat, Issues stay for bugs. Until the operator enables it, [SUPPORT.md](../.github/SUPPORT.md) keeps saying Discussions is not enabled and issues are the support channel | Do not link or post in Discussions until the tab is enabled and verified; maintainer answers follow the GitHub Issues row |
| Slack | Low | Med | **defer** | No official Mission Kit Slack is documented in this repo | Do not create or post until an operator-owned workspace exists |
| Discord | High | Med | **include** (decided 2026-11-19; server not created yet) | One operator-owned Mission Kit server, English primary with a `pt-br` channel, no Oligarchy category. Chat and show-and-tell; Q&A points to GitHub Discussions | Release mirror after `/kit-prod` Done (see below); every authored post or reply: Ask. No invite link is published until the server exists and the URL is verified |
| Cursor Marketplace listing | - | - | **never** (this loop) | Distribution channel owned by `submit-cursor-marketplace` (publisher HITL; public manifest **5.2.0**) | Reference only; no submit from a comms plan |

**Never:** paid ads as the first delivery; scraping PII into recaps; silent cross-network posting; renaming npm/CLI/slash to Mission Kit; overloading Agent Personas as the poster.

## Release mirror (decided 2026-11-19, not built yet)

A release that is already public (a GitHub Release, a closed `CHANGELOG.md` version live on npm and on missionkit.io) is posted to every network that has a supported native posting API, without a per-post Ask: the operator's `/kit-prod` production confirmation for that version is the recorded HITL decision. The mirror uses the [release template](comms-templates/release.md) only and adds no claim the release does not make. Hacker News is never mirrored. Every authored post or reply (recap, contributor ask, launch copy, answer) keeps the per-post Ask.

The mirror runs locally as a factory-only step after `/kit-prod` Done, with tokens from the operator's untracked `.env`; never in CI. A step after Done never gates Done, never reopens it and never authorizes another tag; a failed network is a follow-up fixed outside the release. The mirror script (`.cursor/scripts/release-mirror.mjs`) exists with every network gated; no network has a posting client yet, so nothing in this tree posts. Flow and env names: [comms-publish-pipeline.md](comms-publish-pipeline.md). Record: ADR `2026-11-21_community-presence-discord-and-release-mirror` (Accepted 2026-11-22).

## Forge vs local memory (boundary)

GitHub Issues / PRs are **contributor visibility** (funnel, inbound triage, ship closeout). They are **not** kit session memory. HANDOFF machine fields, plans, `/run-plan` queues, HITL replies, dogfood Unprocessed, and default memory-loop WRITE stay in the checkout. Do not use milestones or GitHub Projects as a HANDOFF or queue replacement. Optional: open a hygiene-stripped issue for a durable blocker only after an explicit operator yes (never auto-file monitors or raw Gaps). GitLab issues/boards are out of scope (CI templates only). ADR: `.cursor/memory/decisions/2026-09-23_forge-surfaces-as-collab-memory.md`.

## Cadence sketch (Cartesi-style input, not brand copy)

Bind every cycle to artifacts that already exist:

| Cycle | Trigger (must be real) | Output | Channels |
|-------|------------------------|--------|----------|
| Recap | Merged CHANGELOG `[Unreleased]` items that have reached `staging`, or a dated recap of what already shipped in the current release | [recap template](comms-templates/recap.md) | X (short), Medium/newsletter (optional) |
| Release | GitHub Release / closed CHANGELOG version / missionkit.io already showing that version | [release template](comms-templates/release.md) | Site, X, HN (optional), Medium |
| Contributor-ask | Open issues or registry contribution paths that are actually ready | [contributor-ask template](comms-templates/contributor-ask.md) | GitHub, X, launch paste follow-up |

If CHANGELOG, Releases, and missionkit.io disagree, **stop and fix docs**; do not invent a feature in the recap.

Living schedule: [comms-content-calendar.md](comms-content-calendar.md).

## Constraints (comms loop)

- HITL Ask (or numbered-list fallback) before any authored public network post or reply. The only exception is the release mirror above.
- Secrets for networks never enter git. Env **names** only: [comms-publish-pipeline.md](comms-publish-pipeline.md).
- Core Pack unchanged. Skill lives under `registry/skills/community/`.
- n8n is not a factory or Core Pack dependency. Use it only if the operator already runs n8n.
- Claims: Mission Kit 5 / Agent Kit install / HITL framework. Do not claim Cursor Marketplace submit or an npm rename.
- Draft script must fail closed: it writes local drafts and refuses publish.
