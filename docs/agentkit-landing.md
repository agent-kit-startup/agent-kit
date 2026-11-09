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
# so retired license wording (PolyForm, noncommercial, source-available, sales@, MIT),
# missing Apache-2.0 copy and missing canvas sources fail the Evidence path.

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
# present, video + the Mission Control iframe present. On load the only
# host beyond the page is img.shields.io (HOL trust badge). There is no
# hol.org iframe. The demo modal's youtube-nocookie embed is an opt-in
# exception that only fires if a person clicks to open it: this gate never
# clicks, so it neither tests nor needs to allow that host. See
# "On-interaction exception".

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
4. Seeds the public numbers from the tracked stamp (see "Public numbers (build-time stamp)")

Release version and changelog notes are **not** a build-time feed. They live in the
canvas fields below and are stamped with `pnpm landing:update-release` (does not deploy).

### Release version and product notes

Two existing canvas fields. The hero is the wordmark "Mission Kit", a grey "release" chip, and a cyan version link. There is no "New release" pill and no live GitHub release badge. Product notes are not a `CHANGELOG.md` dump.

Under the hero buttons sit two text links: **Become a contributor** opens the public `docs/CONTRIBUTING.md`, and **Sponsor Mission Kit** opens `https://github.com/sponsors/agent-kit-startup`, a GitHub Sponsors tier checkout (verified 2026-10-19). `.github/FUNDING.yml` names the same account (`github: [agent-kit-startup]`), so the repository Sponsor button and the landing link go to the same place. If the receiving account ever changes, update both in the same change (the canvas href through a Claude Design zip).

| Field | Selector | Content |
|---|---|---|
| Current release | `a[data-release-version]` inside `p.ak-brand` (grey "release" chip + `vX.Y.Z` text) | Visible text `vX.Y.Z` linking to `https://github.com/agent-kit-startup/agent-kit/releases/latest` (public repo, not a tag URL, not `agent-kit-dev`) |
| Product notes | `div[data-changelog-content]` in the Footer CTA `.ak-mc-frame` | Short public product notes. Not a live feed and not `CHANGELOG.md`. |

Stamp (idempotent; fails closed if the fields are missing, if notes look like a changelog dump, or if the URL is not the public `releases/latest` URL):

```bash
node scripts/public-changelog.mjs --version 5.6.0 --blurb
pnpm landing:update-release -- --version 5.6.0 --notes "Short public product notes."
pnpm landing:update-release -- --version 5.6.0 --notes-file ./public-release-notes.txt
pnpm landing:update-release -- --version 5.6.0 --notes "Short public product notes." --dry-run
```

`--blurb` is the stamp-safe `publicNotesBlurb` (heading-free, under 1000 characters). Never pass `CHANGELOG.md` as `--notes-file`.

Then `pnpm landing:build`. Deploy stays `landing:deploy:staging` / `landing:promote`.

**Release closeout (autonomous):** after public GitHub Release Latest exists for `vX.Y.Z`, private tag CI job `sync-landing` runs `node scripts/sync-landing-release.mjs` (same stamp + staging hop + promote). It fails if Latest does not match, `HOSTINGER_API_TOKEN` is unset, or live HTML would stay stale. Manual retry: Actions workflow_dispatch `sync_landing` (optional `landing_version`). Local: `pnpm landing:sync-release -- --version X.Y.Z`. This does not merge the public sync PR and does not skip the staging hop. Design-canvas visual deploys stay on `/kit-staging` HITL.

`landing:sync` overwrites `remote/` wholesale. Re-run `landing:update-release` after a Design zip so the two fields are not reverted to a live badge or an empty box. The numbers stamp lives outside `remote/` and survives a sync.

### Public numbers (build-time stamp)

GitHub stars for `agent-kit-startup/agent-kit` and npm monthly downloads for `@dadado/agent-kit-cli` come from a tracked stamp, `.cursor/context/landing-missionkit/numbers.json` (schema 1: `stampedAt`, `githubStars`, `npmDownloadsLastMonth`). `landing:build` injects it into `dist/` only and never edits the canvas:

- every `span[data-star-count]` gets `data-value`, `data-stamped` and a `title` ("GitHub stars as of YYYY-MM-DD"). The canvas logic `fetchStars()` already reads `[data-star-count][data-value]` as its starting value.
- a `<script type="application/json" id="mk-numbers">` block before `</head>` carries the whole stamp for a later numbers strip.

The build fails if the stamp is missing or invalid, or if the canvas has no star chip. `verify-landing` fails if the hydrated DOM lacks a seeded chip or a valid `#mk-numbers` block.

```bash
pnpm landing:update-numbers                    # fetch both numbers live, stamp today (UTC)
pnpm landing:update-numbers -- --dry-run       # print only
pnpm landing:update-numbers -- --stars 20 --downloads 4802 --date 2026-10-19   # offline override
```

`GITHUB_TOKEN` (environment only, never written) raises the GitHub API rate limit. Re-stamp before a landing deploy you want fresh numbers on, then commit the JSON. The stamp is not wired into tag CI `sync-landing` yet.

Known gap: the canvas still fetches `api.github.com` at load to refresh the star count, and `verify-landing` treats that host as noise. Proposed ADR `decisions/2026-10-19_missionkit-landing-soft-onboarding-engine-numbers-waitlist-prompt.md` item (b) removes the runtime fetch through Claude Design. After that sync, `api.github.com` leaves `IGNORED_NOISE_HOSTS`. Showing the stamp date visibly is also a Design change; today it is only the chip `title`.

### On-load vs on-interaction requests

Everything the build ships is self-contained **on load** except the HOL guard
badge, which requests `img.shields.io` on purpose. Version stays a static
`data-release-version` link. There is no live GitHub release badge
(`img.shields.io/github/...`). `landing:build` and `landing:update-release`
allow only the HOL guard endpoint and still reject any other `img.shields.io`
URL. See ADR `decisions/2026-08-05_landing-external-design-source-of-record.md`
(2026-08-27 addendum). Visual or copy changes to the marketing canvas still go through
Claude Design, then re-export and `landing:sync`. The two release fields above are
the sanctioned stamp via `landing:update-release` (re-run after every sync).

`verify-landing` blocks other hosts with `--host-resolver-rules` (`MAP * ~NOTFOUND`,
excluding the page host and localhost). The net-log allowlist is the page host,
`img.shields.io`, and `--allow-host` extras. `update.googleapis.com` and
`api.github.com` are ignored browser/GitHub noise, same class as Chrome's own
telemetry hosts. Any other third-party host still fails. There is no `hol.org`
iframe exception. The landing build sets no Content-Security-Policy.

**On-interaction exception:** the demo video modal mounts a `youtube-nocookie.com`
iframe, but only when a person clicks to open it. `demoSrc` defaults to `''` and the
modal (iframe included) is not in the DOM at all until `demoOpen` is true
(`<sc-if value="{{ demoOpen }}">`), so first paint does not request
`youtube-nocookie.com` (fixed 2026-08-05, `85a9e61`). This is expected, deliberate
behavior, not a defect: a video demo has to come from somewhere. The acceptance
line is "on load, the only page host outside the origin is `img.shields.io`; opening
the demo modal is a user-opted exception to `youtube-nocookie.com`", not an
unqualified "no request outside origin," which the page was never trying to
guarantee for every possible click.

## Other sites (`--site`)

The same scripts build two more Claude Design pages for the Colony launch
(plan `colony-oligarchy-sites-2026-11-01`). The site table lives in
`scripts/lib/landing-sites.mjs`; `missionkit` is the default and its path is unchanged.

| Site | Page (mirror file) | Served at | Staging |
|---|---|---|---|
| `colony` | `Mission Kit Colony Landing.dc.html` | `https://colony.missionkit.io/` | `https://colony-staging.missionkit.io/` |
| `oligarchy` | `Oligarchy Landing.dc.html`, `Oligarchy Game.dc.html` | `https://oligarchy.missionkit.io/`, the trial at `/game/` | `https://oligarchy-staging.missionkit.io/` |

Mirrors: `.cursor/context/landing-colony/remote/` and `.cursor/context/landing-oligarchy/remote/`
(dist/ and releases/ next to them are gitignored). `Oligarchy Design System.dc.html` is
mirrored as reference only, never built or deployed.

```bash
pnpm landing:sync -- --site colony "~/Downloads/Mission Kit Colony Landing.zip"
pnpm landing:media -- --site colony            # after every sync: optimized/ store (ffmpeg, magick)
pnpm landing:build -- --site oligarchy          # landing:build:check -- --site oligarchy
pnpm landing:serve -- --site oligarchy          # http://127.0.0.1:4173/ and /game/
node scripts/verify-landing.mjs --site oligarchy # serves dist itself, checks every page
pnpm landing:deploy:staging -- --site colony    # colony-staging/ only
pnpm landing:verify:staging:colony
pnpm landing:promote -- --site colony --yes-production   # operator yes only
```

- **Sync** extracts the untrusted zip into a temp dir (absolute and `..` entries are refused),
  then copies only the site's pages, `support.js` and the `assets/` files the pages reference:
  literal `assets/…` paths (must exist in the zip), quoted prefixes joined at runtime
  (`'assets/card-' + id`), and asset stems that appear as quoted literals
  (`img: 'uplink-tower-road'`). `uploads/`, `shots/`, `CLAUDE.md`, `github.md` and the old
  designs never reach the mirror. React is vendored as for missionkit. The upstream prompt
  guard reads `.cursor/context/landing-<id>/UPSTREAM-DESIGN-FIX-PROMPT.md`.
- **Build** treats each page like missionkit's canvas: React on `window`, its own
  precompiled `dc-logic.js`, static head with the page's canonical and absolute
  `og:image` / `twitter:image` (the Game has none in its canvas, so it gets the site's
  `assets/og-cover.png`). The helmet's own canonical is dropped (Colony's lacks the
  trailing slash). These exports ship the stock runtime, so the build also stubs the
  x-import compile; no request goes to unpkg (React, Babel) at load.
- **Nested pages.** A page whose `out` sits below the root (`game/index.html`) gets its
  asset, vendor and logic references rewritten to root-absolute (`/assets/…`) in the HTML
  and in its own `dc-logic.js`; links to another built page by its design-file name point
  at that page's route. No `<base href>`: it would break the in-page `#anchor` links. The
  Oligarchy trial at `/game/` is the one page built this way. The Landing's `#demo` iframe
  points at `/game/`, so a Landing load makes one extra HTML request to it before hydration.
- **Colony link.** The build fails if a page holds any `colony:` URL other than exactly
  `colony://play`. A page with that link also fails if it listens for `blur`,
  `visibilitychange` or `pagehide`, or says Colony was found, detected, connected or missing,
  because a page cannot tell whether the scheme is registered (ADR
  `2026-11-06_oligarchy-game-handoff-colony-scheme`). `verify-landing` needs no exception: it
  only looks at requests, and a link is a navigation the visitor starts. The Game page's link
  is designed behind a `colonyLink` prop that exports at `off`, and a test fails if an export
  changes that default. A transform turns it on only once a Colony release answers the link
  (`g4-site-wire`).
- **Redirects** come from the site table: `Redirect 302` for a prefix (colony
  `/install.sh`), `RedirectMatch 302 ^…$` for an exact path (`exact: true`, no site uses
  it today). Serve answers them locally and verify checks each one against the resolved
  `Location`.
- **Verify** (`--site`) checks every page: `#dc-root`, no `{{ }}`, no runtime banner, no
  `sc-if`/`sc-for`, exactly one canonical equal to the page's, no request beyond the page's
  own origin (no shields.io allowance), and every same-origin request 2xx. Fetches of a
  literal `{{ binding }}` URL are logged, not failed: dc-runtime reads its template from the
  live `<x-dc>`, so the parser requests `<img src="{{ c.card }}">` once before hydration.
- **Deploy and promote** upload per file into the subdomain directory (`colony-staging/`,
  `colony/`, `oligarchy-staging/`, `oligarchy/`) of the missionkit.io hosting account; every
  remote path is checked to stay inside it. They never create subdomains or DNS (all four
  exist) and never call the Hostinger deploy trigger, which overwrites the missionkit.io root.
  Staging adds a noindex `.htaccess` and a `Disallow: /` robots.txt. Promote refuses without
  `--yes-production`, archives what the live host serves first and writes an upload manifest
  to `.cursor/context/landing-<id>/releases/`. `landing:rollback` is missionkit-only and
  refuses `--site colony|oligarchy`; roll those back by re-promoting a known-good build.
- **Untrusted export.** Sync refuses a zip with symlink entries, or more than 512 MB / 4000
  entries to extract (missionkit's sync runs the same name and symlink checks). Assets must
  be static media (png, jpg, webp, gif, svg, ico, mp4, webm, woff2, ttf, css, json; no
  dotfiles); sync, build and the per-file upload all refuse anything else. Uploads go
  assets and runtime first, `.htaccess` next, the HTML last.
- **`/install.sh` rule.** `https://colony.missionkit.io/install.sh` must keep answering a 302
  to `https://github.com/agent-kit-startup/colony/releases/latest/download/install.sh`.
  Every generated colony `.htaccess` (staging and production) carries
  `Redirect 302 /install.sh …`, the local serve answers the same 302, and
  `verify-landing --site colony` fails if the redirect is missing.

### Page transforms and the optimized media store

The mirror stays the export as-is (ADR 2026-08-05). Two build-time layers sit on top of it,
both committed and both colony/oligarchy only (missionkit has neither):

- **Page transforms** (`page.transforms: [{ find, replace, why }]` in
  `scripts/lib/landing-sites.mjs`) run on the raw canvas before asset selection, logic
  extraction and head injection. Each `find` must occur exactly once, or the build fails,
  names the transform and points at
  `.cursor/context/landing-<id>/UPSTREAM-DESIGN-FIX-PROMPT-launch-2026-11-01.md`, the design-side
  fix. Launch set (2026-11-01): the Oligarchy Landing's `signIn` defaults to `GitHub only` (no
  email field) and "Continue with GitHub" opens `https://github.com/agent-kit-startup/colony`;
  all three pages load `assets/card-mech-factory.webp` instead of the 1.5 MB PNG (the
  Landing's three runtime card lists drop their `'.png'` special case); the Landing's hero `<video>` gets `poster="assets/oligarchy-hero-poster.jpg"`. Once an
  export carries a fix, its `find` is gone: drop the transform in the PR that syncs that export.
  One transform is kit-side on purpose, with no design-side fix to wait for: the Landing's three
  Play buttons change from `https://oligarchy.missionkit.io/game/` to `/game/`, so a visitor stays
  on the host they are on and a staging review plays the staging build.
- **Optimized store** (`.cursor/context/landing-<id>/optimized/assets/…` plus
  `optimized/manifest.json`), written by `pnpm landing:media -- --site <id>`
  (`scripts/media-landing.mjs`, the only landing step that runs ffmpeg / ImageMagick). Only
  assets the built pages reference count: every `.mp4` loses its audio track and metadata
  (video stream copied, moov kept first); `.jpg` over 700 KB goes to 2400 px on the long edge
  at quality 82; `.png` over 700 KB is recompressed at most 2400 px and kept only if 15%
  smaller (otherwise listed under `skipped`); derived files the site declares
  (`media.derived`: `card-mech-factory.webp` from the PNG, `oligarchy-hero-poster.jpg` from
  frame 0) are made when a page references them. A derived file wins over a mirror file of the
  same name (oligarchy's mirror still carries the older 640×300 mech-factory WebP).
- **Build** ships the store file when its manifest entry's `source_sha256` matches the current
  mirror file (and the store file still matches its `sha256`), and fails with
  "mirror changed, run pnpm landing:media -- --site <id>" when it does not. An entry whose
  `command` differs from what the current rule and parameters give (a changed `MAX_EDGE` or
  quality, or a derived file's `rule` in the site table) fails the same way, as does a
  `skipped` record made under another rule. It also fails when a
  page references a derived file the store lacks, or ships a file a rule selects that the store
  does not cover. `landing:build:check` stays a byte comparison and needs neither tool.
- **When to re-run `landing:media`:** after every `landing:sync` of the site, then
  `landing:build`, and commit `optimized/` with the mirror. Regenerating on the same tool
  versions gives identical bytes (checked 2026-11-01 with ffmpeg n9.0.2 and ImageMagick
  7.1.2-34, recorded in the manifest); other versions may not, which is why the store is
  committed and the build never re-encodes.

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
- **Acceptance:** `pnpm landing:verify:staging` (`scripts/verify-landing.mjs --url https://staging.missionkit.io/`): headless Chrome (`--headless=new --dump-dom`, external DNS blocked via `--host-resolver-rules`, same self-containment technique as the original production acceptance gate) asserting `#dc-root`, zero unresolved bindings, a `<video>`, the `mc/dashboard.html` iframe, and no unexpected request host on load. `img.shields.io` is allowed (HOL guard badge). `update.googleapis.com` and `api.github.com` are ignored noise. This is a load-time check only. It never clicks anything, so it does not exercise (and does not need to allow) the demo modal's on-interaction `youtube-nocookie.com` request; see the on-interaction exception paragraph above.
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

License copy is Apache-2.0 (ADR `2026-10-08_open-source-apache-2-dco-relicense`). The canvas carries it since the 2026-10-10 Design sync (latest canvas `MissionKit Landing v2.dc.html` promoted to the canonical name). Live `missionkit.io` shows it after the next release sync deploys the landing.

- **Description / Twitter:** AI harness with built-in Project Management and DevSecOps that fits in any existing workflow. (no license wording)
- **CTA:** Free and open source (Apache-2.0), and it runs inside the IDE you already use.
- **Footer meta:** free & open source (Apache-2.0)

`pnpm landing:build` fails when the export names PolyForm, noncommercial, source-available, `sales@missionkit.io` or MIT, or does not name Apache-2.0 (`scripts/lib/landing-license-copy.mjs`). The design project holds several canvas versions: edit the latest one, and promote it to `remote/MissionKit Landing.dc.html` after `landing:sync` (rename only). Keep the repo's `remote/support.js`: the build expects its `evalDcLogic` stub, and the HOL plugin scan rejects the export's runtime compile.

Other crawler fields matching the build pipeline:

- **Title:** Mission Kit 5 · Development operations built into Cursor and VS Code
- **Favicon:** `assets/logo.svg` (SVG, also `apple-touch-icon`)
- **Open Graph image:** `assets/hero-astronaut.png` (absolutized to `https://missionkit.io/assets/hero-astronaut.png` in crawler head)
- **Twitter Card:** `summary_large_image` with title, description, and image

Operator path for copy changes: edit Claude Design SoR → Download zip → `pnpm landing:sync` → `pnpm landing:update-release` → `pnpm landing:build` → staging deploy / promote. Do not hand-edit `landing-missionkit/remote/` as the source of truth. Standing `/design` paste template: `.cursor/context/landing-missionkit/CLAUDE-DESIGN-TEMPLATE.md` (grey "release" chip, `a[data-release-version]` to `releases/latest`, HOL guard badge in the link column, no `hol.org` embed). One-off prompt notes: `.cursor/context/landing-missionkit/UPSTREAM-DESIGN-FIX-PROMPT.md` (SEO, clipboard, license copy, and the HOL guard badge tasks are checked). Do not re-apply `UPSTREAM-DESIGN-FIX-PROMPT-badge-changelog.md`.

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
