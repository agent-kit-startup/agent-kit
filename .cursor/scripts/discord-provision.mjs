#!/usr/bin/env node
/**
 * Converge the Mission Kit Discord server to docs/community/discord-server.md.
 * Factory-only, same family as comms-draft.mjs. Dry-run by default.
 *
 *   node .cursor/scripts/discord-provision.mjs                      # plan against an empty server, no network
 *   node .cursor/scripts/discord-provision.mjs --state snap.json    # plan against a saved snapshot, no network
 *   node .cursor/scripts/discord-provision.mjs --guild <id>         # read the live server (GET only) and plan
 *   node .cursor/scripts/discord-provision.mjs --guild <id> --apply --ask-provenance "<HITL_REPLY line>"
 *
 * The bot token is read from MISSION_KIT_DISCORD_BOT_TOKEN and is never printed.
 * Re-running after a converged apply plans zero changes.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TOKEN_ENV = "MISSION_KIT_DISCORD_BOT_TOKEN";
export const GUILD_ENV = "MISSION_KIT_DISCORD_GUILD_ID";
export const SPEC_PATH = "docs/community/discord-server.md";
const SPEC_RE =
  /<!-- discord-spec:begin -->\s*```json\n([\s\S]*?)\n```\s*<!-- discord-spec:end -->/;
const API_BASE = "https://discord.com/api/v10";

export const PERMISSION_BITS = {
  CREATE_INSTANT_INVITE: 0n,
  KICK_MEMBERS: 1n,
  BAN_MEMBERS: 2n,
  MANAGE_CHANNELS: 4n,
  MANAGE_GUILD: 5n,
  ADD_REACTIONS: 6n,
  VIEW_AUDIT_LOG: 7n,
  VIEW_CHANNEL: 10n,
  SEND_MESSAGES: 11n,
  MANAGE_MESSAGES: 13n,
  EMBED_LINKS: 14n,
  ATTACH_FILES: 15n,
  READ_MESSAGE_HISTORY: 16n,
  MENTION_EVERYONE: 17n,
  USE_EXTERNAL_EMOJIS: 18n,
  MANAGE_ROLES: 28n,
  MANAGE_WEBHOOKS: 29n,
  USE_APPLICATION_COMMANDS: 31n,
  MANAGE_THREADS: 34n,
  CREATE_PUBLIC_THREADS: 35n,
  SEND_MESSAGES_IN_THREADS: 38n,
  MODERATE_MEMBERS: 40n,
  PIN_MESSAGES: 51n,
};

export const CHANNEL_TYPES = { text: 0, category: 4, announcement: 5, forum: 15 };
const VERIFICATION = { none: 0, low: 1, medium: 2, high: 3, very_high: 4 };
const CONTENT_FILTER = { disabled: 0, members_without_roles: 1, all_members: 2 };
const NOTIFICATIONS = { all_messages: 0, only_mentions: 1 };
const AUTOMOD_TRIGGER = { keyword: 1, spam: 3, keyword_preset: 4, mention_spam: 5 };
const AUTOMOD_PRESET = { profanity: 1, sexual_content: 2, slurs: 3 };
const READ_ONLY_DENY = ["SEND_MESSAGES", "SEND_MESSAGES_IN_THREADS", "CREATE_PUBLIC_THREADS"];
const PLACEHOLDER_RE = /\{\{([a-zA-Z]+)\}\}/g;

export function extractSpec(markdown) {
  const m = SPEC_RE.exec(markdown);
  if (!m) throw new Error("discord spec block not found (discord-spec:begin / discord-spec:end)");
  return JSON.parse(m[1]);
}

export function permissionBits(names) {
  let bits = 0n;
  for (const n of names) {
    if (!(n in PERMISSION_BITS)) throw new Error(`unknown permission ${n}`);
    bits |= 1n << PERMISSION_BITS[n];
  }
  return bits.toString();
}

function colorInt(hex) {
  return hex ? Number.parseInt(hex.replace("#", ""), 16) : 0;
}

export function allChannels(spec) {
  return spec.categories.flatMap((c) => c.channels.map((ch) => ({ ...ch, category: c })));
}

export function validateSpec(spec) {
  const errors = [];
  const roleKeys = new Set();
  for (const r of spec.roles ?? []) {
    if (roleKeys.has(r.key)) errors.push(`duplicate role key ${r.key}`);
    roleKeys.add(r.key);
  }
  const chanKeys = new Set();
  const chanNames = new Set();
  for (const ch of allChannels(spec)) {
    if (chanKeys.has(ch.key)) errors.push(`duplicate channel key ${ch.key}`);
    if (chanNames.has(ch.name)) errors.push(`duplicate channel name ${ch.name}`);
    chanKeys.add(ch.key);
    chanNames.add(ch.name);
    if (!(ch.type in CHANNEL_TYPES) || ch.type === "category")
      errors.push(`channel ${ch.key}: bad type ${ch.type}`);
  }
  const checkPerms = (where, names) => {
    for (const n of names ?? [])
      if (!(n in PERMISSION_BITS)) errors.push(`${where}: unknown permission ${n}`);
  };
  checkPerms("everyone", spec.everyone?.permissions);
  checkPerms("botPermissions", spec.botPermissions);
  for (const r of spec.roles ?? []) checkPerms(`role ${r.key}`, r.permissions);
  const needRole = (where, k) => {
    if (!roleKeys.has(k)) errors.push(`${where}: unknown role ${k}`);
  };
  const needChan = (where, k) => {
    if (!chanKeys.has(k)) errors.push(`${where}: unknown channel ${k}`);
  };
  for (const k of spec.readOnlyPosters ?? []) needRole("readOnlyPosters", k);
  for (const c of spec.categories)
    for (const k of c.visibleTo ?? []) needRole(`category ${c.key}`, k);
  for (const k of ["rulesChannel", "publicUpdatesChannel"])
    if (spec.server?.[k]) needChan(`server.${k}`, spec.server[k]);
  for (const k of spec.onboarding?.defaultChannels ?? []) needChan("onboarding.defaultChannels", k);
  for (const p of spec.onboarding?.prompts ?? []) {
    for (const o of p.options) {
      for (const k of o.roles) needRole(`onboarding ${p.key}`, k);
      for (const k of o.channels) needChan(`onboarding ${p.key}`, k);
    }
  }
  for (const a of spec.automod ?? []) {
    if (!(a.trigger in AUTOMOD_TRIGGER)) errors.push(`automod ${a.key}: bad trigger ${a.trigger}`);
    for (const k of a.exemptRoles ?? []) needRole(`automod ${a.key}`, k);
    for (const act of a.actions) {
      if (act.startsWith("alert:")) needChan(`automod ${a.key}`, act.slice(6));
    }
  }
  for (const p of spec.pins ?? []) needChan("pins", p.channel);
  for (const n of missingBotPermissions(spec)) errors.push(`botPermissions: missing ${n}`);
  return errors;
}

/**
 * Discord lets a bot grant or overwrite only permissions it holds, and the AutoMod
 * timeout action needs MODERATE_MEMBERS; the provisioning role must cover all of them.
 */
export function requiredBotPermissions(spec) {
  const need = new Set([
    "MANAGE_CHANNELS",
    "MANAGE_ROLES",
    "MANAGE_GUILD",
    "VIEW_CHANNEL",
    "SEND_MESSAGES",
    "PIN_MESSAGES",
  ]);
  for (const n of spec.everyone?.permissions ?? []) need.add(n);
  for (const r of spec.roles ?? []) for (const n of r.permissions ?? []) need.add(n);
  for (const n of READ_ONLY_DENY) need.add(n);
  if ((spec.automod ?? []).some((a) => a.actions.some((x) => x.startsWith("timeout:"))))
    need.add("MODERATE_MEMBERS");
  return [...need];
}

export function missingBotPermissions(spec) {
  const have = new Set(spec.botPermissions ?? []);
  return requiredBotPermissions(spec).filter((n) => !have.has(n));
}

export function emptyState(guildId = "GUILD") {
  return {
    guildId,
    botUserId: "BOT",
    guild: { name: null, description: null, icon: null, features: [] },
    everyonePermissions: "0",
    roles: [],
    channels: [],
    pins: {},
    automod: [],
  };
}

function overwriteList(list) {
  return [...list]
    .map((o) => ({ id: String(o.id), type: o.type, allow: String(o.allow), deny: String(o.deny) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Desired overwrites with symbolic ids (@everyone, @role:<key>, @bot). */
export function desiredOverwrites(spec, ch) {
  const out = [];
  const cat = ch.category;
  if (cat?.hidden) {
    out.push({ id: "@everyone", type: 0, allow: "0", deny: permissionBits(["VIEW_CHANNEL"]) });
    for (const k of cat.visibleTo ?? []) {
      out.push({ id: `@role:${k}`, type: 0, allow: permissionBits(["VIEW_CHANNEL"]), deny: "0" });
    }
    out.push({
      id: "@bot",
      type: 1,
      allow: permissionBits(["VIEW_CHANNEL", "SEND_MESSAGES"]),
      deny: "0",
    });
    return out;
  }
  if (ch.readOnly) {
    out.push({ id: "@everyone", type: 0, allow: "0", deny: permissionBits(READ_ONLY_DENY) });
    for (const k of spec.readOnlyPosters ?? []) {
      out.push({ id: `@role:${k}`, type: 0, allow: permissionBits(READ_ONLY_DENY), deny: "0" });
    }
    if (ch.allowBot)
      out.push({ id: "@bot", type: 1, allow: permissionBits(["SEND_MESSAGES"]), deny: "0" });
  }
  return out;
}

function resolveRefs(value, ids) {
  if (typeof value === "string" && value.startsWith("@")) {
    if (!(value in ids)) throw new Error(`unresolved reference ${value}`);
    return ids[value];
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, ids));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, ids)]));
  }
  return value;
}

/** Symbolic id map from the current state (refs not yet created stay absent). */
export function stateIds(spec, state) {
  const ids = { "@everyone": state.guildId, "@bot": state.botUserId };
  for (const r of spec.roles) {
    const hit = state.roles.find((x) => x.name === r.name);
    if (hit) ids[`@role:${r.key}`] = hit.id;
  }
  for (const c of spec.categories) {
    const hit = state.channels.find((x) => x.type === CHANNEL_TYPES.category && x.name === c.name);
    if (hit) ids[`@category:${c.key}`] = hit.id;
  }
  for (const ch of allChannels(spec)) {
    const hit = state.channels.find((x) => x.type === CHANNEL_TYPES[ch.type] && x.name === ch.name);
    if (hit) ids[`@channel:${ch.key}`] = hit.id;
  }
  return ids;
}

function sameOverwrites(existing, desired, ids) {
  let resolved;
  try {
    resolved = resolveRefs(desired, ids);
  } catch {
    return false;
  }
  return JSON.stringify(overwriteList(existing ?? [])) === JSON.stringify(overwriteList(resolved));
}

export function fillPlaceholders(text, vars) {
  const missing = [];
  const out = text.replace(PLACEHOLDER_RE, (all, name) => {
    if (vars[name]) return vars[name];
    missing.push(name);
    return all;
  });
  return { text: out, missing };
}

function automodBody(rule) {
  const actions = rule.actions.map((a) => {
    if (a === "block") return { type: 1 };
    if (a.startsWith("alert:"))
      return { type: 2, metadata: { channel_id: `@channel:${a.slice(6)}` } };
    if (a.startsWith("timeout:"))
      return { type: 3, metadata: { duration_seconds: Number(a.slice(8)) } };
    throw new Error(`automod ${rule.key}: unknown action ${a}`);
  });
  const trigger_metadata = {};
  if (rule.trigger === "keyword") trigger_metadata.keyword_filter = rule.keywords;
  if (rule.trigger === "keyword_preset")
    trigger_metadata.presets = rule.presets.map((p) => AUTOMOD_PRESET[p]);
  if (rule.trigger === "mention_spam") trigger_metadata.mention_total_limit = rule.mentionLimit;
  return {
    name: rule.name,
    event_type: 1,
    trigger_type: AUTOMOD_TRIGGER[rule.trigger],
    trigger_metadata,
    actions,
    enabled: true,
    exempt_roles: (rule.exemptRoles ?? []).map((k) => `@role:${k}`),
  };
}

function automodComparable(r) {
  const meta = r.trigger_metadata ?? {};
  return JSON.stringify({
    t: r.trigger_type,
    k: [...(meta.keyword_filter ?? [])].sort(),
    p: [...(meta.presets ?? [])].sort(),
    m: meta.mention_total_limit ?? null,
    a: (r.actions ?? []).map((a) => [
      a.type,
      a.metadata?.channel_id ?? null,
      a.metadata?.duration_seconds ?? null,
    ]),
    e: [...(r.exempt_roles ?? [])].map(String).sort(),
    on: r.enabled !== false,
  });
}

/**
 * Plan the changes that converge `state` to `spec`. Pure: no network.
 * Returns { actions, skipped, operatorSteps }. Action bodies may hold symbolic refs.
 */
export function planActions(spec, state, { vars = {} } = {}) {
  const actions = [];
  const skipped = [];
  const operatorSteps = [];
  const ids = stateIds(spec, state);

  for (const r of spec.roles) {
    const body = {
      name: r.name,
      permissions: permissionBits(r.permissions),
      color: colorInt(r.color),
      hoist: r.hoist,
      mentionable: r.mentionable,
    };
    const hit = state.roles.find((x) => x.name === r.name);
    if (!hit)
      actions.push({ op: "create_role", ref: `@role:${r.key}`, label: `role ${r.name}`, body });
    else {
      const diff = ["permissions", "color", "hoist", "mentionable"].filter(
        (k) => String(hit[k]) !== String(body[k]),
      );
      if (diff.length)
        actions.push({
          op: "update_role",
          id: hit.id,
          label: `role ${r.name} (${diff.join(", ")})`,
          body,
        });
    }
  }

  const everyone = permissionBits(spec.everyone.permissions);
  if (String(state.everyonePermissions) !== everyone) {
    actions.push({
      op: "update_role",
      id: state.guildId,
      label: "role @everyone (permissions)",
      body: { permissions: everyone },
    });
  }

  for (const c of spec.categories) {
    const hit = state.channels.find((x) => x.type === CHANNEL_TYPES.category && x.name === c.name);
    const overwrites = desiredOverwrites(spec, { category: c });
    if (!hit) {
      actions.push({
        op: "create_channel",
        ref: `@category:${c.key}`,
        label: `category ${c.name}`,
        body: { name: c.name, type: CHANNEL_TYPES.category, permission_overwrites: overwrites },
      });
    } else if (!sameOverwrites(hit.permission_overwrites, overwrites, ids)) {
      actions.push({
        op: "update_channel",
        id: hit.id,
        label: `category ${c.name} (overwrites)`,
        body: { permission_overwrites: overwrites },
      });
    }
  }

  for (const ch of allChannels(spec)) {
    const type = CHANNEL_TYPES[ch.type];
    const overwrites = desiredOverwrites(spec, ch);
    const body = {
      name: ch.name,
      type,
      topic: ch.topic ?? null,
      parent_id: `@category:${ch.category.key}`,
      permission_overwrites: overwrites,
    };
    if (ch.type === "forum") body.available_tags = (ch.tags ?? []).map((name) => ({ name }));
    const hit = state.channels.find((x) => x.name === ch.name && x.type !== CHANNEL_TYPES.category);
    if (!hit) {
      actions.push({
        op: "create_channel",
        ref: `@channel:${ch.key}`,
        label: `channel #${ch.name}`,
        body,
      });
      continue;
    }
    if (hit.type !== type) {
      skipped.push(
        `channel #${ch.name}: exists with type ${hit.type}, spec wants ${type}; fix by hand`,
      );
      continue;
    }
    const diff = [];
    const patch = {};
    if ((hit.topic ?? null) !== body.topic) {
      diff.push("topic");
      patch.topic = body.topic;
    }
    if (
      ids[`@category:${ch.category.key}`] === undefined ||
      String(hit.parent_id) !== String(ids[`@category:${ch.category.key}`])
    ) {
      diff.push("parent");
      patch.parent_id = body.parent_id;
    }
    if (!sameOverwrites(hit.permission_overwrites, overwrites, ids)) {
      diff.push("overwrites");
      patch.permission_overwrites = overwrites;
    }
    if (ch.type === "forum") {
      const have = (hit.available_tags ?? [])
        .map((t) => t.name)
        .sort()
        .join("|");
      const want = (ch.tags ?? []).slice().sort().join("|");
      if (have !== want) {
        diff.push("tags");
        patch.available_tags = body.available_tags;
      }
    }
    if (diff.length)
      actions.push({
        op: "update_channel",
        id: hit.id,
        label: `channel #${ch.name} (${diff.join(", ")})`,
        body: patch,
      });
  }

  const s = spec.server;
  const guildPatch = {};
  const g = state.guild;
  if (g.name !== s.name) guildPatch.name = s.name;
  if ((g.description ?? null) !== s.description) guildPatch.description = s.description;
  if (g.preferred_locale !== s.preferredLocale) guildPatch.preferred_locale = s.preferredLocale;
  if (g.verification_level !== VERIFICATION[s.verificationLevel])
    guildPatch.verification_level = VERIFICATION[s.verificationLevel];
  if (g.explicit_content_filter !== CONTENT_FILTER[s.explicitContentFilter]) {
    guildPatch.explicit_content_filter = CONTENT_FILTER[s.explicitContentFilter];
  }
  if (g.default_message_notifications !== NOTIFICATIONS[s.defaultMessageNotifications]) {
    guildPatch.default_message_notifications = NOTIFICATIONS[s.defaultMessageNotifications];
  }
  if (!g.icon && s.icon) guildPatch.icon = { file: s.icon };
  const community = (g.features ?? []).includes("COMMUNITY");
  if (community) {
    const rules = `@channel:${s.rulesChannel}`;
    const updates = `@channel:${s.publicUpdatesChannel}`;
    const differs = (have, ref) => ids[ref] === undefined || String(have) !== String(ids[ref]);
    if (differs(g.rules_channel_id, rules)) guildPatch.rules_channel_id = rules;
    if (differs(g.public_updates_channel_id, updates))
      guildPatch.public_updates_channel_id = updates;
  } else {
    operatorSteps.push(
      `Enable Community in Server Settings (rules channel #${s.rulesChannel}, community updates channel #${s.publicUpdatesChannel}), then re-run`,
    );
  }
  if (Object.keys(guildPatch).length) {
    actions.push({
      op: "update_guild",
      label: `server settings (${Object.keys(guildPatch).join(", ")})`,
      body: guildPatch,
    });
  }
  if (s.banner && !g.banner)
    operatorSteps.push(`Upload the banner from ${s.banner} if the server has the banner feature`);

  for (const rule of spec.automod) {
    const body = automodBody(rule);
    const hit = state.automod.find((x) => x.name === rule.name);
    if (!hit) actions.push({ op: "create_automod", label: `automod ${rule.name}`, body });
    else {
      let same = false;
      try {
        same = automodComparable(hit) === automodComparable(resolveRefs(body, ids));
      } catch {
        same = false;
      }
      if (!same)
        actions.push({ op: "update_automod", id: hit.id, label: `automod ${rule.name}`, body });
    }
  }

  for (const pin of spec.pins) {
    const { text, missing } = fillPlaceholders(pin.text, vars);
    if (missing.length) {
      skipped.push(
        `pin #${pin.channel} (${pin.key}): unresolved ${missing.map((m) => `{{${m}}}`).join(", ")}`,
      );
      continue;
    }
    const have = state.pins[pin.channel] ?? [];
    if (!have.includes(text)) {
      actions.push({
        op: "pin",
        channel: `@channel:${pin.channel}`,
        label: `pin #${pin.channel} (${pin.key})`,
        body: { content: text },
      });
    }
  }

  const ob = spec.onboarding;
  if (ob) {
    operatorSteps.push(
      `Onboarding (Server Settings > Onboarding): default channels ${ob.defaultChannels.map((c) => `#${c}`).join(", ")}; questions: ${ob.prompts
        .map((p) => `"${p.title}" [${p.options.map((o) => o.title).join(" / ")}]`)
        .join("; ")}`,
    );
  }
  return { actions, skipped, operatorSteps };
}

export function formatPlan({ actions, skipped, operatorSteps }) {
  const lines = [];
  for (const a of actions)
    lines.push(`${a.op.startsWith("create") || a.op === "pin" ? "+" : "~"} ${a.label}`);
  for (const s of skipped) lines.push(`! skip ${s}`);
  for (const s of operatorSteps) lines.push(`> operator: ${s}`);
  lines.push(
    `${actions.length} change(s), ${skipped.length} skipped, ${operatorSteps.length} operator step(s)`,
  );
  return `${lines.join("\n")}\n`;
}

/** Never let the token reach output. */
export function redactToken(text, token) {
  if (!token) return text;
  return String(text).split(token).join("<redacted>");
}

export function makeApi({
  token,
  fetchImpl = globalThis.fetch,
  base = API_BASE,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  async function call(method, path, body) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "DiscordBot (mission-kit-provision, 1)",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        await sleep(Math.ceil((data.retry_after ?? 1) * 1000));
        continue;
      }
      if (res.status === 204) return null;
      const text = await res.text();
      if (!res.ok)
        throw new Error(
          redactToken(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`, token),
        );
      return text ? JSON.parse(text) : null;
    }
    throw new Error(`${method} ${path}: rate limited 5 times`);
  }
  return {
    get: (path) => call("GET", path),
    send: (method, path, body) => call(method, path, body),
  };
}

/** Read the live server (GET only). */
export async function fetchState(api, guildId, spec) {
  const me = await api.get("/users/@me");
  const guild = await api.get(`/guilds/${guildId}`);
  const roles = await api.get(`/guilds/${guildId}/roles`);
  const channels = await api.get(`/guilds/${guildId}/channels`);
  const automod = await api.get(`/guilds/${guildId}/auto-moderation/rules`);
  const everyone = roles.find((r) => String(r.id) === String(guildId));
  const pins = {};
  for (const key of new Set(spec.pins.map((p) => p.channel))) {
    const ch = allChannels(spec).find((c) => c.key === key);
    const hit = channels.find((x) => x.name === ch.name && x.type === CHANNEL_TYPES[ch.type]);
    if (!hit) continue;
    const res = await api.get(`/channels/${hit.id}/messages/pins`);
    const items = Array.isArray(res) ? res : (res?.items ?? []).map((i) => i.message);
    pins[key] = items.map((m) => m.content);
  }
  return {
    guildId: String(guildId),
    botUserId: String(me.id),
    guild,
    everyonePermissions: everyone ? String(everyone.permissions) : "0",
    roles: roles.filter((r) => String(r.id) !== String(guildId)),
    channels,
    pins,
    automod,
  };
}

export async function applyActions(
  api,
  guildId,
  actions,
  state,
  spec,
  { repoRoot = ".", log = () => {} } = {},
) {
  const ids = stateIds(spec, state);
  for (const a of actions) {
    let body = a.body;
    if (a.op === "update_guild" && body.icon?.file) {
      const data = readFileSync(join(repoRoot, body.icon.file)).toString("base64");
      body = { ...body, icon: `data:image/png;base64,${data}` };
    }
    body = resolveRefs(body, ids);
    if (a.op === "create_role") {
      const r = await api.send("POST", `/guilds/${guildId}/roles`, body);
      ids[a.ref] = r.id;
    } else if (a.op === "update_role") {
      await api.send("PATCH", `/guilds/${guildId}/roles/${a.id}`, body);
    } else if (a.op === "create_channel") {
      const c = await api.send("POST", `/guilds/${guildId}/channels`, body);
      ids[a.ref] = c.id;
    } else if (a.op === "update_channel") {
      await api.send("PATCH", `/channels/${a.id}`, body);
    } else if (a.op === "update_guild") {
      await api.send("PATCH", `/guilds/${guildId}`, body);
    } else if (a.op === "create_automod") {
      await api.send("POST", `/guilds/${guildId}/auto-moderation/rules`, body);
    } else if (a.op === "update_automod") {
      await api.send("PATCH", `/guilds/${guildId}/auto-moderation/rules/${a.id}`, body);
    } else if (a.op === "pin") {
      const channelId = resolveRefs(a.channel, ids);
      const m = await api.send("POST", `/channels/${channelId}/messages`, {
        ...body,
        allowed_mentions: { parse: [] },
      });
      await api.send("PUT", `/channels/${channelId}/messages/pins/${m.id}`);
    } else {
      throw new Error(`unknown op ${a.op}`);
    }
    log(`applied ${a.label}`);
  }
}

export function parseArgs(argv) {
  const out = {
    apply: false,
    guild: null,
    state: null,
    spec: SPEC_PATH,
    vars: {},
    askProvenance: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--apply") out.apply = true;
    else if (a === "--guild") out.guild = argv[++i] ?? null;
    else if (a === "--state") out.state = argv[++i] ?? null;
    else if (a === "--spec") out.spec = argv[++i] ?? out.spec;
    else if (a === "--ask-provenance") out.askProvenance = argv[++i] ?? null;
    else if (a === "--var") {
      const [k, ...v] = (argv[++i] ?? "").split("=");
      if (k && v.length) out.vars[k] = v.join("=");
    }
  }
  return out;
}

const HELP = `discord-provision: converge the Discord server to ${SPEC_PATH} (dry-run by default)

Options:
  --state <file>            plan against a saved state snapshot (no network)
  --guild <id>              read the live server with GET requests only (or ${GUILD_ENV})
  --apply                   write the planned changes (needs --guild, ${TOKEN_ENV}, --ask-provenance)
  --ask-provenance <line>   the operator's recorded apply decision, echoed in the log
  --var name=value          fill a pin placeholder, e.g. --var discussionsUrl=https://...
  --spec <path>             spec file (default ${SPEC_PATH})
`;

export async function main(
  argv,
  {
    repoRoot,
    env = process.env,
    fetchImpl = globalThis.fetch,
    out = process.stdout,
    err = process.stderr,
  } = {},
) {
  const opts = parseArgs(argv);
  if (opts.help) {
    out.write(HELP);
    return 0;
  }
  const token = env[TOKEN_ENV] ?? "";
  try {
    const spec = extractSpec(readFileSync(join(repoRoot, opts.spec), "utf8"));
    const errors = validateSpec(spec);
    if (errors.length) {
      err.write(`spec invalid:\n${errors.map((e) => `  ${e}`).join("\n")}\n`);
      return 1;
    }
    const guild = opts.guild ?? env[GUILD_ENV] ?? null;
    if (opts.apply) {
      if (!guild || !token || !opts.askProvenance) {
        err.write(
          `apply refused: needs --guild (or ${GUILD_ENV}), ${TOKEN_ENV} in the environment, and --ask-provenance\n`,
        );
        return 2;
      }
    }
    let state;
    let api = null;
    if (guild) {
      if (!token) {
        err.write(`reading a live server needs ${TOKEN_ENV} in the environment\n`);
        return 2;
      }
      api = makeApi({ token, fetchImpl });
      state = await fetchState(api, guild, spec);
    } else if (opts.state) {
      state = JSON.parse(readFileSync(opts.state, "utf8"));
    } else {
      state = emptyState();
    }
    const plan = planActions(spec, state, { vars: opts.vars });
    out.write(redactToken(formatPlan(plan), token));
    if (!opts.apply) {
      out.write("dry run: nothing written\n");
      return 0;
    }
    out.write(`apply: ${redactToken(opts.askProvenance, token)}\n`);
    await applyActions(api, guild, plan.actions, state, spec, {
      repoRoot,
      log: (l) => out.write(`${l}\n`),
    });
    out.write("apply done; re-run without --apply to confirm zero changes\n");
    return 0;
  } catch (e) {
    err.write(`${redactToken(e.message, token)}\n`);
    return 1;
  }
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  process.exitCode = await main(process.argv.slice(2), { repoRoot: root });
}
