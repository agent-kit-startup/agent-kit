# Comms content calendar

Living schedule for Mission Kit recap, release, and contributor-ask drafts. Seed copy: [public-launch-announcement.md](public-launch-announcement.md) (keep that file; evolve here).

**SoT for "is it shipped?":** `CHANGELOG.md` closed versions, GitHub Releases on the public repo, and live [missionkit.io](https://missionkit.io). Product version for current claims: newest closed `CHANGELOG.md` version, **5.3.0** as of 2026-08-15.

## How to add a row

1. Confirm the item exists in CHANGELOG or a GitHub Release (or is explicitly a contributor process ask, not a product claim).
2. Pick template: recap / release / contributor-ask.
3. Draft with `.cursor/scripts/comms-draft.mjs` (or the `mission-kit-comms` agent).
4. Operator Ask before any public post. Record the date posted only after HITL yes.

## Calendar

| When | Kind | Hook (shipped artifact) | Status | Channels (after HITL) |
|------|------|-------------------------|--------|------------------------|
| 2026-08-12 | release | CHANGELOG `[5.0.0]`; npm `@dadado/agent-kit-cli@5.0.0`; missionkit.io Mission Kit 5 | **seed** (launch paste already exists) | site, GitHub, social paste in [public-launch-announcement.md](public-launch-announcement.md) |
| After next closed CHANGELOG version | release | New `## [X.Y.Z]` plus GitHub Release | planned | site, X, optional HN/Medium |
| Weekly while `[Unreleased]` has merged staging work | recap | `[Unreleased]` bullets that are already in `staging` (do not recap unmerged WIP) | planned | X short; optional newsletter |
| Ongoing | contributor-ask | [CONTRIBUTING.md](CONTRIBUTING.md), [contribute-upstream.md](contribute-upstream.md), community skills under `registry/skills/community/` | planned | GitHub issues, social only after Ask |

Do not schedule Cursor Marketplace submit here. That work is parked.

## Templates

- [Recap](comms-templates/recap.md)
- [Release](comms-templates/release.md)
- [Contributor ask](comms-templates/contributor-ask.md)

## Claim check (every draft)

- [ ] Mission Kit = product; Agent Kit = CLI/npm/slash/pack; Mission Control = dashboard
- [ ] Version and features match the shipped docs for the current release (getting-started, README, five-layer matrix)
- [ ] HITL / staging→prod confirmation is stated; no "posts itself" or "full autonomy"
- [ ] PolyForm Noncommercial + `sales@missionkit.io` for commercial use
- [ ] Public GitHub: `https://github.com/agent-kit-startup/agent-kit`
- [ ] No Marketplace listing claimed as done
