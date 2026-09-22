# Cursor changelog keep-up (2026-09)

Research note for plan `cursor-changelog-keep-up.plan.md` Phase 0. Check is not apply. This file does not restamp `docs/cursor-native-audit.md` or `docs/cursor-3-features.md`.

**Fetched:** 2026-09-16. Primary source: `https://cursor.com/changelog` (live HTTPS HTML). Desktop version from the operator enqueue: **3.20.17**. Independent About-panel corroboration (Cursor forum bug thread, build date 2026-09-12): 3.20.17 Universal, commit `0c32194e`, Electron 42.10.0. Changelog dated head remains **2026-09-10 Projects**; the homepage does not label 3.20.17.

**Inventory baseline (do not restamp here):**

| File | Last refreshed (on disk this session) | Named post-Aug-2026 rows |
|------|----------------------------------------|--------------------------|
| `docs/cursor-native-audit.md` | **2026-09-15** (Plan Mode ADR + plugin pin 5.9.0; plan enqueue still said 2026-09-12) | Plan Mode (absorbed), Projects (not integrated) |
| `docs/cursor-3-features.md` | undated body; Projects row 2026-09-10; Plan Mode row (ADR `2026-09-15_kit-plans-sot-over-host-plan-mode.md`) | `/resume`, Summaries, Transcripts, Agents Window, `/worktree`, `/best-of-n`, Plans, Projects |

**Awareness check (verbatim, this session):** `agent-kit cursor-awareness --check --json` (network fetch succeeded).

```json
{
  "status": "gaps-found",
  "latestCursorVersion": "20.103",
  "lastSeenCursorVersion": null,
  "inventoryRefreshed": "2026-09-15",
  "openActionIds": ["A7"],
  "gaps": [
    {"id": "open-action-A7"},
    {"id": "changelog-baseline", "evidence": "Changelog latest 20.103; no lastSeenCursorVersion baseline yet (stamp to baseline)"}
  ],
  "applyRecommended": false,
  "fieldReportRecommended": false
}
```

The check does not name Projects, Custom modes, `/goal`, `/loop`, Origin, or self-hosted machines. `latestCursorVersion` `20.103` is changelog CSS/layout noise that still passes `CURSOR_VERSION_MAJOR_MAX = 20` (the extractor already rejects majors such as 49.511). Version-number delta remains a false primary signal. Phase 1 owns the feature-keyword digest; this note does not change the extractor.

**Standing constraints (not reopened):**

- Projects: ADR `2026-09-12_cursor-projects-thin-adapter.md` (no structural change).
- Plan Mode: ADR `2026-09-15_kit-plans-sot-over-host-plan-mode.md` (kit `.cursor/plans/*.plan.md` stay SoT). Leave remaining Plan Mode ownership to shipped `cursor-agent-routine-optimize` `phase4-cursor-native`.
- Detection source stays changelog-primary: ADR `2026-08-01_cursor-update-detection-source.md`.
- Cloud Agents stay the opt-in audits reviewer only: ADR `2026-08-14_cursor-cloud-agents-sdk-audits-backend.md`. `BackendId` stays `cursor-agent` / `claude`.
- Kit scheduling of recurring work was withdrawn (Major Tom amendment 2026-09-10). Cursor-cloud subscriptions are not a kit scheduler.

## Dated changelog posts (live 2026-09-16)

| Date | Headline | In native-audit? | In features map? |
|------|----------|------------------|------------------|
| 2026-09-10 | Cursor Projects | Yes (not integrated) | Yes |
| 2026-09-02 | Self-hosted machines (My Machines, team pools, sandboxes, computer use) | No | No |
| 2026-08-27 | Start from scratch without a repo (Origin bootstrap, live preview, Vercel publish) | No | No |
| 2026-08-19 | Cloud Agents harness: Subscriptions, Custom modes, subagents on own VMs, `/goal`, steering; mentions `/loop` | No (except Projects subscriptions overlap) | No |
| 2026-08-17 | Origin Code Hosting | No | No |

Older changelog pages (Cursor 3 Agents Window, Design Mode, Bugbot, tiled layout) predate this keep-up window and already have features-map coverage. They are not reclassified.

## Desktop 3.20.x (not a dated changelog post)

3.20.17 is a desktop build (2026-09-12) after the 2026-09-10 Projects post. Public changelog does not publish a 3.20.17 version label. Forum and undated "Desktop Improvements" lists describe IDE UX: parallel Debug sessions, browser-tool zoom/context menu, plan-file autocomplete in agent input, multiline Plan Mode questions, MCP dialog polish, PR hunk anchoring, Automations model picker (curated list, separate from the chat picker). None of those are kit contracts.

## Classify table

Labels: **adopt** (kit must change in Phase 2), **thin-adapter** (Phase 3 inventory line plus optional one-line complementarity; no new product lane), **ignore** (Cursor-native only; Phase 3 still records a keyword so the next digest can see it).

| ID | Surface | First public date | Label | Why | Phase 2 product? |
|----|---------|-------------------|-------|-----|------------------|
| S1 | Projects (coordinator, synced files, Slack/schedule/PR subscriptions) | 2026-09-10 | ignore | Already inventoried. ADR `2026-09-12` stands. Do not reopen. | No |
| S2 | Plan Mode (host plans, multiline questions, plan-text autocomplete) | Cursor 3 + 3.20.x polish | ignore | Already inventoried 2026-09-15. Kit plans stay SoT. Do not steal `phase4-cursor-native`. | No |
| S3 | Custom modes (pin a skill as an always-on chat mode) | 2026-08-19 | thin-adapter | Cursor-native skill pin. Kit `agentPersona` stays chat chrome only (`2026-07-26_agent-persona-vs-interface-skin.md`). Document the distinction; do not load Custom modes from the kit. | No |
| S4 | `/goal` (long-lived objective until complete) | 2026-08-19 | thin-adapter | Native long-running objective. Does not replace kit plan to-dos, Gate A/B, or `/run-plan`. One inventory line. | No |
| S5 | `/loop` (recurring native check-ins) | 2026-08-19 | thin-adapter | Distinct from kit `/run-plan` continuous ticks. No kit `/loop` slash. | No |
| S6 | Steering (follow-up waits for the next tool call; Send now / double Enter) | 2026-08-19 | ignore | IDE input UX. No kit hook or command. | No |
| S7 | Origin (Cursor-hosted repos, GitHub sync, in-Cursor PRs, apps) | 2026-08-17 | ignore | Not the kit git spine (`/git-staging` → `origin/staging` → `/git-prod`). Do not invent Origin remotes. | No |
| S8 | Start from scratch / Origin bootstrap / live preview / Vercel publish | 2026-08-27 | ignore | Cloud Agents + Origin product. No kit generator or publish path. | No |
| S9 | Self-hosted machines, team pools, hibernate, third-party sandboxes | 2026-09-02 | ignore | Operator infra. Cloud Agents remain audits-only. No `BackendId` for machines. | No |
| S10 | Computer use on Linux/Mac (self-hosted workers) | 2026-09-02 | ignore | Worker desktop control. Not a kit hook event. | No |
| S11 | Cloud Agent subscriptions (PR / Slack thread / schedule) | 2026-08-19 | ignore | Cursor-cloud automation. Kit scheduling withdrawn 2026-09-10. Overlaps Projects subscriptions (S1). | No |
| S12 | Subagents on their own VMs | 2026-08-19 | ignore | Cursor cloud isolation. Kit Task stays local IDE. | No |
| S13 | Desktop 3.20.x UX (Debug parallel, browser tool, MCP/PR polish, image gallery, faster modals) | 3.20.x (unlabeled on changelog head) | ignore | IDE product. No L0 or CLI contract. | No |
| S14 | Automations (desktop scheduled-agent UI; forum 3.20.17) | 3.20.x | ignore | Same family as S11. Kit does not own Automations. | No |
| S15 | Awareness feature-keyword miss (kit) | n/a (detection gap) | adopt (Phase 1 owns) | Check only re-surfaces Open action ids plus a version token. Reproduced live: gaps are `open-action-A7` and `changelog-baseline` `20.103`. Not a Cursor surface. Phase 1 implements the digest. Phase 2 must not duplicate it. | Phase 1 only |

## Phase 2 adopt set

**Empty for Cursor surfaces.** Phase 2 product diff is empty. S15 is the only adopt row and is already a Phase 1 to-do (`phase1-capability-digest`).

Phase 3 restamps native-audit and the features map for S3–S14 keywords (thin-adapter and ignore), leaves S1/S2 text aligned with existing ADRs, and writes the public `[Unreleased]` keep-up bullet.

## Phase 2 closeout

Phase 2 product diff is empty. S1–S14 stay ignore or thin-adapter. S15 (feature-keyword miss) shipped in Phase 1 (`agent-kit cursor-awareness --check`). No L0 command, hook, or CLI adapter was added here. Plan Mode stays on ADR `2026-09-15_kit-plans-sot-over-host-plan-mode.md`. Projects stays on ADR `2026-09-12_cursor-projects-thin-adapter.md`. Inventory lines for S3–S14 belong in Phase 3.

## Phase 3 closeout

Inventories restamped **2026-09-16**. `docs/cursor-native-audit.md` summary rows cover Custom modes, `/goal` / `/loop`, Origin (including Origin Repos, Bring your GitHub repos, Pull requests, Agents in every repo, App extensions for Cursor repos), self-hosted machines, and steering/Automations. `docs/cursor-3-features.md` has matching table rows. Public `[Unreleased]` Changed bullet records the keep-up. ADR `2026-09-16_cursor-changelog-keep-up-classify.md` is Accepted. Check still does not rewrite the inventory (`applyRecommended` stays false). Open action A7 is unchanged. Remaining digest hits after restamp are changelog site chrome (`/ipad`, Resources, Company, Legal, Connect), not classified Cursor surfaces.

## Method notes

- Offline fallback was not used; the changelog fetch succeeded.
- Changelog pagination (`/changelog/page/9`) was used only to confirm that unlabeled "Desktop Improvements" clusters sit on older Cursor 3 posts, not as a second detection source.
- No `docs/product-context/` extract: this keep-up is inventory research, not mixed personal/product positioning.
- Secrets: public HTTPS only. No `.env` tokens.
