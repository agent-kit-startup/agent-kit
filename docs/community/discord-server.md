# Mission Kit Discord server spec

The source of truth for the Mission Kit Discord server: categories, channels, roles, permission overwrites, onboarding, AutoMod, rules text, pinned messages and server art. The server is operator-owned and is not created yet (to-do `c3-discord-create`). A provisioning script (to-do `c4-discord-populate`) reads the machine-readable block at the end of this file and converges the server to it; a change to the server is a change to this file first.

Related: [channel map](../comms-channel-map.md), [presence](../comms-presence.md), [publish pipeline](../comms-publish-pipeline.md), [Code of Conduct](../../.github/CODE_OF_CONDUCT.md), [support](../../.github/SUPPORT.md), [names and logo](../../TRADEMARKS.md).

Names follow ADR `2026-11-21_community-presence-discord-and-release-mirror` as amended on 2026-11-21: the desktop app is Outpost (renamed from Colony). Links in the rules and pins (Code of Conduct, Support, Contributing, the public repository) keep the current `agent-kit-startup/agent-kit` URLs because they must resolve today; plan `missionkit-rename-2026-11-22` updates them after the repositories move to `mission-kit`, and the next provisioning run converges the pins.

## Principles

- English is the primary language; `#pt-br` is the one channel for Portuguese.
- Q&A that others should find later belongs in GitHub Discussions; bugs belong in Issues; Discord is for chat, quick help and show-and-tell.
- No Oligarchy category: the Oligarchy community home is outside this server.
- No fake members and no bots posing as people. The only bot is the Mission Kit application, labelled as an app by Discord, used for provisioning and the release feed.
- Read-only channels carry only maintainer posts, the release mirror and repository webhooks. Every authored maintainer post keeps the per-post Ask from the [publish pipeline](../comms-publish-pipeline.md).
- Discord's own requirements (Community features, onboarding minimums, forum and announcement channel rules) are checked by the provisioning dry run against the API; this file does not restate them.

## Layout

| Category | Channel | Type | Who can post | Purpose |
|----------|---------|------|--------------|---------|
| Start here | `#welcome` | text | Maintainers | What Mission Kit is, where to go, links |
| Start here | `#rules` | text | Maintainers | Rules (text below); the server's rules channel |
| Start here | `#announcements` | announcement | Maintainers | Authored news, each post after an Ask |
| Start here | `#releases` | announcement | Maintainers, the bot, repository webhooks | Release feed: one post per public release |
| Help | `#support` | forum | Everyone | Quick help with tags; points to Discussions and Issues |
| Products | `#cli` | text | Everyone | Agent Kit CLI, slash commands, plans |
| Products | `#mission-control` | text | Everyone | The Mission Control dashboard |
| Products | `#outpost` | text | Everyone | The Outpost desktop app |
| Community | `#show-and-tell` | text | Everyone | What you built with Mission Kit |
| Community | `#contributors` | text | Everyone | Working on the kit: PRs, skills, docs |
| Community | `#pt-br` | text | Everyone | Conversa em português |
| Community | `#off-topic` | text | Everyone | Anything else, within the rules |
| Moderation | `#mod-log` | text | Hidden; AutoMod alerts and Discord's community updates | Moderation record |
| Moderation | `#moderators` | text | Hidden; maintainers and moderators | Moderator coordination |

## Roles

| Role | How it is granted | Notes |
|------|-------------------|-------|
| Maintainer | By the operator | Manages channels, messages and members; posts in read-only channels |
| Moderator | By a maintainer | Manages messages and threads, times members out; no server settings |
| Contributor | By a maintainer, after a merged contribution | Display only, no extra permissions |
| CLI, Mission Control, Outpost | Self-assigned in onboarding | Interest roles; no extra permissions |
| pt-br | Self-assigned in onboarding | Interest role; no extra permissions |
| Release pings | Self-assigned in onboarding | Opt-in to mentions in `#releases`; only maintainers and the bot may mention it |
| Mission Kit Bot | The bot's managed role | Least privilege for provisioning and the release feed (below) |

`@everyone` can read the server, send messages, use threads and reactions in open channels, attach files and embed links. It cannot mention `@everyone` or roles, manage anything, or post in read-only channels.

## Bot application (least privilege)

The operator creates the application in the Discord Developer Portal (to-do `c3-discord-create`) with the `bot` scope only, no `applications.commands`, no privileged gateway intents. Discord lets a bot grant a role, or allow or deny in a channel overwrite, only the permissions the bot itself holds ([permissions](https://docs.discord.com/developers/topics/permissions), [channel resource](https://docs.discord.com/developers/resources/channel)), and the AutoMod timeout action needs Moderate Members ([auto moderation](https://docs.discord.com/developers/resources/auto-moderation)). So during provisioning the bot role holds every permission the spec grants, plus Manage Channels, Manage Roles, Manage Webhooks and Manage Server (the `botPermissions` list in the block below; the script refuses a spec where that list misses one), and the bot role sits above the roles it manages. After the first converged run the operator lowers the role to View Channels, Send Messages, Embed Links and Read Message History for the release feed. The token lives in the operator's untracked `.env` as `MISSION_KIT_DISCORD_BOT_TOKEN`, the server id as `MISSION_KIT_DISCORD_GUILD_ID` ([publish pipeline](../comms-publish-pipeline.md) env contract). The provisioning script is `.cursor/scripts/discord-provision.mjs`.

## Onboarding

1. **What are you here for?** (multiple choice) CLI and plans -> role CLI, `#cli`; Mission Control -> role Mission Control, `#mission-control`; Outpost -> role Outpost, `#outpost`; Contributing -> `#contributors`.
2. **Language** (single choice) English -> no role; Português -> role pt-br, `#pt-br`.
3. **Release pings** (single choice) Yes -> role Release pings; No -> no role.

Default channels for everyone: `#welcome`, `#rules`, `#announcements`, `#releases`, `#support`, `#show-and-tell`, `#off-topic`.

## AutoMod

| Rule | Trigger | Action |
|------|---------|--------|
| Mention spam | More than 5 unique mentions in a message | Block, alert `#mod-log`, time out 10 minutes |
| Spam content | Discord's spam filter | Block, alert `#mod-log` |
| Harmful language | Discord's preset lists (profanity, sexual content, slurs) | Block, alert `#mod-log` |
| Scam links | Keyword list: fake gift and fake support phrases (list in the block below) | Block, alert `#mod-log` |

Maintainers and moderators are exempt from the keyword rules.

## Rules text (`#rules`)

> **Mission Kit community rules**
>
> 1. Follow the [Code of Conduct](https://github.com/agent-kit-startup/agent-kit/blob/main/.github/CODE_OF_CONDUCT.md). Be kind, assume good intent, no harassment.
> 2. Stay on topic per channel. Off-topic chat goes to `#off-topic`.
> 3. Questions others will search for later go to GitHub Discussions; bugs go to Issues. See [Support](https://github.com/agent-kit-startup/agent-kit/blob/main/.github/SUPPORT.md).
> 4. Never post secrets, tokens or private repository content. Security reports follow `SECURITY.md`, never a public channel.
> 5. No spam, no unsolicited DMs, no vote or star requests.
> 6. English in every channel except `#pt-br`.
>
> Moderators may remove messages and time out or remove members who break these rules.

## Pinned messages

Each pin is posted by the bot during the provisioning run, after the operator's apply Ask. Pins that contain `{{discussionsUrl}}` or `{{inviteUrl}}` stay unposted until those URLs are verified and recorded in [presence](../comms-presence.md).

| Channel | Pin |
|---------|-----|
| `#welcome` | What Mission Kit is (one paragraph), links to missionkit.io, the public repository, getting started, and the channel guide |
| `#rules` | The rules text above |
| `#releases` | How the feed works: one post per public release, nothing else |
| `#support` | Forum guidelines: tag your post; searchable Q&A in Discussions; bugs in Issues with `doctor --json` output |
| `#contributors` | Contributing guide and how the Contributor role is granted |
| `#pt-br` | O que é o canal e onde reportar bugs |

## Automation (zero hosting)

Everything below runs on Discord's and GitHub's own servers: no bot process to host, no secret in CI.

| Need | Mechanism | Who sets it up | Posts authored text? |
|------|-----------|----------------|----------------------|
| Release feed in `#releases` | A Discord channel webhook on `#releases`, added as a GitHub repository webhook on `mission-kit/cli` and `mission-kit/outpost` (today `agent-kit-startup/agent-kit` and `agent-kit-startup/colony`, until plan `missionkit-rename-2026-11-22` transfers them) with Discord's GitHub-compatible endpoint (the webhook URL plus `/github`), subscribed to the `release` event only ([webhook resource](https://docs.discord.com/developers/resources/webhook)) | Operator | No: GitHub's release event, rendered by Discord |
| Moderation | Native AutoMod rules from the spec, applied by `discord-provision.mjs` | Script, after the apply Ask | No |
| Q&A | The `#support` forum pin links GitHub Discussions; searchable answers live there | Script, after Discussions is enabled | No (pin text is in this spec) |
| Onboarding and roles | Discord onboarding, from the spec | Operator (printed by the script) | No |

### Release feed setup (operator steps)

1. In Discord, `#releases` > Edit Channel > Integrations > Webhooks > New Webhook, named `GitHub releases`. Copy its URL. The URL is a secret: anyone holding it can post to the channel. It stays in Discord and in GitHub's webhook settings only; it is never committed, pasted into a plan, HANDOFF or chat, or stored in CI.
2. In GitHub, for each public repository (`mission-kit/cli` and `mission-kit/outpost`; before the transfer they are still `agent-kit-startup/agent-kit` and `agent-kit-startup/colony`, so a hook added now is added there and re-checked in Settings > Webhooks after the transfer): Settings > Webhooks > Add webhook. Payload URL: the Discord URL followed by `/github`. Content type `application/json`. "Let me select individual events": **Releases** only. Active.
3. GitHub's Recent Deliveries for the hook shows the ping delivered. The first real check is the next public release: one post in `#releases`, recorded with its link in [presence](../comms-presence.md).

This feed posts GitHub's own release event and no authored text. It counts as part of the release mirror and needs no per-post Ask, limited to Release events (open question (a) of ADR `2026-11-21_community-presence-discord-and-release-mirror`, resolved at the accept on 2026-11-21).

### Hosted bot: not now

No requirement left needs a running bot: the release feed is a webhook, moderation is AutoMod, Q&A lives in GitHub Discussions, and roles come from onboarding. The [Grok community manager](../grok-community-manager.md) stays an operator-run triage and drafting tool outside this server. A hosted bot comes back only for a requirement these mechanisms cannot meet, and hosting it on a VPS is its own operator Ask. Anything that would post authored text keeps the per-post Ask.

## Server art

- Icon: `.claude-plugin/icon.png` (1024 x 1024, the helmet mark).
- Banner and invite splash: the suite home cover (`https://missionkit.io/assets/og-cover.png`, 1200 x 630), used only when the server has the banner feature.
- Use follows [names and logo](../../TRADEMARKS.md): the project's own marks, unmodified.

## Machine-readable spec

The provisioning script reads only the JSON between the two markers. Keys are stable identifiers; `name` is what Discord shows. Permission names are Discord permission flag names.

<!-- discord-spec:begin -->
```json
{
  "version": 1,
  "server": {
    "name": "Mission Kit",
    "description": "Chat and quick help for Mission Kit: the Agent Kit CLI, Mission Control and Outpost.",
    "preferredLocale": "en-US",
    "verificationLevel": "medium",
    "explicitContentFilter": "all_members",
    "defaultMessageNotifications": "only_mentions",
    "icon": ".claude-plugin/icon.png",
    "banner": "https://missionkit.io/assets/og-cover.png",
    "rulesChannel": "rules",
    "publicUpdatesChannel": "mod-log"
  },
  "everyone": {
    "permissions": ["VIEW_CHANNEL", "SEND_MESSAGES", "SEND_MESSAGES_IN_THREADS", "CREATE_PUBLIC_THREADS", "READ_MESSAGE_HISTORY", "ADD_REACTIONS", "EMBED_LINKS", "ATTACH_FILES", "USE_EXTERNAL_EMOJIS"]
  },
  "roles": [
    { "key": "maintainer", "name": "Maintainer", "color": "#4F7CFF", "hoist": true, "mentionable": false, "permissions": ["MANAGE_CHANNELS", "MANAGE_ROLES", "MANAGE_MESSAGES", "PIN_MESSAGES", "MANAGE_THREADS", "MODERATE_MEMBERS", "KICK_MEMBERS", "BAN_MEMBERS", "MENTION_EVERYONE", "VIEW_AUDIT_LOG"] },
    { "key": "moderator", "name": "Moderator", "color": "#2BB673", "hoist": true, "mentionable": false, "permissions": ["MANAGE_MESSAGES", "PIN_MESSAGES", "MANAGE_THREADS", "MODERATE_MEMBERS", "VIEW_AUDIT_LOG"] },
    { "key": "contributor", "name": "Contributor", "color": "#F2A93B", "hoist": false, "mentionable": false, "permissions": [] },
    { "key": "cli", "name": "CLI", "color": null, "hoist": false, "mentionable": false, "permissions": [] },
    { "key": "mission-control", "name": "Mission Control", "color": null, "hoist": false, "mentionable": false, "permissions": [] },
    { "key": "outpost", "name": "Outpost", "color": null, "hoist": false, "mentionable": false, "permissions": [] },
    { "key": "pt-br", "name": "pt-br", "color": null, "hoist": false, "mentionable": false, "permissions": [] },
    { "key": "release-pings", "name": "Release pings", "color": null, "hoist": false, "mentionable": false, "permissions": [] }
  ],
  "categories": [
    {
      "key": "start-here",
      "name": "Start here",
      "channels": [
        { "key": "welcome", "name": "welcome", "type": "text", "topic": "Start here: what Mission Kit is and where to go.", "readOnly": true },
        { "key": "rules", "name": "rules", "type": "text", "topic": "Community rules. Code of Conduct applies everywhere.", "readOnly": true },
        { "key": "announcements", "name": "announcements", "type": "announcement", "topic": "News from the maintainers.", "readOnly": true },
        { "key": "releases", "name": "releases", "type": "announcement", "topic": "One post per public release.", "readOnly": true, "allowBot": true }
      ]
    },
    {
      "key": "help",
      "name": "Help",
      "channels": [
        { "key": "support", "name": "support", "type": "forum", "topic": "Quick help. Searchable Q&A goes to GitHub Discussions, bugs to Issues.", "tags": ["install", "cli", "plans", "mission-control", "outpost", "other"] }
      ]
    },
    {
      "key": "products",
      "name": "Products",
      "channels": [
        { "key": "cli", "name": "cli", "type": "text", "topic": "Agent Kit CLI, slash commands and plans." },
        { "key": "mission-control", "name": "mission-control", "type": "text", "topic": "The Mission Control dashboard." },
        { "key": "outpost", "name": "outpost", "type": "text", "topic": "The Outpost desktop app." }
      ]
    },
    {
      "key": "community",
      "name": "Community",
      "channels": [
        { "key": "show-and-tell", "name": "show-and-tell", "type": "text", "topic": "What you built with Mission Kit." },
        { "key": "contributors", "name": "contributors", "type": "text", "topic": "Working on the kit: PRs, skills, docs." },
        { "key": "pt-br", "name": "pt-br", "type": "text", "topic": "Conversa em português." },
        { "key": "off-topic", "name": "off-topic", "type": "text", "topic": "Anything else, within the rules." }
      ]
    },
    {
      "key": "moderation",
      "name": "Moderation",
      "hidden": true,
      "visibleTo": ["maintainer", "moderator"],
      "channels": [
        { "key": "mod-log", "name": "mod-log", "type": "text", "topic": "AutoMod alerts and Discord community updates." },
        { "key": "moderators", "name": "moderators", "type": "text", "topic": "Moderator coordination." }
      ]
    }
  ],
  "readOnlyPosters": ["maintainer"],
  "botPermissions": ["VIEW_CHANNEL", "SEND_MESSAGES", "SEND_MESSAGES_IN_THREADS", "CREATE_PUBLIC_THREADS", "READ_MESSAGE_HISTORY", "ADD_REACTIONS", "EMBED_LINKS", "ATTACH_FILES", "USE_EXTERNAL_EMOJIS", "PIN_MESSAGES", "MANAGE_MESSAGES", "MANAGE_THREADS", "MANAGE_CHANNELS", "MANAGE_ROLES", "MANAGE_WEBHOOKS", "MANAGE_GUILD", "MODERATE_MEMBERS", "KICK_MEMBERS", "BAN_MEMBERS", "MENTION_EVERYONE", "VIEW_AUDIT_LOG"],
  "onboarding": {
    "defaultChannels": ["welcome", "rules", "announcements", "releases", "support", "show-and-tell", "off-topic"],
    "prompts": [
      { "key": "interest", "title": "What are you here for?", "singleSelect": false, "options": [
        { "title": "CLI and plans", "roles": ["cli"], "channels": ["cli"] },
        { "title": "Mission Control", "roles": ["mission-control"], "channels": ["mission-control"] },
        { "title": "Outpost", "roles": ["outpost"], "channels": ["outpost"] },
        { "title": "Contributing", "roles": [], "channels": ["contributors"] }
      ] },
      { "key": "language", "title": "Language", "singleSelect": true, "options": [
        { "title": "English", "roles": [], "channels": [] },
        { "title": "Português", "roles": ["pt-br"], "channels": ["pt-br"] }
      ] },
      { "key": "release-pings", "title": "Ping me on new releases?", "singleSelect": true, "options": [
        { "title": "Yes", "roles": ["release-pings"], "channels": [] },
        { "title": "No", "roles": [], "channels": [] }
      ] }
    ]
  },
  "automod": [
    { "key": "mention-spam", "name": "Mention spam", "trigger": "mention_spam", "mentionLimit": 5, "actions": ["block", "alert:mod-log", "timeout:600"], "exemptRoles": [] },
    { "key": "spam", "name": "Spam content", "trigger": "spam", "actions": ["block", "alert:mod-log"], "exemptRoles": [] },
    { "key": "harmful-language", "name": "Harmful language", "trigger": "keyword_preset", "presets": ["profanity", "sexual_content", "slurs"], "actions": ["block", "alert:mod-log"], "exemptRoles": ["maintainer", "moderator"] },
    { "key": "scam-links", "name": "Scam links", "trigger": "keyword", "keywords": ["*free nitro*", "*discord-gift*", "*discordgift*", "*steam gift*", "*airdrop claim*", "*wallet connect support*", "*dm me for support*"], "actions": ["block", "alert:mod-log"], "exemptRoles": ["maintainer", "moderator"] }
  ],
  "pins": [
    { "channel": "welcome", "key": "welcome", "text": "Welcome to Mission Kit, the building gear pack for AI coding agents: orchestrated plans with to-dos, human confirmation gates, and a staging-then-prod git flow. It ships as the Agent Kit CLI on npm, with the Mission Control dashboard and the Outpost desktop app.\n\nSite: https://missionkit.io\nCode: https://github.com/agent-kit-startup/agent-kit\nGetting started: https://github.com/agent-kit-startup/agent-kit/blob/main/docs/getting-started.md\n\nQuick help: #support. Searchable Q&A: {{discussionsUrl}}. Bugs: GitHub Issues." },
    { "channel": "rules", "key": "rules", "text": "Mission Kit community rules\n\n1. Follow the Code of Conduct: https://github.com/agent-kit-startup/agent-kit/blob/main/.github/CODE_OF_CONDUCT.md. Be kind, assume good intent, no harassment.\n2. Stay on topic per channel. Off-topic chat goes to #off-topic.\n3. Questions others will search for later go to GitHub Discussions; bugs go to Issues. See https://github.com/agent-kit-startup/agent-kit/blob/main/.github/SUPPORT.md.\n4. Never post secrets, tokens or private repository content. Security reports follow SECURITY.md, never a public channel.\n5. No spam, no unsolicited DMs, no vote or star requests.\n6. English in every channel except #pt-br.\n\nModerators may remove messages and time out or remove members who break these rules." },
    { "channel": "releases", "key": "releases", "text": "This channel gets one post per public release of Mission Kit, after the version is live on npm and missionkit.io. Nothing else is posted here." },
    { "channel": "support", "key": "support", "text": "Tag your post. Include the CLI version and the output of `npx @dadado/agent-kit-cli doctor --json`. Questions others will search for later belong in GitHub Discussions: {{discussionsUrl}}. Bugs go to GitHub Issues." },
    { "channel": "contributors", "key": "contributors", "text": "Contributing guide: https://github.com/agent-kit-startup/agent-kit/blob/main/docs/CONTRIBUTING.md. The Contributor role is granted by a maintainer after a merged contribution." },
    { "channel": "pt-br", "key": "pt-br", "text": "Canal para conversar em português sobre o Mission Kit. Bugs vão para as Issues do GitHub, em inglês ou português." }
  ]
}
```
<!-- discord-spec:end -->
