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
**Decision:** `.cursor/memory/decisions/2026-08-05_landing-external-design-source-of-record.md` (private)  
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

# 5. Deploy to staging — NEVER production
pnpm landing:deploy:staging
# Ensures the `staging` subdomain + DNS record exist, then uploads dist/
# into staging/ on the same hosting account. Never touches missionkit.io.

# 6. Automated acceptance against the live staging URL
pnpm landing:verify:staging
# Headless-Chrome render (not curl): 0 unresolved bindings, #dc-root
# present, video + iframe present, no request outside the origin on load.
# The demo modal's youtube-nocookie embed is an opt-in exception that only
# fires if a person clicks to open it: this gate never clicks, so it neither
# tests nor needs to allow that host. See "On-interaction exception".

# 7. HITL — open https://staging.missionkit.io, compare side by side
#    against the Claude Design canvas, approve explicitly. Nothing below
#    this line runs on a passing checklist alone.

# 8. Promote (only after explicit approval) — re-deploys the SAME dist/
#    bytes already validated on staging. Never rebuilds.
pnpm landing:promote

# Rollback, any time after a promote
pnpm landing:rollback            # redeploys the immediately previous release
pnpm landing:rollback <release>  # redeploys a specific archived release
```

Every production deploy goes through staging first — there is no script path
that deploys straight to `missionkit.io`. `landing:promote` is the only script
that ever writes to the production root; `landing:deploy:staging` refuses (by
assertion, in code) to write anywhere outside `staging/`.

### What the build changes (and nothing more)

1. Drops stylesheets the landing does not reference (design-system tokens, aggregator)
2. Self-hosts React so the runtime short-circuits `loadReactUmd()` and never hits unpkg
3. Injects a static `<title>`, description, canonical, Open Graph, Twitter Card, and favicon
   into `<head>` for crawlers (dc-runtime moves `<helmet>` into `<head>` at boot, which is
   too late for anything that does not execute JS)

Release version and changelog notes are **not** a build-time feed. They live in the
canvas fields below and are stamped with `pnpm landing:update-release` (does not deploy).

### Release version and product notes

Two existing canvas fields, restored to the original pill-and-frame visual (no live badge,
no CHANGELOG.md dump):

| Field | Selector | Content |
|---|---|---|
| Current release | `a[data-release-version]` inside `p.ak-brand` (New release pill + version text) | Version string plus a link to the **public** GitHub Release (`agent-kit-startup/agent-kit`, not the private `agent-kit-dev` repo) |
| Product notes | `div[data-changelog-content]` in the Footer CTA `.ak-mc-frame` | Short public product notes. Not a live feed and not `CHANGELOG.md`. |

Stamp (idempotent; fails closed if the fields are missing, if notes look like a changelog dump, or if the URL is not the public tag URL):

```bash
node scripts/public-changelog.mjs --version 5.6.0 --blurb
pnpm landing:update-release -- --version 5.6.0 --notes "Short public product notes."
pnpm landing:update-release -- --version 5.6.0 --notes-file ./public-release-notes.txt
pnpm landing:update-release -- --version 5.6.0 --notes "Short public product notes." --dry-run
```

`--blurb` is the stamp-safe `publicNotesBlurb` (heading-free, under 1000 characters). Never pass `CHANGELOG.md` as `--notes-file`.

Then `pnpm landing:build`. Deploy stays `landing:deploy:staging` / `landing:promote`.

**Release closeout (autonomous):** after public GitHub Release Latest exists for `vX.Y.Z`, private tag CI job `sync-landing` runs `node scripts/sync-landing-release.mjs` (same stamp + staging hop + promote). It fails if Latest does not match, `HOSTINGER_API_TOKEN` is unset, or live HTML would stay stale. Manual retry: Actions workflow_dispatch `sync_landing` (optional `landing_version`). Local: `pnpm landing:sync-release -- --version X.Y.Z`. This does not merge the public sync PR and does not skip the staging hop. Design-canvas visual deploys stay on `/kit-staging` HITL.

`landing:sync` overwrites `remote/` wholesale. Re-run `landing:update-release` after a Design zip so the two fields are not reverted to a live badge or an empty box.

### On-load vs on-interaction requests

Everything the build ships is self-contained **on load** by default (proven headless,
external DNS blocked). There is no on-load third-party exception: the former hero
release badge (`img.shields.io`) is gone; version is a static `data-release-version`
link. See ADR `decisions/2026-08-05_landing-external-design-source-of-record.md`
(2026-08-27 addendum). Visual or copy changes to the marketing canvas still go through
Claude Design, then re-export and `landing:sync`. The two release fields above are
the sanctioned stamp via `landing:update-release` (re-run after every sync).

**On-interaction exception:** the demo video modal mounts a `youtube-nocookie.com`
iframe, but only when a person clicks to open it. `demoSrc` defaults to `''` and the
modal (iframe included) is not in the DOM at all until `demoOpen` is true
(`<sc-if value="{{ demoOpen }}">`), so first paint issues zero third-party requests
(fixed 2026-08-05, `85a9e61`; re-verified live 2026-08-11: `missionkit.io`'s served
bytes carried no outward `src`; re-verified again from source at HEAD 2026-08-24
via `pnpm landing:build` with no network access). This is expected, deliberate
behavior, not a defect: a video demo has to come from somewhere. The acceptance
line is "the live page issues no request outside its own origin **on load**; opening
the demo modal is a user-opted exception to `youtube-nocookie.com`", not an
unqualified "no request outside origin," which the page was never trying to
guarantee for every possible click.

## Deployment

- **Hosting:** Hostinger web hosting (`u262837109`), addon vhost root `/home/u262837109/domains/missionkit.io/public_html`
- **DNS:** `@` ALIAS to `missionkit.io.cdn.hstgr.net` (Hostinger CDN); `staging` CNAME to the same CDN target (added by `landing:deploy:staging` on first run, idempotent thereafter)
- **SSL:** Hostinger HTTPS (HTTP/2 200 verified)
- **Deploy method (production):** `scripts/promote-landing.mjs` (`pnpm landing:promote`) — zips the already-staging-validated `dist/`, uploads it, then triggers the Hostinger static-site deploy against `domain=missionkit.io`. Same underlying REST call the interactive `hosting_deployStaticWebsite` MCP tool used for the original production deploy, reimplemented as a standalone script (see `scripts/lib/hostinger.mjs`) so it can run outside an MCP session
- **Deploy method (staging):** `scripts/deploy-landing-staging.mjs` (`pnpm landing:deploy:staging`) — per-file upload into the `staging/` subdomain directory. Deliberately does **not** use the website-level deploy trigger: that endpoint's extraction target is the website root, and a subdomain is not a separate "website" in this API (it does not appear in the `/websites` listing, only under `/subdomains`), so routing staging through it risks overwriting production. Every upload path is asserted to start with `staging/`

### Staging pipeline (missionkit-staging-promote.plan.md)

- **Subdomain:** `staging.missionkit.io`, created via `hosting_createWebsiteSubdomainV1` (`POST .../websites/missionkit.io/subdomains`), directory `staging/` under the same document root as production — not a separate hosting account.
- **Never indexed.** Staging must not carry `noindex` inside `dist/`'s own bytes: `landing:promote` ships the *exact same* `dist/` bytes already validated on staging, and if those bytes carried a `noindex` meta tag, promoting would noindex production too. Instead, `landing:deploy:staging` writes two generated, staging-only files alongside the upload — `staging/.htaccess` (`Header set X-Robots-Tag "noindex, nofollow"`) and `staging/robots.txt` (`Disallow: /`) — neither is part of `dist/`, neither is ever promoted. This is a deliberate deviation from the plan's literal wording ("toggle in build-landing.mjs"), made to preserve the plan's own higher-priority rule that promote never rebuilds and ships identical bytes.
- **Residual:** the subdomain directory lives under the same document root as production (`.../public_html/staging/`), so the staged build may also be reachable at `missionkit.io/staging/` in addition to `staging.missionkit.io/`. The `X-Robots-Tag` header covers indexing either way; this is noted, not solved, here.
- **Acceptance:** `pnpm landing:verify:staging` (`scripts/verify-landing.mjs --url https://staging.missionkit.io/`): headless Chrome (`--headless=new --dump-dom`, external DNS blocked via `--host-resolver-rules`, same self-containment technique as the original production acceptance gate) asserting `#dc-root`, zero unresolved bindings, a `<video>`, the `mc/dashboard.html` iframe, and no request to a host outside the origin on load. This is a load-time check only. It never clicks anything, so it does not exercise (and does not need to allow) the demo modal's on-interaction `youtube-nocookie.com` request; see the on-interaction exception paragraph above.
- **Promote/rollback safety:** `landing:promote` archives whatever is *currently live* at `missionkit.io` into `.cursor/context/landing-missionkit/releases/<timestamp>/` (zip, gitignored) **before** deploying — fetched over public HTTPS per file (not the Hostinger file-content API, which refuses binary files) so videos/images are captured too. `landing:rollback [release]` redeploys an archived release; with no argument, the immediately previous one. Neither script ever calls `landing:build`.
- **HITL gate (Design-canvas / visual):** Phase 3 of the plan — operator opens `https://staging.missionkit.io`, compares against the Claude Design canvas, approves explicitly. Visual deploys do not promote on a passing `landing:verify:staging` alone.
- **Release-field closeout:** tag CI `sync-landing` may promote after staging HTML field-check (version pill + public blurb). That path is not a Design-canvas compare. Staging hop stays required.
- **Operator-owed first run:** the upload leg (`scripts/lib/hostinger.mjs`'s `uploadFile`) reconstructs an undocumented Hostinger upload sequence (POST pre-create, then a TUS-style `PATCH`) from the vendored `hostinger-api-mcp` package's source, since this sandbox's permission classifier refused every mutating call attempted (subdomain create, adding a vendored dependency) and that refusal was not retried per this repo's worker contract. All read-only calls (website lookup, subdomain listing, DNS zone, file listing) were exercised live against the real account and work as documented; run `pnpm landing:deploy:staging -- --dry-run` first, and have the first real run be operator-attended.

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

Operator path for copy changes: edit Claude Design SoR → Download zip → `pnpm landing:sync` → `pnpm landing:update-release` → `pnpm landing:build` → staging deploy / promote. Do not hand-edit `landing-missionkit/remote/` as the source of truth. Standing `/design` paste template: `.cursor/context/landing-missionkit/CLAUDE-DESIGN-TEMPLATE.md` (New release pill + stamped notes). One-off prompt notes: `.cursor/context/landing-missionkit/UPSTREAM-DESIGN-FIX-PROMPT.md` (license copy + install/prompt clipboard honesty). Do not re-apply `UPSTREAM-DESIGN-FIX-PROMPT-badge-changelog.md`.

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
