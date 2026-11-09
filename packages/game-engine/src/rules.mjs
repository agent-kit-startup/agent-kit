/**
 * The game rules: pure functions over the outcome ledger and the player's state. No DOM, fs,
 * fetch, timers or clock of their own: the host passes `now`, and nothing happens until it calls
 * in. The engine holds no content: names and numbers per row come from the catalog the host
 * passes to `createRules`. See "Rules" in this package's README for the contract.
 *
 * Host contract: call `foldLedger` while the game is on screen, not from a background refresh,
 * so that one call covers everything that shipped since the player last looked.
 */
import { validateRulesCatalog } from "./validate.mjs";
import { fitsTerrain, MAP_RADIUS, partner, ring, TILES } from "./world.mjs";

/** One ledger entry earns one unit of one resource. Mirrors OUTCOME_KINDS in the kit's ledger. */
export const OUTCOME_RESOURCE = Object.freeze({
  todo: "logic",
  test: "logic",
  ci: "compute",
  releaseCut: "compute",
  plan: "rare",
  review: "rare",
  releasePublished: "rare",
});

/** Tuning, not contract: every chance, cost and threshold the catalog does not hold. */
export const TUNING = Object.freeze({
  maxBuilds: 3,
  flowStreak: 3,
  flowWindowMs: 2 * 60 * 60 * 1000,
  overclock: 0.75,
  quietTurns: 4,
  attackChanceByTier: { 1: 1 / 8, 2: 1 / 6, 3: 1 / 5 },
  rareEnemyFactor: 0.5,
  arrivalTurns: { min: 3, max: 6 },
  unlock: { 2: { green: 12, built: 4 }, 3: { green: 30, built: 8 } },
  countermeasureCostByTier: {
    1: { logic: 2, compute: 2, rare: 0 },
    2: { logic: 3, compute: 2, rare: 0 },
    3: { logic: 3, compute: 3, rare: 0 },
  },
  tilesLostByTier: { 1: 2, 2: 3, 3: 4 },
  ledgerGreenShare: 0.6,
});

/** Event keys kept in the state. Only has to outlast the ledger's newest-entries window. */
const SEEN_WINDOW = 64;
const RESOURCES = ["logic", "compute", "rare"];

const whole = (n) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
const isNumber = (n) => typeof n === "number" && Number.isFinite(n);
const addCost = (a, b) => ({
  logic: a.logic + b.logic,
  compute: a.compute + b.compute,
  rare: a.rare + b.rare,
});
const canPay = (purse, cost) => RESOURCES.every((key) => purse[key] >= cost[key]);

function knownEvents(rows) {
  return rows
    .filter((row) => row && typeof row.key === "string" && OUTCOME_RESOURCE[row.kind])
    .map((row) => ({ key: row.key, kind: row.kind, at: row.at ?? null }));
}

/** Oldest first, the same order on every machine. */
function byTime(a, b) {
  const [at, bt] = [a.at ?? "", b.at ?? ""];
  if (at !== bt) return at < bt ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** The ledger view from parsed entries (`parseOutcomeLedger(raw).entries`): every event has a key. */
export function ledgerFromEntries(entries, flow = null) {
  const rows = Object.entries(entries ?? {}).map(([key, entry]) => ({ ...entry, key }));
  const events = knownEvents(rows).sort(byTime);
  const totals = { logic: 0, compute: 0, rare: 0 };
  for (const event of events) totals[OUTCOME_RESOURCE[event.kind]] += 1;
  return { total: events.length, totals, events, flow };
}

/**
 * The ledger view from the snapshot's `outcomeLedger`, which only lists its newest entries. Older
 * events it does not list still count as turns, but with no key they roll no dice.
 */
export function ledgerFromSnapshot(summary) {
  const totals = summary?.totals ?? {};
  return {
    total: whole(summary?.entries),
    totals: {
      logic: whole(totals.logic),
      compute: whole(totals.compute),
      rare: whole(totals.rare),
    },
    events: knownEvents(Array.isArray(summary?.recent) ? summary.recent : []).sort(byTime),
    flow: summary?.flow ?? null,
  };
}

/** Spendable: earned from the ledger minus spent, never below zero. */
export function wallet(ledger, state) {
  return {
    logic: Math.max(0, ledger.totals.logic - state.spent.logic),
    compute: Math.max(0, ledger.totals.compute - state.spent.compute),
    rare: Math.max(0, ledger.totals.rare - state.spent.rare),
  };
}

/** Flow overclock: enough to-dos closed in a row, the last within the window. */
export function overclockActive(flow, now) {
  if (!flow || !isNumber(flow.streak) || flow.streak < TUNING.flowStreak) return false;
  const last = Date.parse(flow.lastClosedAt ?? "");
  return Number.isFinite(last) && now - last >= 0 && now - last <= TUNING.flowWindowMs;
}

export function buildEndsAt(build, overclock) {
  return build.startedAt + build.durationMs * (overclock ? TUNING.overclock : 1);
}

/** Lazy timers: a build ends at startedAt plus its duration, evaluated when the host asks. */
export function settle(state, now, flow = null) {
  const overclock = overclockActive(flow, now);
  const done = state.queue.filter((build) => now >= buildEndsAt(build, overclock));
  if (!done.length) return state;
  const repaired = new Set(done.map((build) => build.rebuildOf));
  const fresh = done.filter((build) => build.rebuildOf === undefined);
  return {
    ...state,
    queue: state.queue.filter((build) => !done.includes(build)),
    offline: state.offline.filter((id) => !repaired.has(id)),
    built: [...state.built, ...fresh.map(({ id, structure, hex }) => ({ id, structure, hex }))],
  };
}

/** A number in [0, 1) from the event key: same key and salt, same number, on every machine. */
export function roll(key, salt) {
  let hash = 0x811c9dc5;
  for (const char of `${key}\u0000${salt}`) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 2 ** 32;
}

/** Turns until the attack in flight lands, or null with none. */
export function turnsLeft(state) {
  return state.threat ? state.threat.arrivesAt - state.turn : null;
}

/**
 * Binds the rules to a catalog: `structures` and `threats` in the shape `validateRulesCatalog`
 * checks, and `twoHex`, the ids of the structures that stand on two hexes. The hub is the one
 * structure with terrain `centre`: it stands free on hex 0 of a new colony and never goes offline.
 * Throws a TypeError listing every problem when the catalog does not hold.
 *
 * @param {{structures: object[], threats: object[], twoHex?: string[]}} catalog
 */
export function createRules(catalog) {
  const problems = validateRulesCatalog(catalog);
  if (problems.length) throw new TypeError(`invalid rules catalog:\n- ${problems.join("\n- ")}`);
  const structures = catalog.structures.map((row) => Object.freeze({ ...row }));
  const threats = catalog.threats.map((row) => Object.freeze({ ...row }));
  const structureById = new Map(structures.map((row) => [row.id, row]));
  const threatById = new Map(threats.map((row) => [row.id, row]));
  const twoHex = new Set(catalog.twoHex ?? []);
  const HUB = structures.find((row) => row.terrain === "centre").id;

  /** 2 for a structure that stands on two hexes, else 1. */
  function spanOf(structureId) {
    return twoHex.has(structureId) ? 2 : 1;
  }

  /** Every tile a structure on `hex` covers. */
  function footprint(structureId, hex) {
    return spanOf(structureId) === 2 ? [hex, partner(hex)] : [hex];
  }

  /** A new colony: the hub already stands on hex 0, free, and nothing else has happened. */
  function newGame() {
    return {
      v: 1,
      seq: 1,
      turn: 0,
      seen: [],
      queue: [],
      built: [{ id: 1, structure: HUB, hex: 0 }],
      spent: { logic: 0, compute: 0, rare: 0 },
      offline: [],
      barren: [],
      captured: [],
      threat: null,
      nextAttackTurn: TUNING.quietTurns,
      lastResolution: null,
    };
  }

  /** Normalized player state from storage. Malformed input is a new colony, never a throw. */
  function parseState(raw) {
    if (!raw || typeof raw !== "object" || raw.v !== 1) return newGame();
    const list = (value) => (Array.isArray(value) ? value : []);
    const placed = (row) =>
      row && structureById.has(row.structure) && Number.isInteger(row.hex) && TILES[row.hex];
    const built = list(raw.built)
      .filter(placed)
      .map((row) => ({ id: whole(row.id), structure: row.structure, hex: row.hex }));
    if (!built.some((row) => row.structure === HUB)) return newGame();
    const queue = list(raw.queue)
      .filter((row) => placed(row) && isNumber(row.startedAt) && isNumber(row.durationMs))
      .slice(0, TUNING.maxBuilds)
      .map((row) => ({
        id: whole(row.id),
        structure: row.structure,
        hex: row.hex,
        startedAt: row.startedAt,
        durationMs: row.durationMs,
        ...(isNumber(row.rebuildOf) ? { rebuildOf: row.rebuildOf } : {}),
      }));
    const spent = raw.spent && typeof raw.spent === "object" ? raw.spent : {};
    const threat = raw.threat;
    const threatOk = threat && threatById.has(threat.id) && Number.isInteger(threat.arrivesAt);
    return {
      v: 1,
      seq: whole(raw.seq),
      turn: whole(raw.turn),
      seen: list(raw.seen)
        .filter((key) => typeof key === "string")
        .slice(-SEEN_WINDOW),
      queue,
      built,
      spent: { logic: whole(spent.logic), compute: whole(spent.compute), rare: whole(spent.rare) },
      offline: list(raw.offline).filter(Number.isInteger),
      barren: list(raw.barren).filter(Number.isInteger),
      captured: list(raw.captured).filter((id) => threatById.has(id)),
      threat: threatOk
        ? {
            id: threat.id,
            target: whole(threat.target),
            arrivesAt: threat.arrivesAt,
            picked: threatById.has(threat.picked) ? threat.picked : null,
          }
        : null,
      nextAttackTurn: whole(raw.nextAttackTurn),
      lastResolution: threatById.has(raw.lastResolution?.threat) ? raw.lastResolution : null,
    };
  }

  /** The ledger clears ground slowly, up to a share of the map; structures green the rest. */
  function greenTiles(ledger, state) {
    const { logic, compute, rare } = ledger.totals;
    const fromLedger = Math.floor(Math.sqrt(logic + compute / 4) * 2) + rare;
    let green = Math.min(Math.floor(TILES.length * TUNING.ledgerGreenShare), fromLedger);
    for (const row of state.built) {
      if (!state.offline.includes(row.id)) green += structureById.get(row.structure).greens;
    }
    return Math.max(1, Math.min(TILES.length, green - state.barren.length));
  }

  /** Rings the fog has left. `minRing` lets a host open more of the map at the start. */
  function revealedRing(ledger, state, minRing = 0) {
    const index = greenTiles(ledger, state) + state.barren.length - 1;
    const reached = Math.min(MAP_RADIUS, ring(Math.min(TILES.length - 1, index)) + 1);
    return Math.max(minRing, reached);
  }

  function occupiedTiles(state) {
    const occupied = new Set();
    for (const row of [...state.built, ...state.queue.filter((b) => b.rebuildOf === undefined)]) {
      for (const hex of footprint(row.structure, row.hex)) occupied.add(hex);
    }
    return occupied;
  }

  /** Whether a structure can stand on `hex` now. `terrain` holds one letter per tile. */
  function canPlace(state, ledger, structureId, hex, { terrain, minRing = 0 }) {
    const row = structureById.get(structureId);
    if (!row) return false;
    const reach = revealedRing(ledger, state, minRing);
    const occupied = occupiedTiles(state);
    const free = (tile) =>
      tile >= 0 &&
      TILES[tile] !== undefined &&
      ring(tile) <= reach &&
      !occupied.has(tile) &&
      fitsTerrain(terrain[tile], row.terrain);
    return free(hex) && (spanOf(structureId) === 1 || free(footprint(structureId, hex)[1]));
  }

  /** Why a structure cannot be queued now, or null when it can. */
  function buildBlocker(state, ledger, structureId) {
    const row = structureById.get(structureId);
    if (!row) return "Unknown structure";
    const placed = [...state.built, ...state.queue];
    if (row.unique && placed.some((other) => other.structure === row.id))
      return "Already on the map";
    if (state.queue.length >= TUNING.maxBuilds) return "All three build lines are busy";
    if (!canPay(wallet(ledger, state), row.cost)) return "Not enough resources yet";
    return null;
  }

  /** Spend the cost and start the timer. Null when the build or the hex is refused. */
  function queueBuild(state, ledger, structureId, hex, { now, terrain, minRing = 0 }) {
    if (buildBlocker(state, ledger, structureId)) return null;
    if (!canPlace(state, ledger, structureId, hex, { terrain, minRing })) return null;
    const row = structureById.get(structureId);
    const seq = state.seq + 1;
    const build = {
      id: seq,
      structure: row.id,
      hex,
      startedAt: now,
      durationMs: row.build_minutes * 60_000,
    };
    return {
      ...state,
      seq,
      queue: [...state.queue, build],
      spent: addCost(state.spent, row.cost),
    };
  }

  /** Repair: an offline structure returns through the queue at half its cost and time. */
  function queueRepair(state, ledger, builtId, { now }) {
    const target = state.built.find((row) => row.id === builtId);
    if (!target || !state.offline.includes(builtId)) return null;
    if (state.queue.some((build) => build.rebuildOf === builtId)) return null;
    if (state.queue.length >= TUNING.maxBuilds) return null;
    const row = structureById.get(target.structure);
    const cost = {
      logic: Math.ceil(row.cost.logic / 2),
      compute: Math.ceil(row.cost.compute / 2),
      rare: Math.ceil(row.cost.rare / 2),
    };
    if (!canPay(wallet(ledger, state), cost)) return null;
    const seq = state.seq + 1;
    const build = {
      id: seq,
      structure: row.id,
      hex: target.hex,
      startedAt: now,
      durationMs: row.build_minutes * 30_000,
      rebuildOf: builtId,
    };
    return {
      ...state,
      seq,
      queue: [...state.queue, build],
      spent: addCost(state.spent, cost),
    };
  }

  /** Highest threat tier this colony has unlocked, by size and never by calendar. */
  function unlockedTier(ledger, state) {
    const green = greenTiles(ledger, state);
    const built = state.built.length;
    const reaches = (tier) => {
      const need = TUNING.unlock[tier];
      return green >= need.green || built >= need.built;
    };
    if (reaches(3)) return 3;
    return reaches(2) ? 2 : 1;
  }

  function bornThreat(state, ledger, key, enemy) {
    const tier = unlockedTier(ledger, state);
    const factor = enemy === "rare" ? TUNING.rareEnemyFactor : 1;
    if (roll(key, "attack") >= TUNING.attackChanceByTier[tier] * factor) return null;
    const pool = threats.filter((row) => row.tier <= tier);
    const threat = pool[Math.floor(roll(key, "vector") * pool.length)];
    const live = state.built.filter((row) => !state.offline.includes(row.id));
    const targets = live.filter((row) => row.structure !== HUB);
    const among = targets.length ? targets : live;
    const target = among[Math.floor(roll(key, "target") * among.length)];
    const { min, max } = TUNING.arrivalTurns;
    const arrival = min + Math.floor(roll(key, "arrival") * (max - min + 1));
    return { id: threat.id, target: target.id, arrivesAt: state.turn + arrival, picked: null };
  }

  function defendedFamilies(state) {
    const families = new Set();
    for (const row of state.built) {
      if (state.offline.includes(row.id)) continue;
      const guarded = threatById.get(structureById.get(row.structure).countermeasure_for);
      if (guarded) families.add(guarded.family);
    }
    return families;
  }

  function resolveThreat(state) {
    const { id, picked, target } = state.threat;
    const threat = threatById.get(id);
    let outcome = "full";
    if (picked === id) outcome = "capture";
    else if (threatById.get(picked)?.family === threat.family) outcome = "half";
    else if (defendedFamilies(state).has(threat.family)) outcome = "half";

    const next = {
      ...state,
      threat: null,
      nextAttackTurn: state.turn + TUNING.quietTurns,
      lastResolution: { threat: id, picked, outcome, turn: state.turn },
    };
    if (outcome === "capture") {
      next.captured = state.captured.includes(id) ? state.captured : [...state.captured, id];
      return next;
    }
    const full = TUNING.tilesLostByTier[threat.tier];
    const lost = outcome === "half" ? Math.ceil(full / 2) : full;
    const occupied = occupiedTiles(state);
    const open = TILES.map((_, index) => index).filter(
      (index) =>
        index > 0 && ring(index) <= 2 && !occupied.has(index) && !state.barren.includes(index),
    );
    next.barren = [...state.barren, ...open.slice(-lost)];
    if (outcome === "full") {
      const live = state.built.filter(
        (row) => row.structure !== HUB && !state.offline.includes(row.id),
      );
      const hit = live.find((row) => row.id === target) ?? live.at(-1);
      if (hit) next.offline = [...state.offline, hit.id];
    }
    return next;
  }

  function advance(state, key, { mayLand, ledger, enemy }) {
    const next = { ...state, turn: state.turn + 1, barren: state.barren.slice(1) };
    if (next.threat) {
      if (next.turn < next.threat.arrivesAt) return next;
      if (mayLand) return resolveThreat(next);
      return { ...next, threat: { ...next.threat, arrivesAt: next.turn + 1 } };
    }
    if (key === null || enemy === "off" || next.turn < next.nextAttackTurn) return next;
    const threat = bornThreat(next, ledger, key, enemy);
    return threat ? { ...next, threat } : next;
  }

  /**
   * Advance one turn per ledger event the state has not counted. The turn number is the ledger
   * length, so an event already counted makes no second turn. Time plays no part.
   *
   * Only the first event of a call can land an attack. The rest count it down to one turn left, so
   * whatever shipped while the player was away, an attack they have not seen never lands unseen
   * and they always get a turn to answer.
   *
   * @param {{enemy?: "on"|"rare"|"off"}} [options] the player's enemy preference
   */
  function foldLedger(state, ledger, { enemy = "on" } = {}) {
    const missing = ledger.total - state.turn;
    if (missing <= 0) return state;
    const seen = new Set(state.seen);
    const fresh = ledger.events.filter((event) => !seen.has(event.key)).slice(-missing);
    const keys = [...Array(missing - fresh.length).fill(null), ...fresh.map((event) => event.key)];
    let next = state;
    keys.forEach((key, index) => {
      next = advance(next, key, { mayLand: index === 0, ledger, enemy });
    });
    const counted = fresh.map((event) => event.key);
    return { ...next, seen: [...state.seen, ...counted].slice(-SEEN_WINDOW) };
  }

  /** Every countermeasure in the catalog, by the threat it answers. */
  function countermeasures() {
    return threats.map((row) => ({ id: row.id, name: row.countermeasure, family: row.family }));
  }

  function countermeasureCost(threatId) {
    return TUNING.countermeasureCostByTier[threatById.get(threatId).tier];
  }

  /** Pay for one countermeasure against the attack in flight. One per attack, and it cannot change. */
  function pickCountermeasure(state, ledger, countermeasureId) {
    if (!state.threat || state.threat.picked || !threatById.has(countermeasureId)) return null;
    const cost = countermeasureCost(state.threat.id);
    if (!canPay(wallet(ledger, state), cost)) return null;
    return {
      ...state,
      spent: addCost(state.spent, cost),
      threat: { ...state.threat, picked: countermeasureId },
    };
  }

  return Object.freeze({
    structures: Object.freeze(structures),
    threats: Object.freeze(threats),
    hub: HUB,
    spanOf,
    footprint,
    newGame,
    parseState,
    greenTiles,
    revealedRing,
    canPlace,
    buildBlocker,
    queueBuild,
    queueRepair,
    unlockedTier,
    foldLedger,
    countermeasures,
    countermeasureCost,
    pickCountermeasure,
  });
}
