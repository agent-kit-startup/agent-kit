import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyActions,
  emptyState,
  extractSpec,
  fetchState,
  fillPlaceholders,
  formatPlan,
  main,
  makeApi,
  missingBotPermissions,
  permissionBits,
  planActions,
  redactToken,
  SPEC_PATH,
  TOKEN_ENV,
  validateSpec,
} from "./discord-provision.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const spec = extractSpec(readFileSync(join(repoRoot, SPEC_PATH), "utf8"));
const TOKEN = ["fixture", "credential", "value"].join(".");
const VARS = { discussionsUrl: "https://github.com/agent-kit-startup/agent-kit/discussions" };

/** In-memory Discord guild behind the same REST paths the script uses. */
function fakeDiscord(guildId = "100") {
  let seq = 1000;
  const next = () => String(++seq);
  const g = {
    guild: {
      id: guildId,
      name: "new server",
      description: null,
      icon: null,
      features: ["COMMUNITY"],
    },
    roles: [{ id: guildId, name: "@everyone", permissions: "104324673" }],
    channels: [],
    pins: {},
    messages: {},
    automod: [],
    calls: [],
  };
  async function handle(method, path, body) {
    g.calls.push(`${method} ${path}`);
    let m = null;
    const match = (re) => {
      m = path.match(re);
      return m !== null;
    };
    if (method === "GET" && path === "/users/@me") return { id: "900" };
    if (method === "GET" && path === `/guilds/${guildId}`) return g.guild;
    if (method === "PATCH" && path === `/guilds/${guildId}`)
      return Object.assign(g.guild, body, body.icon ? { icon: "hash" } : {});
    if (method === "GET" && path === `/guilds/${guildId}/roles`) return g.roles;
    if (method === "POST" && path === `/guilds/${guildId}/roles`) {
      const r = { id: next(), ...body, permissions: String(body.permissions) };
      g.roles.push(r);
      return r;
    }
    if (method === "PATCH" && match(/^\/guilds\/\d+\/roles\/(\d+)$/)) {
      return Object.assign(
        g.roles.find((r) => r.id === m[1]),
        body,
      );
    }
    if (method === "GET" && path === `/guilds/${guildId}/channels`) return g.channels;
    if (method === "POST" && path === `/guilds/${guildId}/channels`) {
      const c = {
        id: next(),
        ...body,
        topic: body.topic ?? null,
        parent_id: body.parent_id ?? null,
      };
      g.channels.push(c);
      return c;
    }
    if (method === "PATCH" && match(/^\/channels\/(\d+)$/)) {
      return Object.assign(
        g.channels.find((c) => c.id === m[1]),
        body,
      );
    }
    if (method === "GET" && match(/^\/channels\/(\d+)\/messages\/pins$/)) {
      return { items: (g.pins[m[1]] ?? []).map((message) => ({ message })), has_more: false };
    }
    if (method === "POST" && match(/^\/channels\/(\d+)\/messages$/)) {
      const msg = { id: next(), content: body.content };
      g.messages[msg.id] = msg;
      return msg;
    }
    if (method === "PUT" && match(/^\/channels\/(\d+)\/messages\/pins\/(\d+)$/)) {
      if (!g.pins[m[1]]) g.pins[m[1]] = [];
      g.pins[m[1]].push(g.messages[m[2]]);
      return null;
    }
    if (method === "GET" && path === `/guilds/${guildId}/auto-moderation/rules`) return g.automod;
    if (method === "POST" && path === `/guilds/${guildId}/auto-moderation/rules`) {
      const r = { id: next(), ...body };
      g.automod.push(r);
      return r;
    }
    throw new Error(`fake: unhandled ${method} ${path}`);
  }
  const fetchImpl = async (url, init) => {
    const path = url.replace("https://discord.com/api/v10", "");
    assert.equal(init.headers.Authorization, `Bot ${TOKEN}`);
    const data = await handle(init.method, path, init.body ? JSON.parse(init.body) : undefined);
    if (data === null) return { status: 204, ok: true, text: async () => "" };
    return { status: 200, ok: true, text: async () => JSON.stringify(data) };
  };
  return { g, fetchImpl, guildId };
}

test("spec block parses and validates", () => {
  assert.equal(spec.version, 1);
  assert.deepEqual(validateSpec(spec), []);
});

test("validateSpec catches unknown references and permissions", () => {
  const bad = structuredClone(spec);
  bad.roles[0].permissions.push("FLY");
  bad.pins.push({ channel: "nowhere", key: "x", text: "x" });
  bad.categories[0].channels.push({ ...bad.categories[0].channels[0] });
  const errors = validateSpec(bad);
  assert.ok(errors.some((e) => e.includes("unknown permission FLY")));
  assert.ok(errors.some((e) => e.includes("unknown channel nowhere")));
  assert.ok(errors.some((e) => e.includes("duplicate channel key")));
});

test("the bot role holds every permission the spec grants or overwrites", () => {
  assert.deepEqual(missingBotPermissions(spec), []);
  const bad = structuredClone(spec);
  bad.botPermissions = bad.botPermissions.filter(
    (n) => n !== "MODERATE_MEMBERS" && n !== "BAN_MEMBERS",
  );
  const errors = validateSpec(bad);
  assert.ok(errors.includes("botPermissions: missing MODERATE_MEMBERS"));
  assert.ok(errors.includes("botPermissions: missing BAN_MEMBERS"));
});

test("spec has no Oligarchy category or channel", () => {
  const names = spec.categories.flatMap((c) => [c.name, ...c.channels.map((ch) => ch.name)]);
  assert.ok(!names.some((n) => /oligarchy/i.test(n)));
});

test("permissionBits uses Discord flag positions", () => {
  assert.equal(permissionBits(["VIEW_CHANNEL"]), String(1n << 10n));
  assert.equal(
    permissionBits(["SEND_MESSAGES", "PIN_MESSAGES"]),
    String((1n << 11n) | (1n << 51n)),
  );
  assert.throws(() => permissionBits(["NOPE"]), /unknown permission/);
});

test("plan against an empty server creates everything and skips placeholder pins", () => {
  const plan = planActions(spec, emptyState());
  const count = (op) => plan.actions.filter((a) => a.op === op).length;
  const channels = spec.categories.reduce((n, c) => n + c.channels.length, 0);
  assert.equal(count("create_role"), spec.roles.length);
  assert.equal(count("create_channel"), spec.categories.length + channels);
  assert.equal(count("create_automod"), spec.automod.length);
  const placeholderPins = spec.pins.filter((p) => p.text.includes("{{")).length;
  assert.ok(placeholderPins > 0);
  assert.equal(count("pin"), spec.pins.length - placeholderPins);
  assert.equal(plan.skipped.length, placeholderPins);
  assert.ok(plan.operatorSteps.some((s) => s.includes("Enable Community")));
  assert.ok(plan.operatorSteps.some((s) => s.startsWith("Onboarding")));
  assert.match(formatPlan(plan), /\+ role Maintainer/);
});

test("filled placeholders produce every pin", () => {
  const plan = planActions(spec, emptyState(), { vars: VARS });
  assert.equal(plan.actions.filter((a) => a.op === "pin").length, spec.pins.length);
  assert.equal(plan.skipped.length, 0);
  assert.deepEqual(fillPlaceholders("a {{x}} b", {}).missing, ["x"]);
});

test("read-only channels deny posting to everyone and allow maintainers", () => {
  const plan = planActions(spec, emptyState());
  const rules = plan.actions.find((a) => a.label === "channel #rules");
  const everyone = rules.body.permission_overwrites.find((o) => o.id === "@everyone");
  assert.equal(BigInt(everyone.deny) & (1n << 11n), 1n << 11n);
  assert.ok(rules.body.permission_overwrites.some((o) => o.id === "@role:maintainer"));
  const releases = plan.actions.find((a) => a.label === "channel #releases");
  assert.ok(releases.body.permission_overwrites.some((o) => o.id === "@bot" && o.type === 1));
  const modlog = plan.actions.find((a) => a.label === "channel #mod-log");
  const hidden = modlog.body.permission_overwrites.find((o) => o.id === "@everyone");
  assert.equal(BigInt(hidden.deny) & (1n << 10n), 1n << 10n);
});

test("apply against a fake server converges: the second plan is empty", async () => {
  const { g, fetchImpl, guildId } = fakeDiscord();
  const api = makeApi({ token: TOKEN, fetchImpl });
  const before = await fetchState(api, guildId, spec);
  const first = planActions(spec, before, { vars: VARS });
  await applyActions(api, guildId, first.actions, before, spec, { repoRoot });
  assert.equal(g.roles.length, spec.roles.length + 1);
  assert.ok(g.guild.rules_channel_id);
  const after = await fetchState(api, guildId, spec);
  const second = planActions(spec, after, { vars: VARS });
  assert.deepEqual(
    second.actions.map((a) => a.label),
    [],
  );
  const channelsBefore = g.channels.length;
  await applyActions(api, guildId, second.actions, after, spec, { repoRoot });
  assert.equal(g.channels.length, channelsBefore);
});

test("an existing channel with a drifted topic is updated, not duplicated", async () => {
  const { g, fetchImpl, guildId } = fakeDiscord();
  const api = makeApi({ token: TOKEN, fetchImpl });
  const s0 = await fetchState(api, guildId, spec);
  await applyActions(api, guildId, planActions(spec, s0, { vars: VARS }).actions, s0, spec, {
    repoRoot,
  });
  g.channels.find((c) => c.name === "cli").topic = "old topic";
  const s1 = await fetchState(api, guildId, spec);
  const plan = planActions(spec, s1, { vars: VARS });
  assert.deepEqual(
    plan.actions.map((a) => a.label),
    ["channel #cli (topic)"],
  );
});

test("dry run with no guild makes no network call", async () => {
  let calls = 0;
  const out = [];
  const code = await main([], {
    repoRoot,
    env: {},
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network");
    },
    out: { write: (s) => out.push(s) },
    err: { write: (s) => out.push(s) },
  });
  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.match(out.join(""), /dry run: nothing written/);
});

test("apply refuses without token, guild or ask provenance", async () => {
  const err = [];
  const io = { out: { write: () => {} }, err: { write: (s) => err.push(s) } };
  assert.equal(await main(["--apply"], { repoRoot, env: {}, ...io }), 2);
  assert.equal(
    await main(["--apply", "--guild", "1"], { repoRoot, env: { [TOKEN_ENV]: TOKEN }, ...io }),
    2,
  );
  assert.match(err.join(""), /apply refused/);
});

test("the token never reaches output, even in API errors", async () => {
  const out = [];
  const fetchImpl = async () => ({
    status: 401,
    ok: false,
    text: async () => `bad token ${TOKEN}`,
  });
  const code = await main(["--guild", "1"], {
    repoRoot,
    env: { [TOKEN_ENV]: TOKEN },
    fetchImpl,
    out: { write: (s) => out.push(s) },
    err: { write: (s) => out.push(s) },
  });
  assert.equal(code, 1);
  assert.ok(!out.join("").includes(TOKEN));
  assert.equal(redactToken(`x ${TOKEN} y`, TOKEN), "x <redacted> y");
});
