# Community presence: handles, accounts and network rules

Where Mission Kit has, or will reserve, an account on each network, under which handle, and what each network allows. Three names are reserved on every network: the suite (Mission Kit, `missionkit`), Outpost and Oligarchy. Colony was renamed Outpost on 2026-11-21 and keeps no handle; "Colony" may survive only as a concept inside the Oligarchy game. Only Tier 1 is actively run; the other tiers keep a complete profile pointing to the site so no account goes stale.

Related: [channel map](comms-channel-map.md) (dispositions and HITL depth), [publish pipeline](comms-publish-pipeline.md) (release mirror and env names), [names and logo](../TRADEMARKS.md). Record: ADR `2026-11-21_community-presence-discord-and-release-mirror` (Accepted 2026-11-22, amended for the rename). The rename of products, packages, repositories and sites is plan `missionkit-rename-2026-11-22`; links below that must work today keep the current URLs until that plan updates them.

The suite and Oligarchy columns were checked on **2026-11-21**. The Outpost column is **not checked** yet: the name changed after that check, and the re-check is owed (see Owed). Availability is read-only evidence from a public URL, never a signup attempt; a handle can be taken between the check and the signup, so the operator re-checks at creation time and this file records the URL that was actually created.

## Rules for every account

- The operator creates every account (terms, CAPTCHA, phone, 2FA). The agent prepares the profile kit and verifies the result by public URL.
- New accounts sign up with `community@missionkit.io`, an alias that forwards to the operator. Existing accounts keep their current owner.
- 2FA seeds and recovery codes live in the operator's password manager, never in git, `.env`, HANDOFF or a plan.
- No fake members, no bots posing as people, no vote coordination. Reddit and Hacker News get participation, not automation.
- An account counts as live only when its public URL is recorded here with a date.

## Names and fallbacks

Bare `oligarchy` is taken on most networks; bare `outpost` has not been checked. Use the first handle in the order below that is free on that network; record the one actually used. The Outpost fallbacks are agent-inferred (same pattern as the suite and Oligarchy rows), not an operator answer.

| Name | First choice | Fallbacks, in order |
|------|--------------|---------------------|
| Suite | `missionkit` | `missionkitio`, `missionkithq` |
| Outpost | `outpost` | `outposthde`, `missionkitoutpost` |
| Oligarchy | `oligarchy` | `oligarchygame`, `playoligarchy` |

## Existing accounts

| Network | Account | Model | Status |
|---------|---------|-------|--------|
| GitHub | [mission-kit](https://github.com/mission-kit) | Organization | Live (created 2026-11-21; type checked with `gh api users/mission-kit` on 2026-11-22). The public repositories move here as `mission-kit/cli` and `mission-kit/outpost` under plan `missionkit-rename-2026-11-22` |
| GitHub | [agent-kit-startup](https://github.com/agent-kit-startup) | Operator's personal account (not an organization) | Live; owns the public `agent-kit` and `colony` repositories until the rename plan transfers them |
| X | [@missionKitAgent](https://x.com/missionKitAgent) | Product account | Live. `missionkit` is taken on X (2026-11-21), so the recommendation is to keep this account; `missionkitio` and `missionkithq` appear free if a rename is ever wanted |
| X, LinkedIn | Operator's personal accounts | Maker accounts | Used as maker accounts; handles are not recorded here |

## Handle matrix

Status words: **taken** (a profile answers at that URL), **free** (the URL answers "not found" while a known account on the same network answers "found", so it appears free), **undetermined** (the network answers the same way for a known account and a random one, or blocks anonymous reads), **n/a** (no global handle on that network).

| Network | Tier | Account model | Suite | Outpost | Oligarchy | Method (2026-11-21) |
|---------|------|---------------|-------|--------|-----------|---------------------|
| Discord | 1 | Operator-owned server | n/a | n/a | n/a (no Oligarchy category) | No handles. The invite URL is recorded after the server exists. A vanity URL needs the `VANITY_URL` guild feature ([guild resource](https://docs.discord.com/developers/resources/guild)); the boost level behind it is not verified |
| GitHub | 1 | Organization `mission-kit` (exists); name reservations as organizations | `missionkit` taken (organization); `missionkitio`, `missionkithq` free | not checked | `oligarchy` taken (user); `oligarchygame`, `playoligarchy` free | `github.com/<h>`: 200 vs 404, calibrated with `agent-kit-startup` and a random handle; type from `api.github.com/users/<h>` |
| X | 1 | Product account (existing) | `missionkit` taken; keep `@missionKitAgent` | not checked | `oligarchy` taken; `oligarchygame`, `playoligarchy` free | `x.com/<h>`: 200 vs 404, calibrated |
| Bluesky | 1 | Organization account | `missionkit.bsky.social` free; domain handle `missionkit.io` not set up | not checked | `oligarchy.bsky.social` taken; `oligarchygame`, `playoligarchy` free | `com.atproto.identity.resolveHandle` on `public.api.bsky.app`: 200 vs 400. Recommended: the `missionkit.io` domain handle (DNS TXT record at signup) |
| Reddit | 1 | `r/missionkit` (operator moderates) plus the operator's account | undetermined | not checked | undetermined | Anonymous reads of `about.json` return 403 for known and random names alike |
| Hacker News | 1 | Operator's personal account only | n/a | n/a | n/a | No brand account (decision 7) |
| Mastodon | 2 | Self-hosted instance on a missionkit.io host | n/a (own instance) | n/a (own instance) | n/a (own instance) | Instance choice is to-do `c8b-mastodon-instance`, deferred 2026-11-21 (`fediverse-software`: `Defer`): no own instance before Discord and Tier 1 are live |
| Threads | 2 | Organization account | undetermined | not checked | undetermined | Known and random handles both answer 200 |
| LinkedIn | 2 | Company page | `company/missionkit` free | not checked | `company/oligarchy` free | `linkedin.com/company/<slug>`: 200 vs 404, calibrated |
| Substack | 2 | Publication | `missionkit` free | not checked | `oligarchy` taken; `oligarchygame`, `playoligarchy` free | `<h>.substack.com`: 200 vs 404, calibrated |
| YouTube | 2 | Channel | `@missionkit` taken (third party); `@missionkitio`, `@missionkithq` free | not checked | `@oligarchy` free | `youtube.com/@<h>`: 200 vs 404 with a browser user agent, calibrated with `@YouTube` |
| dev.to | 2 | Organization plus maker account | `missionkit` free (user and organization) | not checked | `oligarchy` free | `dev.to/api/users/by_username` and `/api/organizations/<h>`: 200 vs 404, calibrated |
| Hashnode | 2 | Blog | undetermined | not checked | undetermined | Profile pages answer 200 for random handles; the public GraphQL endpoint did not answer the lookup |
| Product Hunt | 2 | Maker page on the operator's personal account | undetermined | not checked | undetermined | 403 for known and random handles. Company accounts cannot post ([how to post](https://help.producthunt.com/en/articles/479557-how-to-post-a-product)) |
| daily.dev | 2 | Public Squad | undetermined | not checked | undetermined | Profile URLs redirect; Squad handles not checkable anonymously |
| TabNews | 2 | Account | `missionkit` free | not checked | `oligarchy` free | `tabnews.com.br/api/v1/users/<h>`: 200 vs 404, calibrated |
| Matrix | 3 | Room on matrix.org (or the own homeserver later) | `#missionkit:matrix.org` free | not checked | `#oligarchy:matrix.org` free | Client-server `directory/room` lookup: 200 vs 404, calibrated |
| Libera.Chat | 3 | `#project` channel | undetermined | not checked | undetermined | Registration is checked with ChanServ over IRC, not over HTTP. Project channels need no staff approval ([chanreg](https://libera.chat/chanreg)) |
| Telegram | 3 | Channel | undetermined | not checked | `oligarchy` taken | `t.me/<h>` shows a generic contact page for both unused and private names |
| Instagram | 3 | Professional account | undetermined | not checked | undetermined | Known and random handles both answer 200 |
| TikTok | 3 | Account | undetermined | not checked | undetermined | Known and random handles both answer 200 |
| Farcaster | Web3 | Account plus channel | fname `missionkit` free | not checked | fname `oligarchy` free | `fnames.farcaster.xyz/transfers/current?name=<h>`, calibrated. Channels not checked |
| Lens | Web3 | Account | undetermined | not checked | undetermined | Not checkable anonymously |
| Paragraph | Web3 | Publication | `@missionkit` free | not checked | `@oligarchy` free | `paragraph.com/@<h>`: 200 vs 404, calibrated |
| Nostr | Web3 | Key plus NIP-05 name | n/a | n/a | n/a | No global handle; NIP-05 names are served from `missionkit.io/.well-known/nostr.json` ([NIP-05](https://github.com/nostr-protocol/nips/blob/master/05.md)) |
| ENS | Web3 | `missionkit.eth` | held | held | held | Held with no spend until the Cartesi PoC has something on-chain (decision 11); availability not checked |
| Lobsters | Noted | None | user `missionkit` free | not checked | user `oligarchy` free | Invite-only; no brand account. `lobste.rs/~<h>`: 200 vs 404, calibrated |
| Tildes | Noted | None | user `missionkit` free | not checked | user `oligarchy` free | Invite-only ([register](https://tildes.net/register)); no brand account |
| Stack Overflow | Noted | Tag, not an account | tag `missionkit` does not exist | n/a | n/a | Stack Exchange API `tags/<t>/info` returns no item. Tags are created by usage, not claimed |

## Network rules (verified 2026-11-21)

"Not verified" means the official page did not load or did not state it; it is re-checked before a row depends on it.

| Network | Posting API | Automation and bots | Self-promotion |
|---------|-------------|---------------------|----------------|
| X | Paid per request: a post costs more when it carries a URL, and release posts always do ([pricing](https://docs.x.com/x-api/getting-started/pricing)). Needs a spend Ask before a client is written | Automated accounts carry the "Automated" label and name the operator in the bio; scheduled news posts are allowed; no identical content across accounts ([developer guidelines](https://docs.x.com/developer-guidelines)). The help-center automation page: not verified | n/a |
| Bluesky | Free, app password ([bot tutorial](https://atproto.com/guides/bot-tutorial)) | Bot accounts add a self-label; bulk automated interactions count as spam ([developer guidelines](https://bsky.network/docs/developer-guidelines/)) | No undisclosed commercial content ([community guidelines](https://bsky.social/about/support/community-guidelines)) |
| Reddit | Not verified | Not verified | Not verified |
| Hacker News | None | "Please don't automate posting" ([guidelines](https://news.ycombinator.com/newsguidelines.html)) | Own work part of the time only; Show HN is for something people can run, not minor releases; never ask for upvotes ([Show HN](https://news.ycombinator.com/showhn.html)) |
| Discord | Bot and webhooks; global rate limit ([rate limits](https://docs.discord.com/developers/topics/rate-limits)) | Developer policy: not verified | n/a |
| Mastodon | Free, `POST /api/v1/statuses` with `write:statuses` ([statuses](https://docs.joinmastodon.org/methods/statuses/)) | The bot flag is informational; each instance sets its own rules | Instance rules |
| Threads | Needs App Review for accounts other than the app's testers ([get started](https://developers.facebook.com/docs/threads/get-started), [posts](https://developers.facebook.com/docs/threads/posts)) | Not verified | Not verified |
| LinkedIn page | Community Management API is a vetted product; posting needs `w_organization_social` and a page admin role ([overview](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview)) | Not verified | Not verified |
| Substack | No posting API; the developer API covers public data only ([API terms](https://substack.com/api-tos)) | Not verified | Not verified |
| YouTube | Not used for posting | n/a | n/a |
| dev.to | Free article API ([Forem API](https://developers.forem.com/api/v1)) | Not stated | Content must not be primarily promotion ([terms](https://dev.to/terms)) |
| Hashnode | API publishing needs the paid Pro plan ([GraphQL skill](https://hashnode.com/blog/hashnode-gql-agent-skill), [pricing](https://hashnode.com/pricing)) | Not verified | Not verified |
| Product Hunt | No product-posting endpoint ([API docs](https://api.producthunt.com/v2/docs)) | No bots, no upvote requests ([community guidelines](https://help.producthunt.com/en/articles/3615694-community-guidelines)) | Self-promotion in comments is removed (same page) |
| daily.dev | Not verified | Squads used for spam are removed ([public squads](https://docs.daily.dev/docs/squads/public-squads)) | Same page |
| TabNews | Public API documented only for status ([repository](https://github.com/filipedeschamps/tabnews.com.br)); posting: not verified | Manipulation leads to a ban ([terms](https://www.tabnews.com.br/termos-de-uso)) | No purely commercial posts; builders may post a pitch (same page) |
| Matrix | Open client-server API ([spec](https://spec.matrix.org/latest/client-server-api/)) | Homeserver rules | Room rules |
| Telegram | Free Bot API to a channel by `@username` ([Bot API](https://core.telegram.org/bots/api)) | Per-chat rate limits ([bot FAQ](https://core.telegram.org/bots/faq)) | n/a |
| Instagram | Professional account plus approved publishing permission ([content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)) | Not verified | Not verified |
| TikTok | Unaudited clients post private only; an audit is required ([get started](https://developers.tiktok.com/doc/content-posting-api-get-started)) | Uploading to accounts you manage is not an acceptable use ([sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)) | Same page |
| Farcaster | Signed messages through an app key; accounts pay yearly storage rent ([messages](https://docs.farcaster.xyz/learn/what-is-farcaster/messages)) | Not verified | Not verified |
| Lens | Account owner or manager must post ([post](https://lens.xyz/docs/protocol/feeds/post)) | Not verified | Not verified |
| Paragraph | Not verified | Not verified | Not verified |
| ENS | `.eth` registration is priced per year in the ENSv2 registrar ([ETH registrar](https://docs.ens.domains/ensv2/eth-registrar/)) | n/a | n/a |
| Lobsters | n/a | n/a | Invite-only; self-promotion under a quarter of stories and comments ([about](https://lobste.rs/about)) |

## Release mirror candidates

The release mirror (to-do `c9-native-mirror`) only targets networks with a supported native posting path above:

| Network | Path | Gate before a client is written |
|---------|------|----------------------------------|
| X | Paid API | Spend Ask |
| Bluesky | App password | Account (to-do `c7-tier1-accounts`) |
| Mastodon | Own instance | Instance (to-do `c8b-mastodon-instance`, deferred 2026-11-21) |
| Threads | Threads API | App Review |
| LinkedIn page | Community Management API | Vetted product approval |
| Telegram, Matrix | Bot API, client-server API | Tier 3 hold: only if the operator activates the channel |
| Discord | GitHub repository webhooks into `#releases` ([automation](community/discord-server.md#automation-zero-hosting)) | Server (to-do `c3-discord-create`); ADR open question (a) resolved 2026-11-21: the Release webhooks count as the release mirror |

Not mirrored: Hacker News (never), Reddit (participation only), Substack (no posting API; canonical cross-post by hand), Hashnode (paid plan), Product Hunt (no posting endpoint), Instagram and TikTok (image and video formats, approval or audit; hold tier).

## Owed

- Operator steps: Discord server and GitHub Discussions (to-do `c3-discord-create`), Tier 1 accounts (to-do `c7-tier1-accounts`), Tier 2, Tier 3 and web3 handles (to-do `c8-claim-handles`). Each records its live URL in this file.
- Rows marked undetermined are settled at signup: the operator tries the first-choice handle, then the fallbacks in order.
- Outpost column: re-run the read-only checks above for `outpost`, `outposthde` and `missionkitoutpost` (same methods, dated) before the c7 and c8 signups; until then the operator checks at signup. Colony handles are no longer reserved.
- Credentials round (separate): `community@missionkit.io` alias, Discord bot token, per-network API tokens and app approvals, the X spend Ask, the fediverse host.
