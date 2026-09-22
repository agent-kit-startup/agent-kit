import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SpawnInfo, claudeBackend, resetClaudeVersionCache } from "../plan-loop/backends.js";
import {
  type HitlGate,
  type HitlStop,
  hitlExitCode,
  operatorQuitStop,
} from "../plan-loop/hitl-relay.js";
import type { LiveRunFeed } from "./live-feed.js";
import {
  type LiveMissionIo,
  createLiveMissionLoader,
  readLiveMission,
  shouldUseLiveTui,
  withLiveTui,
} from "./live-run.js";
import type { McTuiStdin } from "./loop.js";

type SpawnFn = typeof spawn;

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "plan-loop",
  "fixtures",
);
const FAKE_CLAUDE = path.join(FIXTURES, "fake-claude.mjs");
const CLAUDE_FIXTURE = readFileSync(
  path.join(FIXTURES, "claude-stream-run-plan-all-queue-drift.log"),
  "utf8",
);
const ESC = String.fromCharCode(27);
const CSI_ALL = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const CLEAR_HOME = `${ESC}[2J${ESC}[H`;
const strip = (s: string) => s.replace(CSI_ALL, "");

const GATE: HitlGate = {
  askId: "queue-drift",
  labels: ["Run as proposed", "Edit the queue", "Cancel"],
  detection: "sentinel",
};

function fakeStdin(isTTY = true) {
  const listeners = new Set<(chunk: string | Buffer) => void>();
  const rawModes: boolean[] = [];
  let paused = 0;
  const stdin: McTuiStdin = {
    isTTY,
    setRawMode: (mode) => {
      rawModes.push(mode);
    },
    pause: () => {
      paused += 1;
    },
    resume: () => undefined,
    on: (_e, l) => {
      listeners.add(l);
    },
    off: (_e, l) => {
      listeners.delete(l);
    },
  };
  return {
    stdin,
    rawModes,
    emit: (chunk: string | Buffer) => {
      for (const l of listeners) l(chunk);
    },
    get paused() {
      return paused;
    },
  };
}

function harness(overrides: { columns?: number; rows?: number } = {}) {
  const writes: string[] = [];
  const io = fakeStdin();
  let tick: (() => void) | null = null;
  let cleared = 0;
  const opts = {
    root: "/repo",
    backend: "claude",
    logPath: "/repo/.cursor/loop-logs/run-1.log",
    stdin: io.stdin,
    write: (chunk: string) => {
      writes.push(chunk);
    },
    columns: overrides.columns ?? 80,
    rows: overrides.rows ?? 24,
    env: {},
    now: () => 60_000,
    signals: false,
    setIntervalFn: ((fn: () => void) => {
      tick = fn;
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setInterval,
    clearIntervalFn: (() => {
      cleared += 1;
    }) as typeof clearInterval,
    missionLoader: async () => ({
      mission: {
        planFile: "demo.plan.md",
        mode: "run-plan-all",
        todos: { done: 2, total: 6 },
        currentTodo: "phase3-mc-tui-live-feed",
        nextTodo: "phase4-inference-efficiency",
        queue: { done: 1, total: 4, current: "demo.plan.md", status: "running" },
      },
      checklist: [
        { label: "a.plan.md", state: "done" as const },
        { label: "demo.plan.md", state: "current" as const },
        { label: "c.plan.md", state: "pending" as const },
      ],
    }),
  };
  const frames = () =>
    writes
      .join("")
      .split(CLEAR_HOME)
      .map((f) => strip(f).replace(/\n+$/, ""))
      .filter((f) => f.includes("Mission Control"));
  const settle = () => new Promise<void>((r) => setImmediate(r));
  return {
    opts,
    io,
    writes,
    frames,
    settle,
    tick: () => tick?.(),
    get cleared() {
      return cleared;
    },
  };
}

describe("shouldUseLiveTui", () => {
  it("is on for a TTY pair with the color gate open", () => {
    expect(shouldUseLiveTui({ stdoutIsTTY: true, stdinIsTTY: true, env: {} })).toBe(true);
  });

  it("--plain, non-TTY stdout or stdin, NO_COLOR and CI force status lines", () => {
    expect(shouldUseLiveTui({ plain: true, stdoutIsTTY: true, stdinIsTTY: true, env: {} })).toBe(
      false,
    );
    expect(shouldUseLiveTui({ stdoutIsTTY: false, stdinIsTTY: true, env: {} })).toBe(false);
    expect(shouldUseLiveTui({ stdoutIsTTY: true, stdinIsTTY: false, env: {} })).toBe(false);
    expect(shouldUseLiveTui({ stdoutIsTTY: true, stdinIsTTY: true, env: { NO_COLOR: "1" } })).toBe(
      false,
    );
    expect(shouldUseLiveTui({ stdoutIsTTY: true, stdinIsTTY: true, env: { CI: "true" } })).toBe(
      false,
    );
  });
});

describe("readLiveMission (HANDOFF queue fields and plan frontmatter, read-only)", () => {
  const HANDOFF = [
    "# HANDOFF",
    "- **Plan:** `active.plan.md`",
    "- **Mode:** run-plan-all",
    "- **Run queue:** [a.plan.md, b.plan.md, c.plan.md, d.plan.md]",
    "- **Queue cursor:** 2 (current: c.plan.md)",
    "- **Queue status:** running",
  ].join("\n");
  const PLAN = [
    "---",
    "name: C",
    "todos:",
    "- id: one",
    "  status: completed",
    "- id: two",
    "  status: in_progress",
    "- id: three",
    "  status: pending",
    "- id: four",
    "  status: cancelled",
    "---",
    "# C",
  ].join("\n");
  const io = (files: Record<string, string>): LiveMissionIo => ({
    readFile: async (file) => files[file] ?? null,
    findActivePlan: async () => null,
  });

  it("paints plans done/total from the cursor and to-dos from the current queue plan", async () => {
    const state = await readLiveMission(
      "/r",
      io({ "/r/.cursor/HANDOFF.md": HANDOFF, "/r/.cursor/plans/c.plan.md": PLAN }),
    );
    expect(state.mission.mode).toBe("run-plan-all");
    expect(state.mission.queue).toEqual({
      done: 2,
      total: 4,
      current: "c.plan.md",
      status: "running",
    });
    expect(state.mission.planFile).toBe("c.plan.md");
    expect(state.mission.todos).toEqual({ done: 1, total: 3 });
    expect(state.mission.currentTodo).toBe("two");
    expect(state.mission.nextTodo).toBe("three");
    expect(state.checklist.map((r) => r.state)).toEqual(["done", "done", "current", "pending"]);
  });

  it("an exhausted queue counts every plan as done", async () => {
    const state = await readLiveMission(
      "/r",
      io({ "/r/.cursor/HANDOFF.md": HANDOFF.replace("running", "exhausted") }),
    );
    expect(state.mission.queue?.done).toBe(4);
    expect(state.checklist.every((r) => r.state === "done")).toBe(true);
  });

  it("without a queue: the active plan and its to-dos as the checklist", async () => {
    const state = await readLiveMission(
      "/r",
      io({
        "/r/.cursor/HANDOFF.md": "- **Plan:** `active.plan.md`\n- **Mode:** run-plan\n",
        "/r/.cursor/plans/active.plan.md": PLAN,
      }),
    );
    expect(state.mission.queue).toBeNull();
    expect(state.mission.planFile).toBe("active.plan.md");
    expect(state.checklist.map((r) => r.label)).toEqual(["one", "two", "three"]);
  });

  it("no HANDOFF and no plan: empty mission, no throw", async () => {
    const state = await readLiveMission("/r", io({}));
    expect(state.mission.planFile).toBeNull();
    expect(state.mission.todos).toEqual({ done: 0, total: 0 });
    expect(state.checklist).toEqual([]);
  });

  it("the loader re-reads at most once per ttl", async () => {
    let reads = 0;
    let t = 0;
    const loader = createLiveMissionLoader("/r", {
      ttlMs: 100,
      now: () => t,
      io: {
        readFile: async () => {
          reads += 1;
          return null;
        },
        findActivePlan: async () => null,
      },
    });
    await loader();
    await loader();
    expect(reads).toBe(1);
    t = 150;
    await loader();
    expect(reads).toBe(2);
  });
});

describe("withLiveTui (loop driven by the feed, keys through the input line)", () => {
  it("answers a gate from the input line, paints it in the Mission panel, restores the terminal", async () => {
    const h = harness();
    let gateFrame = "";
    let feed = null as LiveRunFeed | null;
    const answer = await withLiveTui(
      {
        ...h.opts,
        onFeed: (f) => {
          feed = f;
        },
      },
      async (seams) => {
        seams.onSpawn({ backend: "claude", pid: 4242, stop: () => undefined });
        seams.log("claude tick: claude -p (stream-json, stdin relay)");
        seams.render.feed(CLAUDE_FIXTURE);
        const reply = seams.hitl.readAnswer?.(GATE, {});
        h.io.emit("1");
        await h.settle();
        await h.settle();
        gateFrame = h.frames().at(-1) ?? "";
        h.io.emit("\r");
        return reply;
      },
    );
    expect(answer).toEqual({ kind: "line", text: "1" });
    expect(gateFrame).toContain("gate     queue-drift");
    expect(gateFrame).toContain("1. Run as proposed");
    expect(gateFrame).toContain("> 1 ");
    expect(gateFrame).toContain("pid 4242");
    expect(gateFrame).toContain("[");
    expect(gateFrame).toContain("2/6");
    expect(gateFrame).toContain("1/4");
    expect(gateFrame).toContain("demo.plan.md");
    expect(feed?.log.all().some((l) => l.text.startsWith("claude tick:"))).toBe(true);
    expect(gateFrame.split("\n").length).toBeLessThanOrEqual(24);
    expect(h.io.rawModes).toEqual([true, false]);
    expect(h.io.paused).toBe(1);
    expect(h.cleared).toBe(1);
    expect(h.writes.some((w) => w.includes(`${ESC}[?25h`))).toBe(true);
    expect(h.writes.join("")).not.toContain('"type":"assistant"');
  });

  it("q outside a gate stops the child with the operator quit record and no default answer", async () => {
    const h = harness();
    const stops: HitlStop[] = [];
    const result = await withLiveTui(h.opts, async (seams) => {
      seams.onSpawn({
        backend: "claude",
        pid: 7,
        stop: (stop) => {
          stops.push(stop);
        },
      });
      h.io.emit("q");
      return "done";
    });
    expect(result).toBe("done");
    expect(stops).toEqual([operatorQuitStop("q")]);
    expect(stops[0]?.message).toBe("stopped-by-operator: quit (q), no gate open");
    expect(stops[0]?.exitCode).toBe(130);
    expect(h.io.rawModes).toEqual([true, false]);
  });

  it("q before the child is up stops it as soon as it spawns", async () => {
    const h = harness();
    const stops: HitlStop[] = [];
    await withLiveTui(h.opts, async (seams) => {
      h.io.emit(Buffer.from([0x03]));
      seams.onSpawn({
        backend: "claude",
        pid: 8,
        stop: (s) => {
          stops.push(s);
        },
      });
      return null;
    });
    expect(stops).toEqual([operatorQuitStop("Ctrl-C")]);
  });

  it("Ctrl-C inside a gate is the relay's SIGINT stop; q is a character there", async () => {
    const h = harness();
    const stops: HitlStop[] = [];
    const answer = await withLiveTui(h.opts, async (seams) => {
      seams.onSpawn({
        backend: "claude",
        pid: 9,
        stop: (s) => {
          stops.push(s);
        },
      });
      const reply = seams.hitl.readAnswer?.(GATE, {});
      h.io.emit("q");
      h.io.emit(Buffer.from([0x03]));
      return reply;
    });
    expect(answer).toEqual({ kind: "sigint" });
    expect(stops).toEqual([]);
  });

  it("the child exiting while a gate is open releases the reader as EOF", async () => {
    const h = harness();
    const abort = new AbortController();
    const answer = await withLiveTui(h.opts, async (seams) => {
      const reply = seams.hitl.readAnswer?.(GATE, { signal: abort.signal });
      abort.abort();
      return reply;
    });
    expect(answer).toEqual({ kind: "eof" });
  });

  it("restores raw mode and the cursor when the run throws", async () => {
    const h = harness();
    await expect(
      withLiveTui(h.opts, async () => {
        throw new Error("spawn failed");
      }),
    ).rejects.toThrow("spawn failed");
    expect(h.io.rawModes).toEqual([true, false]);
    expect(h.io.paused).toBe(1);
    expect(h.writes.some((w) => w.includes(`${ESC}[?25h`))).toBe(true);
  });

  it("--no-hitl hands the relay policy off, so a gate stops without an input line", async () => {
    const h = harness();
    await withLiveTui({ ...h.opts, noHitl: true }, async (seams) => {
      expect(seams.hitl.policy).toBe("off");
      return null;
    });
  });
});

describe("withLiveTui with the fake claude (stream-json stdin transport)", () => {
  const fakeSpawn: SpawnFn = ((_cmd: string, args: string[], opts: Parameters<SpawnFn>[2]) =>
    spawn(process.execPath, [FAKE_CLAUDE, ...args], opts)) as unknown as SpawnFn;

  const waitFor = async (pred: () => boolean, ms = 5000) => {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > ms) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  beforeEach(() => {
    resetClaudeVersionCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetClaudeVersionCache();
  });

  it("gate answered by typing 1 + Enter in the TUI: stamp relayed and echoed into the log", async () => {
    const h = harness();
    const logPath = path.join(await mkdtemp(path.join(os.tmpdir(), "agent-kit-live-")), "run.log");
    let feed = null as LiveRunFeed | null;
    let spawned = null as SpawnInfo | null;
    const run = withLiveTui(
      {
        ...h.opts,
        logPath,
        onFeed: (f) => {
          feed = f;
        },
      },
      (seams) =>
        claudeBackend.run({
          workspace: os.tmpdir(),
          prompt: "Pick one option, please.",
          logPath,
          env: { FAKE_CLAUDE_MODE: "gate" },
          spawnFn: fakeSpawn,
          versionFn: () => "2.1.278 (Claude Code)",
          log: seams.log,
          hitl: seams.hitl,
          render: seams.render,
          onSpawn: (info) => {
            spawned = info;
            seams.onSpawn(info);
          },
        }),
    );
    await waitFor(() => Boolean(feed?.gate));
    expect(feed?.gate?.askId).toBe("demo");
    expect(spawned?.pid).toBeGreaterThan(0);
    h.io.emit("1");
    h.io.emit("\r");
    const result = await run;
    expect(result.hitl?.replies.map((s) => s.line)).toEqual([
      "HITL_REPLY: demo | operator reply 1 | Alpha",
    ]);
    expect(result.hitl?.stop).toBeUndefined();
    const log = await readFile(logPath, "utf8");
    expect(log).toContain('"isReplay":true');
    expect(log).toContain("HITL_REPLY: demo | operator reply 1 | Alpha");
    expect(feed?.hitlReplies).toBe(1);
    expect(feed?.crew.phase).toBe("done");
    expect(h.io.rawModes).toEqual([true, false]);
  });

  it("q while the child runs: stdin closed, child exits, run records the quit and exits 130", async () => {
    const h = harness();
    const logPath = path.join(await mkdtemp(path.join(os.tmpdir(), "agent-kit-live-")), "run.log");
    let pid: number | undefined;
    const result = await withLiveTui({ ...h.opts, logPath }, (seams) =>
      claudeBackend.run({
        workspace: os.tmpdir(),
        prompt: "Pick one option, please.",
        logPath,
        env: { FAKE_CLAUDE_MODE: "nogate" },
        spawnFn: fakeSpawn,
        versionFn: () => "2.1.278 (Claude Code)",
        log: seams.log,
        hitl: { ...seams.hitl, killAfterMs: 200 },
        render: seams.render,
        onSpawn: (info) => {
          pid = info.pid;
          seams.onSpawn(info);
          h.io.emit("q");
        },
      }),
    );
    expect(pid).toBeGreaterThan(0);
    expect(result.hitl?.stop?.cause).toBe("quit");
    expect(hitlExitCode(result.exitCode, result.hitl)).toBe(130);
  });
});
