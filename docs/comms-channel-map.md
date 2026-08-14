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
| missionkit.io / blog-equivalent | High | Med | **include** | Product voice; dual-name; claims match 5.0.0 shipped docs | Ask before any public publish |
| Copy-paste social (X / Twitter) | High | Low | **include** | Short; no autonomy-first slogans; link site + public GitHub | Ask before post or reply |
| Medium | Med | Med | **include** | Same claims as [public-launch-announcement.md](public-launch-announcement.md) and getting-started | Ask before publish |
| Newsletter / Substack | Med | High | **include** | Digest of recaps and releases only; no unshipped features | Ask before send |
| Hacker News | Med | Low | **include** | Occasional Show HN or comment on a real release; no daily spam | Ask before submit or reply |
| GitHub Issues / PR discussion | High | Low | **include** | Contributor funnel, not ads. Align with CoC and SUPPORT | Ask before maintainer reply that is promotional; routine triage is existing maintainer HITL |
| GitHub Discussions | - | - | **never** (until enabled) | [SUPPORT.md](../.github/SUPPORT.md) states Discussions is not enabled; issues are the support channel | Do not invent a Discussions presence |
| Slack | Low | Med | **defer** | No official Mission Kit Slack is documented in this repo | Do not create or post until an operator-owned workspace exists |
| Discord | Low | Med | **defer** | Same as Slack | Same |
| Cursor Marketplace listing | - | - | **never** (this loop) | Distribution channel owned by parked `submit-cursor-marketplace` | Reference only; no submit from this plan |

**Never:** paid ads as the first delivery; scraping PII into recaps; silent cross-network posting; renaming npm/CLI/slash to Mission Kit; overloading Agent Personas as the poster.

## Cadence sketch (Cartesi-style input, not brand copy)

Bind every cycle to artifacts that already exist:

| Cycle | Trigger (must be real) | Output | Channels |
|-------|------------------------|--------|----------|
| Recap | Merged CHANGELOG `[Unreleased]` items that have reached `staging`, or a dated recap of what already shipped in 5.0.0 | [recap template](comms-templates/recap.md) | X (short), Medium/newsletter (optional) |
| Release | GitHub Release / closed CHANGELOG version / missionkit.io already showing that version | [release template](comms-templates/release.md) | Site, X, HN (optional), Medium |
| Contributor-ask | Open issues or registry contribution paths that are actually ready | [contributor-ask template](comms-templates/contributor-ask.md) | GitHub, X, launch paste follow-up |

If CHANGELOG, Releases, and missionkit.io disagree, **stop and fix docs**; do not invent a feature in the recap.

Living schedule: [comms-content-calendar.md](comms-content-calendar.md).

## Constraints (comms loop)

- HITL Ask (or numbered-list fallback) before any public network post or reply.
- Secrets for networks never enter git. Env **names** only: [comms-publish-pipeline.md](comms-publish-pipeline.md).
- Core Pack unchanged. Skill lives under `registry/skills/community/`.
- n8n is not a factory or Core Pack dependency. Use it only if the operator already runs n8n.
- Claims: Mission Kit 5 / Agent Kit install / HITL framework. Do not claim Cursor Marketplace submit or an npm rename.
- Draft script must fail closed: it writes local drafts and refuses publish.
