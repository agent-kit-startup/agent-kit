import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  OUTCOME_KINDS,
  parseOutcomeLedger,
  summarizeOutcomeLedger,
} from "../../../dashboard/lib/outcome-ledger.mjs";
import { placeholderCatalog } from "../placeholder/index.mjs";
import {
  createRules,
  hexTiles,
  ledgerFromEntries,
  ledgerFromSnapshot,
  OUTCOME_RESOURCE,
  partner,
  ring,
  roll,
  settle,
  TILES,
  TUNING,
  turnsLeft,
  validateRulesCatalog,
  wallet,
} from "../src/index.mjs";

const {
  buildBlocker,
  canPlace,
  countermeasureCost,
  countermeasures,
  foldLedger,
  footprint,
  greenTiles,
  newGame,
  parseState,
  pickCountermeasure,
  queueBuild,
  queueRepair,
  revealedRing,
  spanOf,
  structures,
  threats,
  unlockedTier,
} = createRules(placeholderCatalog);

const NOW = Date.parse("2026-11-06T12:00:00Z");
const TERRAIN = "g".repeat(TILES.length);
const threat = (id) => threats.find((row) => row.id === id);
const inFlight = (id, arrivesAt, overrides = {}) => ({
  ...newGame(),
  turn: arrivesAt - 1,
  threat: { id, target: 1, arrivesAt, picked: null, ...overrides },
});

/** A ledger of `count` events of one kind, keyed in order. */
function ledgerOf(count, kind = "todo", prefix = "todo:") {
  const entries = {};
  for (let i = 0; i < count; i += 1) {
    const stamp = new Date(NOW + i * 1000).toISOString();
    entries[`${prefix}${String(i).padStart(6, "0")}`] = { kind, at: stamp, label: `event ${i}` };
  }
  return ledgerFromEntries(entries);
}

/** The first key whose dice bear an attack in a tier 1 colony. */
function attackKey(salt = "") {
  for (let i = 0; ; i += 1) {
    const key = `todo:${salt}${i}`;
    if (roll(key, "attack") < TUNING.attackChanceByTier[1]) return key;
  }
}

/** A key whose dice bear no attack in any tier. */
function quietKey(salt = "") {
  for (let i = 0; ; i += 1) {
    const key = `todo:quiet${salt}${i}`;
    if (roll(key, "attack") >= TUNING.attackChanceByTier[3]) return key;
  }
}

const wealthy = {
  total: 0,
  totals: { logic: 500, compute: 500, rare: 50 },
  events: [],
  flow: null,
};

test("the rule sources use no DOM, network, filesystem, timer or clock of their own", () => {
  for (const name of readdirSync(new URL("../src/", import.meta.url))) {
    const source = readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /\b(document|window|localStorage|fetch|XMLHttpRequest|setTimeout|setInterval|requestAnimationFrame|Date\.now|new Date|Math\.random|performance\.now|node:|demoFeed)\b/,
      name,
    );
  }
});

test("each outcome kind earns the resource the kit's ledger gives it", () => {
  assert.deepEqual({ ...OUTCOME_RESOURCE }, { ...OUTCOME_KINDS });
});

test("earned totals come from the ledger, one unit per event", () => {
  const entries = {
    "plan:a": { kind: "plan", at: "2026-11-01", label: "" },
    "release:v1": { kind: "releaseCut", at: "2026-11-02", label: "" },
    "todo:a": { kind: "todo", at: "2026-11-03", label: "" },
  };
  assert.deepEqual(ledgerFromEntries(entries).totals, { logic: 1, compute: 1, rare: 1 });
});

test("the snapshot summary the kit writes reads the same as its entries", () => {
  const raw = {
    version: 1,
    entries: {
      "ci:1": { kind: "ci", at: "2026-11-01T00:00:00Z", label: "CI" },
      "todo:a": { kind: "todo", at: "2026-11-02T00:00:00Z", label: "a" },
      "future:x": { kind: "newerKind", at: "2026-11-03T00:00:00Z", label: "x" },
    },
    sources: {},
  };
  const parsed = parseOutcomeLedger(raw);
  const full = ledgerFromEntries(parsed.entries);
  const summary = ledgerFromSnapshot(summarizeOutcomeLedger(parsed));
  assert.equal(full.total, 2);
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.totals, full.totals);
  assert.deepEqual(
    summary.events.map((event) => event.key),
    ["ci:1", "todo:a"],
  );
  assert.deepEqual(
    summary.events.map((event) => event.key),
    full.events.map((event) => event.key),
  );
});

test("the turn number is the ledger length, and a counted event makes no second turn", () => {
  const ledger = ledgerOf(3);
  const once = foldLedger(newGame(), ledger);
  assert.equal(once.turn, 3);
  assert.equal(foldLedger(once, ledger), once);
  const more = foldLedger(once, ledgerOf(5));
  assert.equal(more.turn, 5);
  assert.deepEqual(more.seen.length, 5);
});

test("an input outside the outcome kinds makes no turn and earns nothing", () => {
  const ledger = ledgerFromEntries({
    "commit:abc": { kind: "commit", at: "2026-11-01", label: "" },
    "keystrokes:1": { kind: "keystrokes", at: "2026-11-01", label: "" },
  });
  assert.equal(ledger.total, 0);
  assert.deepEqual(ledger.totals, { logic: 0, compute: 0, rare: 0 });
  const state = newGame();
  assert.equal(foldLedger(state, ledger), state);
});

test("a shrinking ledger takes nothing back", () => {
  const state = foldLedger(newGame(), ledgerOf(8));
  assert.equal(foldLedger(state, ledgerOf(2)), state);
});

test("snapshot turns older than its newest entries count, with no dice", () => {
  const summary = {
    entries: 100,
    totals: { logic: 100, compute: 0, rare: 0 },
    recent: [{ key: quietKey(), kind: "todo", at: "2026-11-01" }],
    flow: null,
  };
  const state = foldLedger(newGame(), ledgerFromSnapshot(summary));
  assert.equal(state.turn, 100);
  assert.equal(state.threat, null);
});

test("time alone never advances a turn or lands an attack", () => {
  const state = inFlight("bio-1", 9);
  const yearLater = NOW + 365 * 24 * 60 * 60 * 1000;
  const settled = settle(state, yearLater);
  assert.equal(settled, state);
  assert.equal(settled.turn, 8);
  assert.equal(turnsLeft(settled), 1);
  assert.equal(foldLedger(settled, ledgerOf(8)), settled);
});

test("replaying the same ledger gives byte-identical state", () => {
  const run = () => {
    let state = newGame();
    for (const size of [3, 10, 40, 41, 90]) state = foldLedger(state, ledgerOf(size));
    return JSON.stringify(state);
  };
  assert.equal(run(), run());
});

test("the dice are a pure function of the key, inside [0, 1) and near the tuned chance", () => {
  assert.equal(roll("todo:a", "attack"), roll("todo:a", "attack"));
  assert.notEqual(roll("todo:a", "attack"), roll("todo:b", "attack"));
  assert.notEqual(roll("todo:a", "attack"), roll("todo:a", "vector"));
  let born = 0;
  for (let i = 0; i < 20_000; i += 1) {
    const value = roll(`ci:${i}`, "attack");
    assert.ok(value >= 0 && value < 1);
    if (value < 1 / 8) born += 1;
  }
  assert.ok(born > 2200 && born < 2800, `born ${born}`);
});

test("no attack is born before the quiet turns pass", () => {
  const state = newGame();
  const ledger = {
    total: 1,
    totals: { logic: 1, compute: 0, rare: 0 },
    events: [{ key: attackKey(), kind: "todo", at: null }],
    flow: null,
  };
  assert.equal(foldLedger(state, ledger).threat, null);
});

function born(key, overrides = {}, options = {}) {
  const state = { ...newGame(), turn: 9, nextAttackTurn: 5, ...overrides };
  const ledger = {
    total: state.turn + 1,
    totals: { logic: 0, compute: 0, rare: 0 },
    events: [{ key, kind: "todo", at: null }],
    flow: null,
  };
  return foldLedger(state, ledger, options);
}

test("an attack arrives three to six turns out, from a tier the colony has unlocked", () => {
  const arrivals = new Set();
  for (let salt = 0; salt < 200; salt += 1) {
    const next = born(attackKey(`s${salt}-`));
    assert.ok(next.threat, "the key was picked to bear an attack");
    assert.equal(threat(next.threat.id).tier, 1);
    arrivals.add(turnsLeft(next));
  }
  assert.deepEqual([...arrivals].sort(), [3, 4, 5, 6]);
});

test("one attack in flight at most, and quiet turns follow a landing", () => {
  const flying = { ...inFlight("bio-1", 20), turn: 10 };
  const ledger = {
    total: flying.turn + 1,
    totals: { logic: 0, compute: 0, rare: 0 },
    events: [{ key: attackKey(), kind: "todo", at: null }],
    flow: null,
  };
  assert.equal(foldLedger(flying, ledger).threat.id, "bio-1");

  const landed = foldLedger(inFlight("bio-1", 20), { ...ledger, total: 20, events: [] });
  assert.equal(landed.threat, null);
  assert.equal(landed.nextAttackTurn, 20 + TUNING.quietTurns);
});

test("the enemy preference: off bears nothing and rare bears less", () => {
  const key = attackKey();
  assert.ok(born(key).threat);
  assert.equal(born(key, {}, { enemy: "off" }).threat, null);
  let on = 0;
  let rare = 0;
  for (let i = 0; i < 4000; i += 1) {
    if (born(`ci:${i}`).threat) on += 1;
    if (born(`ci:${i}`, {}, { enemy: "rare" }).threat) rare += 1;
  }
  assert.ok(rare < on * 0.6 && rare > on * 0.4, `on ${on}, rare ${rare}`);
});

test("tiers unlock by colony size, and a small colony sees only tier 1", () => {
  const empty = { totals: { logic: 0, compute: 0, rare: 0 } };
  assert.equal(unlockedTier(empty, newGame()), 1);
  const four = [1, 2, 3, 4].map((id) => ({ id, structure: "block", hex: id }));
  assert.equal(unlockedTier(empty, { ...newGame(), built: four }), 2);
  const eight = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, structure: "block", hex: id }));
  assert.equal(unlockedTier(empty, { ...newGame(), built: eight }), 3);
  const lateKey = { totals: { logic: 4000, compute: 0, rare: 0 } };
  assert.equal(unlockedTier(lateKey, newGame()), 3);
});

test("an attack born while away never lands in the same read", () => {
  const key = attackKey();
  const start = { ...newGame(), turn: 9, nextAttackTurn: 5 };
  const events = [key, ...Array.from({ length: 30 }, (_, i) => quietKey(`-${i}-`))].map(
    (eventKey) => ({ key: eventKey, kind: "todo", at: null }),
  );
  const ledger = { total: 9 + events.length, totals: wealthy.totals, events, flow: null };
  const after = foldLedger(start, ledger);
  assert.ok(after.threat, "still in flight");
  assert.equal(turnsLeft(after), 1);
  assert.equal(after.lastResolution, null);
  assert.equal(after.offline.length, 0);
});

test("an attack in flight stops at one turn left through a batch, then lands on the next event", () => {
  const flying = { ...inFlight("bio-1", 13), turn: 10 };
  const seven = { total: 17, totals: wealthy.totals, events: [], flow: null };
  const after = foldLedger(flying, seven);
  assert.equal(after.turn, 17);
  assert.equal(turnsLeft(after), 1);
  const landed = foldLedger(after, { ...seven, total: 18 });
  assert.equal(landed.threat, null);
  assert.equal(landed.lastResolution.outcome, "full");
});

function landWith(picked, built = newGame().built) {
  const state = { ...inFlight("bio-1", 10, { picked }), built };
  return foldLedger(state, { total: 10, totals: wealthy.totals, events: [], flow: null });
}

const colony = [
  { id: 1, structure: "hub", hex: 0 },
  { id: 2, structure: "sprout", hex: 1 },
];

test("right family and right tool captures", () => {
  const after = landWith("bio-1", colony);
  assert.equal(after.lastResolution.outcome, "capture");
  assert.deepEqual(after.captured, ["bio-1"]);
  assert.deepEqual(after.barren, []);
  assert.deepEqual(after.offline, []);
});

test("right family and wrong tool is half damage, with no structure offline", () => {
  const sameFamily = threats.find((row) => row.family === "biological" && row.tier !== 1);
  const after = landWith(sameFamily.id, colony);
  assert.equal(after.lastResolution.outcome, "half");
  assert.equal(after.barren.length, 1);
  assert.deepEqual(after.offline, []);
});

test("wrong family is full damage: tiles barren by tier and the target offline", () => {
  const other = threats.find((row) => row.family !== "biological");
  const after = landWith(other.id, colony);
  assert.equal(after.lastResolution.outcome, "full");
  assert.equal(after.barren.length, TUNING.tilesLostByTier[1]);
  assert.deepEqual(after.offline, [2]);
});

test("a defensive structure halves on its own and never captures", () => {
  const built = [...colony, { id: 3, structure: "bio-guard", hex: 5 }];
  const alone = landWith(null, built);
  assert.equal(alone.lastResolution.outcome, "half");
  assert.deepEqual(alone.captured, []);
  assert.equal(landWith("bio-1", built).lastResolution.outcome, "capture");
});

test("an offline defensive structure defends nothing", () => {
  const built = [...colony, { id: 3, structure: "bio-guard", hex: 5 }];
  const state = { ...inFlight("bio-1", 10), built, offline: [3] };
  const after = foldLedger(state, { total: 10, totals: wealthy.totals, events: [], flow: null });
  assert.equal(after.lastResolution.outcome, "full");
});

test("capturing never yields resources and the same capture does not stack", () => {
  const state = { ...inFlight("bio-1", 10, { picked: "bio-1" }), built: colony };
  const ledger = { total: 10, totals: { logic: 4, compute: 3, rare: 1 }, events: [], flow: null };
  const before = wallet(ledger, state);
  const after = foldLedger({ ...state, captured: ["bio-1"] }, ledger);
  assert.deepEqual(wallet(ledger, after), before);
  assert.deepEqual(after.captured, ["bio-1"]);
});

test("the hub never goes offline", () => {
  const other = threats.find((row) => row.family !== "biological");
  const after = landWith(other.id);
  assert.equal(after.lastResolution.outcome, "full");
  assert.deepEqual(after.offline, []);
});

test("barren tiles come back one per outcome, and nothing leaves the ledger", () => {
  const state = { ...newGame(), turn: 2, barren: [7, 8, 9] };
  const ledger = { total: 4, totals: { logic: 4, compute: 0, rare: 0 }, events: [], flow: null };
  const after = foldLedger(state, ledger);
  assert.deepEqual(after.barren, [9]);
  assert.equal(ledger.totals.logic, 4);
});

test("a countermeasure is paid once, from the balance, and cannot change", () => {
  const state = inFlight("bio-1", 20);
  const poor = { totals: { logic: 0, compute: 0, rare: 0 } };
  assert.equal(pickCountermeasure(state, poor, "bio-1"), null);
  const paid = pickCountermeasure(state, wealthy, "social-1");
  assert.deepEqual(paid.spent, { ...countermeasureCost("bio-1") });
  assert.equal(paid.threat.picked, "social-1");
  assert.equal(pickCountermeasure(paid, wealthy, "bio-1"), null);
  assert.equal(pickCountermeasure(newGame(), wealthy, "bio-1"), null);
  assert.equal(pickCountermeasure(state, wealthy, "no-such-threat"), null);
});

test("the cost scales with the tier, in Logic and Compute only", () => {
  const costs = [1, 2, 3].map((tier) => {
    const cost = countermeasureCost(threats.find((row) => row.tier === tier).id);
    assert.equal(cost.rare, 0);
    return cost.logic + cost.compute;
  });
  assert.ok(costs[0] < costs[1] && costs[1] < costs[2]);
});

test("every threat has a named countermeasure of its own family", () => {
  const list = countermeasures();
  assert.equal(list.length, threats.length);
  for (const entry of list) assert.equal(entry.family, threat(entry.id).family);
});

test("the grid has the shape of the page's map", () => {
  assert.equal(TILES.length, 61);
  assert.deepEqual(hexTiles(1).slice(0, 2), [
    { q: 0, r: 0 },
    { q: -1, r: 1 },
  ]);
  assert.equal(ring(0), 0);
  assert.equal(ring(60), 4);
});

test("the catalog's twoHex list sets which structures take two hexes", () => {
  const ids = structures.map((row) => row.id);
  const twoHex = ids.filter((id) => spanOf(id) === 2).sort();
  assert.deepEqual(twoHex, ["block", "hub", "relay", "sprout"]);
  assert.deepEqual(footprint("tower", 3), [3]);
  assert.deepEqual(footprint("sprout", 0), [0, partner(0)]);
});

test("a new colony has the hub on hex 0, free, and it cannot be queued again", () => {
  const state = newGame();
  assert.deepEqual(state.built, [{ id: 1, structure: "hub", hex: 0 }]);
  assert.deepEqual(state.spent, { logic: 0, compute: 0, rare: 0 });
  assert.equal(buildBlocker(state, wealthy, "hub"), "Already on the map");
  assert.equal(greenTiles({ totals: { logic: 0, compute: 0, rare: 0 } }, state), 2);
});

function firstLegal(state, ledger, id, terrain = TERRAIN) {
  return TILES.findIndex((_, hex) => canPlace(state, ledger, id, hex, { terrain }));
}

test("placement follows the terrain letters, the fog and what already stands", () => {
  const state = newGame();
  const hex = firstLegal(state, wealthy, "tower");
  assert.ok(hex > 0);
  assert.equal(canPlace(state, wealthy, "tower", 0, { terrain: TERRAIN }), false);
  const woods = "v".repeat(TILES.length);
  assert.equal(firstLegal(state, wealthy, "tower", woods), -1);
  const slate = "s".repeat(TILES.length);
  assert.equal(firstLegal(state, wealthy, "tower", slate), -1);
  assert.ok(firstLegal(state, wealthy, "frost-post", slate) > 0);
  assert.equal(firstLegal(state, wealthy, "frost-post", TERRAIN), -1);
  const empty = { totals: { logic: 0, compute: 0, rare: 0 } };
  const farthest = TILES.findIndex((_, i) => ring(i) === 4);
  assert.equal(canPlace(state, empty, "tower", farthest, { terrain: TERRAIN }), false);
  assert.equal(revealedRing(empty, state), 2);
  assert.equal(revealedRing(empty, state, 3), 3);
});

test("a two-hex structure needs both tiles free and on the map", () => {
  const state = newGame();
  const hex = firstLegal(state, wealthy, "sprout");
  const placed = queueBuild(state, wealthy, "sprout", hex, { now: NOW, terrain: TERRAIN });
  assert.equal(canPlace(placed, wealthy, "tower", partner(hex), { terrain: TERRAIN }), false);
  const edge = TILES.findIndex((_, i) => partner(i) === -1);
  assert.equal(canPlace(state, wealthy, "sprout", edge, { terrain: TERRAIN }), false);
});

test("queueing spends the cost and timers settle lazily at startedAt plus duration", () => {
  const start = newGame();
  const hex = firstLegal(start, wealthy, "sprout");
  const queued = queueBuild(start, wealthy, "sprout", hex, { now: NOW, terrain: TERRAIN });
  assert.deepEqual(queued.spent, { logic: 2, compute: 0, rare: 0 });
  const duration = 45 * 60_000;
  assert.equal(settle(queued, NOW + duration - 1), queued);
  const done = settle(queued, NOW + duration);
  assert.deepEqual(done.queue, []);
  assert.equal(done.built.at(-1).structure, "sprout");
});

test("flow overclock shortens a build only while the streak is fresh", () => {
  const start = newGame();
  const hex = firstLegal(start, wealthy, "sprout");
  const queued = queueBuild(start, wealthy, "sprout", hex, { now: NOW, terrain: TERRAIN });
  const at = NOW + 45 * 60_000 * TUNING.overclock;
  const fresh = { streak: 3, lastClosedAt: new Date(at - 60_000).toISOString() };
  const stale = { streak: 3, lastClosedAt: new Date(at - TUNING.flowWindowMs - 1).toISOString() };
  assert.equal(settle(queued, at, fresh).queue.length, 0);
  assert.equal(settle(queued, at, stale).queue.length, 1);
  assert.equal(settle(queued, at, { streak: 2, lastClosedAt: fresh.lastClosedAt }).queue.length, 1);
});

test("three build lines, and no build without the resources", () => {
  let state = newGame();
  for (const id of ["tower", "tower", "tower"]) {
    const hex = firstLegal(state, wealthy, id);
    state = queueBuild(state, wealthy, id, hex, { now: NOW, terrain: TERRAIN });
  }
  assert.equal(buildBlocker(state, wealthy, "sprout"), "All three build lines are busy");
  const hex = firstLegal(state, wealthy, "sprout");
  assert.equal(queueBuild(state, wealthy, "sprout", hex, { now: NOW, terrain: TERRAIN }), null);
  const poor = { totals: { logic: 1, compute: 0, rare: 0 } };
  assert.equal(buildBlocker(newGame(), poor, "sprout"), "Not enough resources yet");
});

test("repair returns an offline structure at half cost and half time", () => {
  const base = { ...newGame(), built: colony, offline: [2], seq: 2 };
  assert.equal(queueRepair(base, wealthy, 1, { now: NOW }), null);
  const repairing = queueRepair(base, wealthy, 2, { now: NOW });
  assert.deepEqual(repairing.spent, { logic: 1, compute: 0, rare: 0 });
  assert.equal(queueRepair(repairing, wealthy, 2, { now: NOW }), null);
  const halfTime = 45 * 30_000;
  assert.deepEqual(settle(repairing, NOW + halfTime - 1).offline, [2]);
  const back = settle(repairing, NOW + halfTime);
  assert.deepEqual(back.offline, []);
  assert.equal(back.built.length, 2);
});

test("an offline structure gives no green", () => {
  const empty = { totals: { logic: 0, compute: 0, rare: 0 } };
  const up = { ...newGame(), built: colony };
  assert.equal(greenTiles(empty, up), 5);
  assert.equal(greenTiles(empty, { ...up, offline: [2] }), 2);
  assert.equal(greenTiles(empty, { ...up, barren: [9] }), 4);
});

test("a malformed save is a new colony; a good one survives storage", () => {
  for (const raw of [
    null,
    7,
    { v: 2 },
    { v: 1 },
    { v: 1, built: [{ structure: "nope", hex: 0 }] },
  ]) {
    assert.deepEqual(parseState(raw), newGame());
  }
  const state = foldLedger(inFlight("bio-1", 30), ledgerOf(25));
  const stored = JSON.parse(JSON.stringify(state));
  assert.deepEqual(parseState(stored), state);
  const tampered = parseState({
    ...stored,
    spent: { logic: -5, compute: "x" },
    captured: ["nope"],
  });
  assert.deepEqual(tampered.spent, { logic: 0, compute: 0, rare: 0 });
  assert.deepEqual(tampered.captured, []);
});

test("the engine sources import no catalog or JSON: the host passes the catalog in", () => {
  for (const name of readdirSync(new URL("../src/", import.meta.url))) {
    const source = readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /catalog\/|\.json\b|type:\s*["']json["']/, name);
    for (const specifier of source.matchAll(/^import[^;]*from\s+["']([^"']+)["']/gm)) {
      assert.match(specifier[1], /^\.\/[a-z]+\.mjs$/, `${name} imports ${specifier[1]}`);
    }
  }
});

test("the placeholder catalog holds what the rules read", () => {
  assert.deepEqual(validateRulesCatalog(placeholderCatalog), []);
  assert.equal(createRules(placeholderCatalog).hub, "hub");
});

test("createRules refuses a catalog the rules cannot run on, and lists why", () => {
  const { structures: rows, threats: list } = placeholderCatalog;
  const noHub = { structures: rows.filter((row) => row.terrain !== "centre"), threats: list };
  assert.throws(() => createRules(noHub), /exactly one structure needs terrain centre, found 0/);
  const noTier3 = { structures: rows, threats: list.filter((row) => row.tier !== 3) };
  assert.throws(() => createRules(noTier3), /no threat of tier 3/);
  assert.throws(
    () => createRules({ ...placeholderCatalog, twoHex: ["no-such-structure"] }),
    /twoHex: unknown structure no-such-structure/,
  );
  assert.throws(() => createRules({}), /structures and threats must be lists/);
  assert.throws(() => createRules(undefined), /structures and threats must be lists/);
});

test("two bound catalogs share nothing", () => {
  const renamed = {
    structures: placeholderCatalog.structures.map((row) =>
      row.terrain === "centre" ? { ...row, id: "core" } : row,
    ),
    threats: placeholderCatalog.threats,
    twoHex: [],
  };
  const other = createRules(renamed);
  assert.deepEqual(other.newGame().built, [{ id: 1, structure: "core", hex: 0 }]);
  assert.deepEqual(newGame().built, [{ id: 1, structure: "hub", hex: 0 }]);
  assert.equal(other.spanOf("sprout"), 1);
  assert.equal(spanOf("sprout"), 2);
  assert.deepEqual(other.parseState(JSON.parse(JSON.stringify(newGame()))), other.newGame());
});
