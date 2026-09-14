# Cursor Projects — Primary-Source Study

**Phase:** `phase0-awareness-and-study` (`cursor-projects-study-adr-integration.plan.md`)
**Accessed:** 2026-09-12, from this environment. No fetch was blocked or slow in this pass; every source below returned on the first attempt.
**Method:** Primary sources only — `cursor.com/changelog/projects`, `cursor.com/changelog`, `cursor.com/blog/projects`, `docs.cursor.com/projects` (redirect probe), `cursor.com/docs` (docs homepage), `cursor.com/docs/cloud-agent` (Cloud Agents doc), and one Cursor forum announcement thread. `WebSearch` was used only to locate exact URLs (e.g. the Cloud Agents API path) and to confirm no dedicated Projects forum thread exists yet — not as a source of facts in the table below. No opinions here; decisions belong to Phase 1.

## 1. Awareness check (verbatim)

Command: `agent-kit cursor-awareness --check --json` (no `--offline` fallback needed; the network fetch succeeded).

```json
{
  "status": "gaps-found",
  "latestCursorVersion": "20.103",
  "lastSeenCursorVersion": null,
  "inventoryRefreshed": "2026-08-12",
  "openActionIds": ["A7"],
  "gaps": [
    {"id": "open-action-A7", "severity": "advisory", "evidence": "Action item A7 is Open in the native-audit inventory"},
    {"id": "changelog-baseline", "severity": "info", "evidence": "Changelog latest 20.103; no lastSeenCursorVersion baseline yet (stamp to baseline)"}
  ],
  "applyRecommended": false,
  "fieldReportRecommended": false
}
```

**Does the check detect Projects?** No. The gap list contains exactly two items — the pre-existing open action A7, and a changelog-version-baseline info note — and neither names "Projects" or any headline feature. The check's `gaps` mechanism is keyed to (a) action items already marked Open in `docs/cursor-native-audit.md` and (b) a numeric changelog-version delta against a stamped baseline; it has no keyword/feature-diff step that would flag "the changelog shipped a named feature the inventory doesn't mention yet."

**Note-class operational gap for the ADR (not fixed here):** `agent-kit cursor-awareness` cannot, by itself, ever surface a brand-new named feature like Projects — it only re-surfaces gaps the inventory has already been told about (open action items) or a bare version-number delta. A human (or the docs-refresh phases of a plan like this one) is the only thing that turns "version bumped" into "here is what changed." This is consistent with the tool's own framing ("Opt-in advisory... never apply") but is worth stating plainly for Phase 1: the check is a version/action-item tripwire, not a feature-coverage auditor.

## 2. Facts table

| # | Fact | Source | Date |
|---|------|--------|------|
| 1 | Projects launched in beta 2026-09-10, "rolling out to all users starting today." | `cursor.com/changelog/projects`; `cursor.com/changelog` | 2026-09-10 |
| 2 | Projects is for "larger bodies of work, such as a feature, a migration, or a full app" that "will outlive a single chat." | `cursor.com/changelog/projects`; `cursor.com/blog/projects` | 2026-09-10 |
| 3 | A **coordinator agent** "doesn't write code itself; it plans the work, delegates it to agents that implement it, and brings the finished work back to you to check." Because it delegates rather than executes, "it is never blocked and is always responsive." | `cursor.com/changelog/projects`; `cursor.com/blog/projects` | 2026-09-10 |
| 4 | "A Project runs on its own computer in the cloud" — dedicated cloud infrastructure, so work continues while the local machine is offline. | `cursor.com/changelog/projects` | 2026-09-10 |
| 5 | **Local-agent fallback:** "When something needs testing on your machine, the coordinator spins up a local agent to run it there." | `cursor.com/blog/projects` | 2026-09-10 |
| 6 | **Synced project files:** "Each Project maintains a set of files that sync across every cloud and local machine its agents use." Agents "add research and artifacts, along with what they learn about the codebase and how you prefer work to be done," and this accumulated context is shared with every future agent on the Project. | `cursor.com/changelog/projects`; `cursor.com/blog/projects` | 2026-09-10 |
| 7 | **Creation flow:** "Start a Project from the left hand nav, describe what you want built, and the coordinator takes it from there." No further detail (no screenshots, no step list) given in either primary source fetched. | `cursor.com/blog/projects` | 2026-09-10 |
| 8 | **Review/handback cadence:** illustrated with a migration example — "Early on, you review each PR closely. As the fixes hold up, you review less, and the coordinator keeps working through the migration on its own." A design-system example describes an engineer who "checks in where attention is needed" once the coordinator has demonstrated competency. | `cursor.com/blog/projects` | 2026-09-10 |
| 9 | **Event subscriptions:** "Tell the coordinator agent to watch a Slack channel, run on a schedule, or follow all your PRs, fixing CI and acting when they open or merge" — action taken "without waiting for your prompt." | `cursor.com/changelog/projects`; `cursor.com/blog/projects` | 2026-09-10 |
| 10 | Scale claim: the coordinator "can delegate tasks to thousands of subagents, and perform recurring work without being prompted." | `cursor.com/changelog/projects` | 2026-09-10 |
| 11 | `docs.cursor.com/projects` does not exist as a standalone page: it returns **HTTP 308** to `cursor.com/docs` (the generic docs homepage). Confirmed live in this session, not carried over from the plan's 2026-09-11 note. | `docs.cursor.com/projects` (redirect probe) | 2026-09-12 |
| 12 | `cursor.com/docs` (homepage/nav) does not mention "Projects" anywhere; its nav lists Get started / Models & Pricing / Changelog / Downloads / Help. | `cursor.com/docs` | 2026-09-12 |
| 13 | `cursor.com/docs/cloud-agent` (the Cloud Agents doc) does not mention Projects, coordinator agents, or subscriptions (Slack/schedule/PR-follow) anywhere. Its scope is: running agents in isolated cloud VMs, access via iOS/Web/Desktop/Slack/GitHub/Linear/API, environment config, security/networking, artifacts, team sharing, API-usage billing. It documents `@cursor` as a Slack trigger for **an** agent, not the Projects coordinator's Slack-channel subscription. | `cursor.com/docs/cloud-agent` | 2026-09-12 (page; undated content) |
| 14 | The most recent Cursor SDK / Cloud Agents API announcement found (`forum.cursor.com/t/cursor-sdk-cloud-agents-api-updates/159284`) predates Projects by several months (dated April 2026) and does not mention Projects, coordinators, or any connection between the two. It documents `@cursor/sdk`, cloud/local runtime split, and a redesigned Cloud Agents API (durable agents, SSE streaming, reconnect, lifecycle controls, max 20 named subagents per run). | Cursor forum, `t/159284` | 2026-04 (thread date, as summarized) |
| 15 | No dedicated Cursor forum thread about the Projects beta was found as of this session (2 days after launch). Forum search results for "Cursor Projects" returned only unrelated pre-existing threads that use "projects" in the generic sense (showcase/best-practices), not the new feature. | `forum.cursor.com` search | 2026-09-12 |
| 16 | No Projects-specific pricing, billing, or beta usage-limit figures were found in the changelog, blog post, or a general pricing search. General per-tier agent-usage multipliers exist for Cursor accounts broadly (Pro baseline, Pro Plus 3x, Ultra 20x; Teams Premium seat 5x Standard) but no source ties these specifically to Projects. | `cursor.com/changelog/projects`; `cursor.com/blog/projects`; pricing search | 2026-09-10 / 2026-09-12 |

## 3. Unknown as of 2026-09-12

Each row below is a valid Phase 0 completion state, not a stall — no primary source (changelog, blog, docs, or forum) states these facts as of this session.

- **On-disk footprint of synced project files.** Names, count, format, and whether anything lands under `.cursor/` on a local machine vs. some other project-root or cloud-only location — not documented anywhere fetched.
- **Sync conflict model.** What happens when a local edit and a cloud-agent edit to a shared project file race — not documented. (Forum search surfaced an unrelated, pre-existing "Cloud Sync" conflict issue from March 2026 tied to editor-settings sync, not to Projects' shared project files; that is a different feature and is not conflated with this unknown.)
- **Relation to the Cloud Agents REST API / `cursor-agent` CLI / `@cursor/sdk`.** No primary source states whether a Project's coordinator and subagents are implemented as Cloud Agents API resources under the hood, are startable/inspectable via `cursor-agent` or `@cursor/sdk`, or are an entirely separate orchestration layer. The Cloud Agents doc and the most recent SDK/API forum announcement (April 2026) both predate Projects and neither mentions it.
- **Relation to native Plans, the Agents Window, and `/worktree`.** No primary source describes whether a Project's coordinator produces or consumes native Cursor Plans, whether Project agents show up in the Agents Window alongside ordinary agents, or whether `/worktree` isolation applies to a Project's local-agent fallback runs.
- **Availability tiers, billing, and beta limits specific to Projects.** No quota, seat-tier gating, or per-Project pricing was published in any source fetched; "beta, rolling out to all users" is the only availability statement found.
- **Community/beta feedback.** No forum thread on the Projects beta exists yet as of 2 days post-launch; this is a timing gap (thin public docs / brand-new beta), not a search failure — the search successfully returned unrelated older threads, confirming the absence rather than a fetch problem.

## 4. Sources not usable / notes on method

- No source in this pass was slow or unreachable — every `WebFetch` call returned on the first attempt. The HANDOFF's stall-avoidance guidance did not need to be invoked for a genuine unreachable source; it is recorded here only because the instruction required noting it if it happened, and it did not.
- `docs.cursor.com/projects` returning a 308 (not a 404) to the docs homepage is worth flagging precisely because the plan's Broad Intake recorded a 404 on 2026-09-11; by 2026-09-12 the path resolves as a redirect rather than a hard 404. Net effect is the same (no dedicated Projects doc page exists), so this does not change any Phase 0 or Phase 1 conclusion — noted for accuracy only.

## 5. Integration opportunity map (Phase 3)

Ranked "use in full" table. ADR verdicts are from `.cursor/memory/decisions/2026-09-12_cursor-projects-thin-adapter.md` where a tension maps directly; rows with no direct tension get a verdict argued the same way (no concrete mechanism to build on beats a general "seems useful"). Effort is for the residual plan a row would spawn, not for anything done in this plan (nothing is implemented here).

| # | Opportunity | ADR verdict | Value to operator | Effort | Constraint it must respect |
|---|---|---|---|---|---|
| 1 | Projects coordinator consumes `.cursor/HANDOFF.md` + plan frontmatter as its own "project files" | **reject** (tension a) | High if it worked (one continuity model instead of two) — but speculative: Phase 0 could not confirm Projects can even point its sync at arbitrary repo files | N/A — no residual authorized | Would need a documented Projects file-store mechanism first; HANDOFF/plans stay the SoT regardless |
| 2 | Projects' synced project files vs. the kit's own Context Pack (`.cursor/context/`) | **reject (no merge)** | Low-to-none today — two accumulating-context stores for the same repo would need a stated reconciliation rule Phase 0 found no evidence to write | N/A — no residual authorized | Same as #1: no confirmed on-disk shape to reconcile against |
| 3 | Event subscriptions (Slack channel / schedule / PR-follow) vs. scheduling or event-driven kit runs | **reject — cite, do not reopen** | N/A | N/A | Per the 2026-09-10 amendment to ADR `2026-09-04_major-tom-autonomous-mode.md` (PR #881, `0a73c5f`): Countdown, nightly review, and home-lab scheduling were withdrawn from the kit and are operator infra. This row is a citation, not a re-opening — Projects' own native subscriptions are a Cursor-cloud feature an operator can use directly without any kit involvement at all, which is a stronger position than the withdrawn kit-side scheduler ever reached |
| 4 | Mission Control surfaces Project status read-only (e.g. "Project X: coordinator running, N subagents") | **later** (tension c — not decided here, listed for the operator) | Medium — operators already glance at Mission Control for `/run-plan-all` queue state; a Projects panel would be a natural extension | Small-to-medium *if* an API exists; unknown until Cursor documents one | Mission Control stays local-only, copy-only, no mutating actions (2026-07-27, 2026-07-25); no deep-linking (2026-07-24, superseded); read-only display only |
| 5 | `/cursor-update-awareness` gains a feature-keyword diff so it would have caught Projects on day one | **later** | Medium — closes the note-class operational gap this plan's Phase 0 found (the check only re-surfaces open action items + a version-number delta, no feature diff) | Small-medium (`packages/cli` change to the awareness detector) | Awareness stays report-only / advisory; apply/enqueue stay HITL (ADR `2026-08-01_cursor-update-detection-source.md`) |
| 6 | `/tips` guidance for Projects vs `/run-plan` | **adopt — done in this plan** | Delivered | None remaining | Phase 2b landed it; see `.cursor/commands/tips.md` |
| 7 | A project-level "how the kit wants work done" preferences file a Projects coordinator could learn from | **adapt-concepts (docs note only)** | Low-medium, and largely already covered: `.cursor/project-context.md` (the cross-IDE contract) and `AGENTS.md` already state repo conventions any agent — coordinator or not — can read on its own | None — no new file authorized; a future docs pass could note explicitly that these existing files serve this purpose | Do not create a second preferences file or a Projects-specific format; `.cursor/project-context.md`/`AGENTS.md` stay the one SoT for "how this repo wants work done" |

## 6. Residual plan proposals (for the operator to `/backlog-add`, not enqueued here)

Two rows above (#4, #5) touch `dashboard/` or `packages/cli` and would need their own plan. Neither is Field-Report-worthy — both are net-new feature ideas surfaced by studying a brand-new beta, not defects found in shipped behavior.

1. **"Mission Control: read-only Cursor Projects status panel"** — one-line goal: once Cursor documents a stable Projects status API (REST or webhook), add a copy-only, local-only Mission Control panel showing Project/coordinator/subagent status, with no mutating actions and no deep-linking. Blocked today on Cursor publishing that API (Phase 0 found none); an operator enqueuing this now would be enqueuing a blocked plan.
2. **"cursor-awareness: feature-keyword diff against the changelog"** — one-line goal: extend `agent-kit cursor-awareness --check` so a new named feature in the Cursor changelog (like Projects) surfaces as its own gap row, not only pre-existing open action items and a bare version-number delta. This is a general awareness-detector improvement, not Projects-specific, and closes the note-class gap this plan's Phase 0 recorded.
