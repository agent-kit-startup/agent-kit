// Mission Control Colony panel (dashboard.html), ADR 2026-10-23
// colony-game-canon-outcome-ledger-art-policy: runs the shipped render and game
// functions in a sandbox. Earned totals come from the snapshot outcomeLedger;
// player state is browser-local; timers are evaluated lazily at render.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const html = readFileSync(resolve(repoRoot, "dashboard/dashboard.html"), "utf8");

function fn(name: string): string {
  const m = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(html);
  if (!m) throw new Error(`function ${name} not found in dashboard.html`);
  return m[0];
}

function constant(name: string): string {
  const m = new RegExp(`const ${name} =[\\s\\S]*?;\\n`).exec(html);
  if (!m) throw new Error(`const ${name} not found in dashboard.html`);
  return m[0];
}

type State = {
  v: 1;
  seq: number;
  queue: { id: number; structure: string; startedAt: number; durationMs: number }[];
  built: { structure: string; completedAt: number }[];
  spent: { logic: number; compute: number; rare: number };
};
type Earned = { logic: number; compute: number; rare: number };
type Game = {
  renderColonySection: (d: unknown, state: State, nowMs: number) => string;
  parseColonyState: (raw: unknown) => State;
  colonyHexTiles: (radius: number) => { q: number; r: number }[];
  colonyEarned: (ledger: unknown) => Earned;
  colonyWallet: (earned: Earned, state: State) => Earned;
  colonyOverclockActive: (flow: unknown, nowMs: number) => boolean;
  settleColonyState: (
    s: State,
    nowMs: number,
    overclock: boolean,
  ) => { state: State; changed: boolean };
  queueColonyBuild: (s: State, id: string, earned: Earned, nowMs: number) => State | null;
  colonyGreenTiles: (earned: Earned, s: State, tileCount: number) => number;
};

function loadGame(): Game {
  const body = [
    constant("PASTE_DESTINATIONS"),
    constant("PROMPT_RESUME_GUIDANCE"),
    constant("COLONY_STATE_KEY"),
    constant("COLONY_MAP_RADIUS"),
    constant("COLONY_MAX_ACTIVE_BUILDS"),
    constant("COLONY_FLOW_STREAK"),
    constant("COLONY_FLOW_WINDOW_MS"),
    constant("COLONY_OVERCLOCK_FACTOR"),
    constant("COLONY_STRUCTURES"),
    ...[
      "escapeHtml",
      "escapeAttr",
      "escapeJsString",
      "pasteDestinationLabel",
      "isPasteOnlyShellTarget",
      "copyActionTitle",
      "copyForPasteHandler",
      "spaceIconSvg",
      "renderEmptyStateCta",
      "colonyHexTiles",
      "parseColonyState",
      "colonyEarned",
      "colonyWallet",
      "colonyOverclockActive",
      "colonyBuildEndsAt",
      "settleColonyState",
      "colonyBuildBlocker",
      "queueColonyBuild",
      "colonyGreenTiles",
      "formatColonyDuration",
      "formatColonyCost",
      "renderColonyMapSvg",
      "renderColonySection",
    ].map(fn),
    "return { renderColonySection, parseColonyState, colonyHexTiles, colonyEarned, colonyWallet, colonyOverclockActive, settleColonyState, queueColonyBuild, colonyGreenTiles };",
  ].join("\n");
  return runInNewContext(`(function(){\n${body}\n})()`, {
    Date,
    Number,
    Array,
    String,
    Math,
    Object,
    Set,
  }) as Game;
}

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const MIN = 60_000;

function ledger(over: Record<string, unknown> = {}) {
  return {
    available: true,
    reason: null,
    version: 1,
    path: ".cursor/context/outcome-ledger.json",
    entries: 0,
    totals: { logic: 0, compute: 0, rare: 0 },
    byKind: {},
    recent: [],
    flow: null,
    tests: { configured: false, lastRun: null },
    ...over,
  };
}

describe("Colony panel", () => {
  const g = loadGame();
  const empty = g.parseColonyState(null);

  it("renders a grey, fogged map with an empty ledger (fresh install)", () => {
    const out = g.renderColonySection({ outcomeLedger: ledger() }, empty, NOW);
    expect(out).toContain('id="section-colony"');
    expect(out).toContain("0 of 61 tiles green");
    expect(out).not.toContain('data-tile="green"');
    expect(out).toContain('data-tile="fog"');
    expect(out).toContain("Nothing earned yet");
    // Nothing affordable: every Build button is disabled.
    expect(out.match(/data-colony-build=/g)?.length).toBe(5);
    expect(out.match(/ disabled /g)?.length).toBe(5);
  });

  it("shows an update hint when the snapshot predates outcomeLedger", () => {
    const out = g.renderColonySection({}, empty, NOW);
    expect(out).toContain("No outcome ledger in this snapshot");
    expect(out).toContain("1.9.0");
  });

  it("renders a long history without painting past the map and escapes ledger labels", () => {
    const out = g.renderColonySection(
      {
        outcomeLedger: ledger({
          entries: 1491,
          totals: { logic: 190, compute: 1257, rare: 44 },
          recent: [
            {
              key: "k",
              kind: "todo",
              resource: "logic",
              at: null,
              label: '<img src=x onerror="alert(1)">',
            },
          ],
        }),
      },
      empty,
      NOW,
    );
    // Outcomes alone green at most 60% of the map; buildings green the rest.
    expect(out).toContain("36 of 61 tiles green");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x");
    expect(g.colonyGreenTiles({ logic: 1e9, compute: 1e9, rare: 1e9 }, empty, 61)).toBe(36);
    const builtOut = g.parseColonyState({
      v: 1,
      seq: 0,
      queue: [],
      built: Array.from({ length: 4 }, () => ({ structure: "purifier", completedAt: NOW })),
      spent: { logic: 0, compute: 0, rare: 0 },
    });
    expect(g.colonyGreenTiles({ logic: 1e9, compute: 1e9, rare: 1e9 }, builtOut, 61)).toBe(61);
  });

  it("spends from earned minus spent and never below zero", () => {
    const earned = { logic: 3, compute: 4, rare: 0 };
    const next = g.queueColonyBuild(empty, "nursery", earned, NOW);
    expect(next?.spent).toEqual({ logic: 2, compute: 0, rare: 0 });
    expect(g.colonyWallet(earned, next as State)).toEqual({ logic: 1, compute: 4, rare: 0 });
    // Second nursery is unaffordable.
    expect(g.queueColonyBuild(next as State, "nursery", earned, NOW)).toBeNull();
    // A ledger that shrank (pruned history) never yields a negative wallet.
    expect(g.colonyWallet({ logic: 0, compute: 0, rare: 0 }, next as State)).toEqual({
      logic: 0,
      compute: 0,
      rare: 0,
    });
  });

  it("allows one uplink and caps the queue", () => {
    const rich = { logic: 1000, compute: 1000, rare: 10 };
    let s = g.queueColonyBuild(empty, "uplink", rich, NOW) as State;
    expect(g.queueColonyBuild(s, "uplink", rich, NOW)).toBeNull();
    s = g.queueColonyBuild(s, "nursery", rich, NOW) as State;
    s = g.queueColonyBuild(s, "tundra", rich, NOW) as State;
    expect(s.queue).toHaveLength(3);
    expect(g.queueColonyBuild(s, "nursery", rich, NOW)).toBeNull();
  });

  it("evaluates timers lazily at render and keeps finished builds once settled", () => {
    const rich = { logic: 10, compute: 10, rare: 0 };
    const s = g.queueColonyBuild(empty, "nursery", rich, NOW) as State; // 45 min
    expect(g.settleColonyState(s, NOW + 44 * MIN, false).changed).toBe(false);
    const done = g.settleColonyState(s, NOW + 45 * MIN, false);
    expect(done.changed).toBe(true);
    expect(done.state.queue).toHaveLength(0);
    expect(done.state.built).toEqual([{ structure: "nursery", completedAt: NOW + 45 * MIN }]);
    // Overclock: 25% off the active timer.
    expect(g.settleColonyState(s, NOW + 34 * MIN, true).changed).toBe(true);
    // Built structures green extra tiles and show on the map.
    const out = g.renderColonySection(
      { outcomeLedger: ledger({ totals: rich }) },
      done.state,
      NOW + 46 * MIN,
    );
    expect(out).toMatch(/<text class="colony-glyph"[^>]*>N<\/text>/);
  });

  it("turns the overclock on only for a recent unbroken streak", () => {
    const flow = {
      plan: "p.plan.md",
      streak: 3,
      lastClosedAt: "2026-10-24T11:00:00.000Z",
      brokenAt: null,
    };
    expect(g.colonyOverclockActive(flow, NOW)).toBe(true);
    expect(g.colonyOverclockActive({ ...flow, streak: 2 }, NOW)).toBe(false);
    expect(g.colonyOverclockActive(flow, NOW + 3 * 60 * MIN)).toBe(false);
    expect(g.colonyOverclockActive(null, NOW)).toBe(false);
  });

  it("drops malformed stored state", () => {
    expect(g.parseColonyState({ v: 2 })).toEqual(empty);
    const s = g.parseColonyState({
      v: 1,
      seq: 2,
      queue: [{ id: 1, structure: "mine-people", startedAt: NOW, durationMs: 1 }],
      built: [
        { structure: "nursery", completedAt: NOW },
        { structure: "<script>", completedAt: NOW },
      ],
      spent: { logic: -5, compute: "x", rare: 1 },
    });
    expect(s.queue).toEqual([]);
    expect(s.built).toEqual([{ structure: "nursery", completedAt: NOW }]);
    expect(s.spent).toEqual({ logic: 0, compute: 0, rare: 1 });
  });

  it("uses a 61-tile hex map in spiral order from the center", () => {
    const tiles = g.colonyHexTiles(4);
    expect(tiles).toHaveLength(61);
    expect(tiles[0]).toEqual({ q: 0, r: 0 });
    expect(new Set(tiles.map((t) => `${t.q},${t.r}`)).size).toBe(61);
  });
});

describe("Colony panel contracts", () => {
  it("adds no timer and no server write", () => {
    const start = html.indexOf("// ===== Colony (game panel");
    const end = html.indexOf("function wireChatResumeButtons()");
    const block = html.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(block).not.toMatch(
      /setInterval|setTimeout|requestAnimationFrame|fetch\(|XMLHttpRequest|EventSource/,
    );
    expect(block).toContain("localStorage");
  });

  it("styles selection by border only: no left accent bar, no tinted highlight fill", () => {
    const start = html.indexOf("/* ===== Colony (game panel");
    const end = html.indexOf("/* ===== Chats (saved agent sessions)");
    const css = html.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(css).not.toMatch(/border-left|box-shadow\s*:\s*inset/);
    expect(css).not.toMatch(/-bg\)/);
  });

  it("ships at most 4 art images, 400 KB together, all webp and all referenced", () => {
    const dir = join(repoRoot, "dashboard", "art");
    const files = readdirSync(dir);
    expect(files.length).toBeLessThanOrEqual(4);
    expect(files.every((f) => f.endsWith(".webp"))).toBe(true);
    const total = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
    expect(total).toBeLessThanOrEqual(400 * 1024);
    for (const f of files) expect(html).toContain(`'/art/${f}'`);
    const referenced = [...html.matchAll(/'\/art\/([^']+)'/g)].map((m) => m[1]);
    for (const f of referenced) expect(files).toContain(f);
  });
});
