---
name: mission-kit-comms
description: "Draft Mission Kit adoption posts (recap, release, contributor-ask) with dual-name, claim checks, per-channel checklists, and HITL-before-post. Use when spreading the word, social copy, changelog recaps, or community replies."
version: 0.1.0
category: ux
---

# Mission Kit comms (spread the word)

Draft public copy for **Mission Kit** adoption. Never publish or reply on a network without an explicit operator Ask (clickable Ask questions, or numbered-list fallback).

Thin reuse: short blocks and one ask per message from sibling skill `ux-message-flows`; prompt structure from sibling `prompts-markdown`. Do not duplicate those skills. Do not treat Agent Personas as this skill.

## Dual-name

| Use | Name |
|-----|------|
| Product / marketing / site | Mission Kit / missionkit.io |
| CLI, npm, slash, pack | Agent Kit / `agent-kit` / `@dadado/agent-kit-cli` |
| Dashboard | Mission Control |

## Claim sources (indicative docs; verify shipped)

- `docs/five-layer-claim-matrix.md`
- `docs/getting-started.md`
- `docs/public-launch-announcement.md`
- Channel map: `docs/comms-channel-map.md`
- Calendar: `docs/comms-content-calendar.md`
- Product version floor: **5.0.0**. Do not write 4.x as current.

Forbidden in drafts: full autonomy without HITL; Cursor Marketplace "listed" unless the parked submit plan has actually listed; npm/CLI renamed to Mission Kit; silent posting.

## HITL-before-post

1. Draft only (chat, plan, or `.cursor/comms-drafts/` via `.cursor/scripts/comms-draft.mjs`).
2. Ask: `Post this` / `Edit draft` / `Discard`.
3. Skip or cancel = do not post.
4. Secrets stay out of git. Env names: `docs/comms-publish-pipeline.md`.

## Per-channel checklist

Copy the channel row, then tick before Ask.

### X / Twitter

- [ ] Two short blocks or fewer; one link (missionkit.io or GitHub)
- [ ] Dual-name if install is mentioned
- [ ] No thread that claims unshipped CHANGELOG items

### Medium / newsletter / Substack

- [ ] Recap or release template filled from CHANGELOG / Release
- [ ] HITL positioning sentence present
- [ ] Commercial: PolyForm NC + sales@missionkit.io

### Hacker News

- [ ] Tied to a real release or Show HN, not a daily dump
- [ ] Title does not say "autonomous agent that ships to prod alone"

### GitHub (issues / PR)

- [ ] Contributor funnel: CONTRIBUTING, contribute-upstream, CoC, SECURITY private path
- [ ] Not a Marketplace submit CTA
- [ ] Promotional maintainer replies still need Ask

### Slack / Discord

- [ ] Deferred unless an operator-owned workspace exists
- [ ] Same HITL as other networks

### GitHub Discussions

- [ ] Do not post; Discussions is not enabled (`.github/SUPPORT.md`)

## Output

Return: channel, draft body, claim-check result, **HITL pending**. Do not call network APIs.
