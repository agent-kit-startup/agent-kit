# Mission Kit Landing (missionkit.io)

**Live URL:** [https://missionkit.io](https://missionkit.io) (static Hostinger hosting + SSL)  
**Previous:** `agent.startupkit.com.br` (deprecated; now 301 redirects to https://missionkit.io/)

## Source of record

The landing page is authored in the **Claude Design** project and exported as a zip.
The repo is a consumer: it syncs the export, builds a deployable bundle, and deploys it.
The design canvas is a React component (bindings, `sc-if`/`sc-for`, a logic class) that
renders client-side via a vendored `dc-runtime` (`support.js`). The repo ships the runtime
rather than flattening the markup, so the deployed page is byte-identical to what the
design tool renders.

**Design mirror:** `.cursor/context/landing-missionkit/remote/` (versioned)  
**Build output:** `.cursor/context/landing-missionkit/dist/` (gitignored, derived)  
**Decision:** [landing-external-design-source-of-record](../memory/decisions/2026-08-05_landing-external-design-source-of-record.md)  
**Design system:** [docs/design-system.md](design-system.md) (project id, upstream/downstream map, token divergence notes)

### Constraints

- Do not edit files under `remote/`; `landing:sync` overwrites them wholesale.
- **Upstream Design prompt guard:** `pnpm landing:sync` (and `landing:vendor`, same script) fail closed while `.cursor/context/landing-missionkit/UPSTREAM-DESIGN-FIX-PROMPT.md` exists with any unchecked markdown task (`- [ ]`). Apply that prompt in Claude Design first, export a zip via Download, then sync. The prompt counts as applied when the file is absent or every markdown task in it is checked (`- [x]` / `- [X]`). To sync before that (accepting overwrite of `remote/`), pass `--waive-upstream-prompt` or set `LANDING_SYNC_WAIVE_UPSTREAM_PROMPT=1`.
- Do not hand-edit anything in `dist/` after build; `landing:build` derives it (plus the product overlay below).
- Do not add design assets by hand; the build derives the design asset list from the canvas.
- Visual or copy changes to the marketing canvas go through the design tool, then re-export and re-sync.
- **Product overlay (allowed):** `landing:build` copies `dashboard/open.html` → `dist/mc/open.html` for cosmetic Mission Control broadcast Share URLs (ADR `2026-08-11_mission-control-broadcast-url-mask.md`). That file is product SoT under `dashboard/`, not Claude Design. Default share base uses `…/mc/open.html` (live). Extensionless `/mc/open` remains optional Hostinger alias work (align/public compliance), not required for the CLI default.

## Pipeline

```bash
# 1. Sync a new design export
pnpm landing:sync "~/Downloads/MissionKit landing page.zip"

# 2. Build the deployable bundle (vendors React, injects crawler head, copies assets)
pnpm landing:build

# 3. Verify the bundle matches the export
pnpm landing:build:check
# Factory CI (agent-kit-dev build job) runs `landing:build` then `landing:build:check`
# so open-source wording regressions and missing canvas sources fail the Evidence path.

# 4. Local stage (loopback, Range-capable, no-store)
pnpm landing:serve
# Open http://127.0.0.1:4173/

# 5. Deploy
# Zip dist/ and deploy via hosting_deployStaticWebsite to missionkit.io
```

### What the build changes (and nothing more)

1. Drops stylesheets the landing does not reference (design-system tokens, aggregator)
2. Self-hosts React so the runtime short-circuits `loadReactUmd()` and never hits unpkg
3. Injects a static `<title>`, description, canonical, Open Graph, Twitter Card, and favicon
   into `<head>` for crawlers (dc-runtime moves `<helmet>` into `<head>` at boot, which is
   too late for anything that does not execute JS)

## Deployment

- **Hosting:** Hostinger web hosting (`u262837109`), addon vhost root `/home/u262837109/domains/missionkit.io/public_html`
- **DNS:** `@` ALIAS to `missionkit.io.cdn.hstgr.net` (Hostinger CDN)
- **SSL:** Hostinger HTTPS (HTTP/2 200 verified)
- **Deploy method:** `hosting_deployStaticWebsite` with a zip of `dist/` preserving directory structure

### Rollback

The hand-authored production-shot HTML under `.cursor/context/landing-agentkit/` is
rollback reference material only. It is **not** a self-contained single-file deploy
artifact.

- Blob `d0e43278cda5` at commit `3dad9c6` (the `index.html` object cited by earlier
  docs) carries eight external asset references (four logo + four production PNG
  `src` values; historically `../../dashboard/logo.svg` and
  `../../assets/production/*.png`). It cannot be zipped alone for
  `hosting_deployStaticWebsite`. The current worktree files use root-relative
  `/dashboard/…` and `/assets/production/…` paths for the same five document-root
  assets; they are not asserted byte-identical to that blob.
- No production-shot-era single-file self-contained blob exists in Git. The last
  pre-shot CSS-mockup `index.html` that embeds its UI without those five files is
  blob `11197c8db22f` at commit `611c232` (pre-PR #646). Restoring that blob rolls
  back content as well as packaging.

To redeploy the production-shot legacy page (HITL only; not the supported live path),
zip `index.html` with these five paths at the **deployed document root** so the
root-relative URLs in both legacy HTML files resolve:

- `/dashboard/logo.svg` ← repo `dashboard/logo.svg`
- `/assets/production/1-mission-control-current-mission.png`
- `/assets/production/2-mission-control-check-list.png`
- `/assets/production/3-mission-control-Crew-Monitor.png`
- `/assets/production/4-mission-control-flight-log.png`

Do not deploy that `index.html` alone. The supported live path remains
`pnpm landing:build` followed by the `dist/` archive deployment described above.

## SEO

Live `missionkit.io` serves PolyForm Noncommercial / source-available copy (verified as-served HTML after Design sync → `landing:build` → Hostinger deploy):

- **Description / OG / Twitter:** Mission Kit is a free, source-available framework (PolyForm Noncommercial) with built-in project management, DevSecOps, and agent orchestration. Plan, build, review, and ship without leaving Cursor or VS Code. Commercial use: sales@missionkit.io.
- **CTA:** Free for noncommercial use, source-available, and it runs inside the IDE you already use.
- **Footer meta:** free & source-available (PolyForm NC)

Other crawler fields matching the build pipeline:

- **Title:** Mission Kit 5 · Development operations built into Cursor and VS Code
- **Favicon:** `assets/logo.svg` (SVG, also `apple-touch-icon`)
- **Open Graph image:** `assets/hero-astronaut.png` (absolutized to `https://missionkit.io/assets/hero-astronaut.png` in crawler head)
- **Twitter Card:** `summary_large_image` with title, description, and image

Operator path for copy changes: edit Claude Design SoR → Download zip → `pnpm landing:sync` → `pnpm landing:build` → `hosting_deployStaticWebsite`. Do not hand-edit `landing-missionkit/remote/` as the source of truth. Prompt notes: `.cursor/context/landing-missionkit/UPSTREAM-DESIGN-FIX-PROMPT.md` (license copy + install/prompt clipboard honesty).

Install and prompt copy buttons await `navigator.clipboard.writeText`, fall back to `document.execCommand('copy')` when needed, and show a brief failure affordance instead of an optimistic checkmark. The How-it-works "Copy plan path" / "Copy /git-staging" controls are decorative (disabled). Product Mission Control paste-destination CTAs are a separate contract (`dashboard/dashboard.html`).

## Mission Control demo iframe (Crew lexicon)

The landing embeds a tracked Mission Control snapshot at `landing-missionkit/remote/mc/dashboard.html` (not the live product dashboard).

| Surface | Current (as served from the snapshot) | Target (design-v2 / product SoT) |
|---------|----------------------------------------|----------------------------------|
| Current Mission `agent` | `Engineering Manager` | `Tech Lead` |
| Feed label seg0 | Design-export labels (`Squad ·`, …) emitted verbatim | Wire tokens in `#mc-mock-data`, display-masked via `CREW_ACTOR_MASK` / `crewActorRole` (e.g. `SQ` → Scrum Master) |
| Mask helpers in snapshot | Absent (`crewActorRole` count 0) | Same helpers as `dashboard/dashboard.html` |

The PolyForm cutover Design sync (`783ca90` / PR #698) also refreshed `remote/mc/dashboard-data.json` and `remote/mc/dashboard.html` with the Design-export Crew labels above. That lexicon delta is incidental to license copy; product SoT and display masking remain owned by the Mission Control / crew-mask lanes. **Do not** hand-edit `remote/mc/` to force the target row. Prefer regenerating the snapshot from product SoT when that path exists, or folding MC demo fixtures into a Design export and running `pnpm landing:sync`. Until then, CHANGELOG and this section must not claim display masking the snapshot cannot perform.

## Domain migration history

```
OLD: agent.startupkit.com.br (deprecated; 301 → missionkit.io)
NEW: missionkit.io (current canonical)
```

## Legacy files

`.cursor/context/landing-agentkit/` contains the previous hand-authored landing
(`index.html`, `page-content.html`) and three design reference files (`COPY.md`,
`DESIGN-SYSTEM.md`, `INVENTORY.md`). These predate the Mission Kit 5 redesign.
The retired `check:landing-body-equality` guard compared their trimmed body content; it is no longer an active delivery gate (call sites and `scripts/check-landing-body-equality.mjs` removed; use `pnpm landing:build:check`).
The production-shot variant also depends on the five document-root assets listed in
Rollback (root-relative `/dashboard/logo.svg` and `/assets/production/*.png`). These
files are kept for rollback reference only.
