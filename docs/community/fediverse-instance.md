# Fediverse instance: comparison and decision record

Mission Kit's fediverse identity is a self-hosted instance on a missionkit.io host, with three accounts (Mission Kit, Outpost, Oligarchy; Colony was renamed Outpost on 2026-11-21) that post release announcements by API. This file compares the server options and lists the operator decisions and steps. Nothing is deployed yet.

Related: [presence](../comms-presence.md), [publish pipeline](../comms-publish-pipeline.md). Record: ADR `2026-11-21_community-presence-discord-and-release-mirror` (Accepted 2026-11-22), decision 10.

Every fact below comes from the project's official docs, checked on **2026-11-21**. "Not stated" means the official page did not say it.

## Comparison

| | Mastodon | GoToSocial |
|---|----------|------------|
| Services | Ruby app with three processes (web, Sidekiq, streaming) behind nginx; PostgreSQL 14+, Redis 7.2+, Node.js, FFmpeg ([README](https://github.com/mastodon/mastodon), [install](https://docs.joinmastodon.org/admin/install/)) | One Go binary; SQLite by default, PostgreSQL for larger instances; no Redis, no separate worker ([getting started](https://docs.gotosocial.org/en/latest/getting_started/)) |
| Resources | RAM, CPU and disk minimums not stated | About 250 to 350 MiB of RAM in use; sizing 1 CPU core, 1 GB RAM, 15 to 20 GB of disk for a few years ([docs](https://docs.gotosocial.org/en/latest/), [getting started](https://docs.gotosocial.org/en/latest/getting_started/)) |
| Posting API | `POST /api/v1/statuses` with a user token and `write:statuses` ([statuses](https://docs.joinmastodon.org/methods/statuses/)) | Mastodon client API ([FAQ](https://docs.gotosocial.org/en/latest/faq/)); status creation needs a user token with `write:statuses`, content type plain text or Markdown ([API spec](https://codeberg.org/superseriousbusiness/gotosocial/src/branch/main/docs/api/swagger.yaml)) |
| App tokens | A client-credentials app token cannot post; one user token per account | Same; a token can also be issued from the settings panel ([settings](https://docs.gotosocial.org/en/latest/user_guide/settings/)) |
| Status | Stable 4.x releases ([releases](https://github.com/mastodon/mastodon/releases)) | Labelled beta; latest release 0.22.3 on 2026-10-21 ([releases](https://codeberg.org/superseriousbusiness/gotosocial/releases)) |
| Moderation | Account actions, domain blocks with import and export, limited federation mode ([moderation](https://docs.joinmastodon.org/admin/moderation/), [config](https://docs.joinmastodon.org/admin/config/)) | Reports, domain blocks and allows with import and export, permission subscriptions, experimental allowlist mode ([admin settings](https://docs.gotosocial.org/en/latest/admin/settings/), [federation modes](https://docs.gotosocial.org/en/latest/admin/federation_modes/)) |
| Backups | PostgreSQL dump, `.env.production`, media ([backups](https://docs.joinmastodon.org/admin/backups/)) | Database (holds the signing keys) and local media ([backup and restore](https://docs.gotosocial.org/en/latest/admin/backup_and_restore/)) |
| Handle on the apex, server on a subdomain | `LOCAL_DOMAIN=missionkit.io`, `WEB_DOMAIN=<subdomain>`; the apex redirects `/.well-known/webfinger`; cannot change later ([config](https://docs.joinmastodon.org/admin/config/)) | `account-domain=missionkit.io`, `host=<subdomain>` before first start; the apex redirects `/.well-known/webfinger`, `host-meta` and `nodeinfo`; cannot change after federating ([host and account domain](https://docs.gotosocial.org/en/latest/advanced/host-account-domain/)) |
| License | AGPL-3.0 | AGPL-3.0 |

Lighter servers (snac2, Akkoma) were looked at; their docs did not confirm API posting and moderation for this use, so they are not compared further.

## Recommendation

GoToSocial. Three accounts that post release announcements need one process, not five: it runs on SQLite in about 1 GB of RAM, documents the apex-handle split, and speaks the Mastodon client API the release mirror needs. The costs are the beta label, the database choice and the domain layout being fixed from the first start, and an experimental allowlist mode. Mastodon gives nothing extra here for the services it needs.

## Operator decisions (asked one at a time)

| Ask id | Question | Labels |
|--------|----------|--------|
| `fediverse-software` | Which server runs the instance? | `GoToSocial (Recommended)` / `Mastodon` / `Defer` |
| `fediverse-host` | Where does it run? | `Existing VPS` / `New VPS` / `Defer` (a new VPS is a spend and joins the credentials round) |
| `fediverse-domain` | Handle and host layout | `@name@missionkit.io on social.missionkit.io (Recommended)` / `@name@social.missionkit.io` / `Defer` |

The domain layout and the database cannot change after the instance federates, so the third Ask is answered before the first start.

**Status (2026-11-21):** `fediverse-software` answered `Defer` by the operator (AskUserQuestion, queue-end gates of `/run-plan-all`): no own instance before Discord and Tier 1 are live. `fediverse-host` and `fediverse-domain` were not asked (moot until the software Ask is reopened). The comparison above stays as the input for that later Ask.

## Operator steps after the decisions

1. DNS: an A or AAAA record for the chosen subdomain; for the apex layout, redirects on missionkit.io for `/.well-known/webfinger` (and `host-meta`, `nodeinfo` for GoToSocial) to the subdomain, without redirecting `/api/`.
2. Deploy per the chosen project's official guide (container or binary), TLS on, backups scheduled before the first account exists.
3. Create the accounts for Mission Kit, Outpost and Oligarchy (handles from [presence](../comms-presence.md)); 2FA where supported; recovery codes in the password manager.
4. One user token per account with `write:statuses` only, stored in the untracked `.env` under the names the release mirror documents.

## Federation check (agent, read-only)

- `https://missionkit.io/.well-known/webfinger?resource=acct:missionkit@missionkit.io` answers (after the redirect) with `subject` `acct:missionkit@missionkit.io` and a `self` link of type `application/activity+json` ([WebFinger spec](https://docs.joinmastodon.org/spec/webfinger/)).
- A search for `@missionkit@missionkit.io` from an account on another instance finds the profile. The result is recorded with the date in [presence](../comms-presence.md).
