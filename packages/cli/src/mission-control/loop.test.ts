import { describe, expect, it } from "vitest";
import { type McTuiStdin, runMcTuiLoop } from "./loop.js";
import type { McTuiView } from "./view.js";

function createFakeStdin(isTTY: boolean): McTuiStdin & {
  emit: (chunk: string | Buffer) => void;
  rawModes: boolean[];
  paused: number;
  resumed: number;
} {
  const listeners = new Set<(chunk: string | Buffer) => void>();
  const rawModes: boolean[] = [];
  let paused = 0;
  let resumed = 0;
  const stdin: McTuiStdin & {
    emit: (chunk: string | Buffer) => void;
    rawModes: boolean[];
    paused: number;
    resumed: number;
  } = {
    isTTY,
    setRawMode(mode: boolean) {
      rawModes.push(mode);
    },
    pause() {
      paused += 1;
    },
    resume() {
      resumed += 1;
    },
    on(_event: "data", listener: (chunk: string | Buffer) => void) {
      listeners.add(listener);
    },
    off(_event: "data", listener: (chunk: string | Buffer) => void) {
      listeners.delete(listener);
    },
    emit(chunk: string | Buffer) {
      for (const listener of listeners) listener(chunk);
    },
    get rawModes() {
      return rawModes;
    },
    get paused() {
      return paused;
    },
    get resumed() {
      return resumed;
    },
  };
  return stdin;
}

const view: McTuiView = {
  mission: {
    status: "idle",
    planFile: null,
    mode: null,
    progressLabel: "0 of 0 complete",
    currentTodo: null,
    nextTodo: null,
    gaps: null,
  },
  flightLog: { now: null, nowKind: null, earlier: [], warnings: [] },
  checklist: [],
  crewMonitor: [],
  error: null,
};

describe("runMcTuiLoop", () => {
  it("prints one frame and does not start an interval for --once", async () => {
    const writes: string[] = [];
    let intervals = 0;
    const handle = await runMcTuiLoop({
      once: true,
      stdoutIsTTY: true,
      env: {},
      loadView: async () => view,
      hooks: {
        write: (chunk) => {
          writes.push(chunk);
        },
        setIntervalFn: ((fn: () => void, _ms: number) => {
          intervals += 1;
          fn();
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
      },
    });
    expect(handle).toBeNull();
    expect(intervals).toBe(0);
    expect(writes.join("")).toContain("Mission");
    expect(writes.join("")).not.toContain("\x1b[2J");
  });

  it("starts a refresh interval on TTY when not --once", async () => {
    const writes: string[] = [];
    let cleared = false;
    const handle = await runMcTuiLoop({
      stdoutIsTTY: true,
      env: {},
      intervalMs: 15_000,
      loadView: async () => view,
      hooks: {
        write: (chunk) => {
          writes.push(chunk);
        },
        setIntervalFn: ((_fn: () => void, ms: number) => {
          expect(ms).toBe(15_000);
          return 7 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: ((id: NodeJS.Timeout) => {
          expect(id).toBe(7 as unknown as NodeJS.Timeout);
          cleared = true;
        }) as typeof clearInterval,
      },
    });
    expect(handle).not.toBeNull();
    handle?.stop();
    expect(cleared).toBe(true);
    expect(writes.some((w) => w.includes("\x1b[?25l"))).toBe(true);
    expect(writes.some((w) => w.includes("\x1b[?25h"))).toBe(true);
  });

  it("does not attach stdin for --once even when stdin is a TTY", async () => {
    const stdin = createFakeStdin(true);
    const handle = await runMcTuiLoop({
      once: true,
      stdoutIsTTY: true,
      env: {},
      loadView: async () => view,
      hooks: {
        write: () => undefined,
        stdin,
      },
    });
    expect(handle).toBeNull();
    expect(stdin.rawModes).toEqual([]);
    expect(stdin.resumed).toBe(0);
  });

  it("does not attach stdin when stdin is not a TTY", async () => {
    const stdin = createFakeStdin(false);
    let cleared = false;
    const handle = await runMcTuiLoop({
      stdoutIsTTY: true,
      env: {},
      intervalMs: 15_000,
      loadView: async () => view,
      hooks: {
        write: () => undefined,
        stdin,
        setIntervalFn: ((_fn: () => void, _ms: number) => {
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: (() => {
          cleared = true;
        }) as typeof clearInterval,
      },
    });
    expect(handle).not.toBeNull();
    expect(stdin.rawModes).toEqual([]);
    handle?.stop();
    expect(cleared).toBe(true);
  });

  it("quits on q: restores raw mode, pauses stdin, shows cursor, exits 0", async () => {
    const writes: string[] = [];
    const stdin = createFakeStdin(true);
    let exitCode: number | undefined;
    let cleared = false;
    const handle = await runMcTuiLoop({
      stdoutIsTTY: true,
      env: {},
      intervalMs: 15_000,
      loadView: async () => view,
      hooks: {
        write: (chunk) => {
          writes.push(chunk);
        },
        stdin,
        exit: (code) => {
          exitCode = code;
        },
        setIntervalFn: ((_fn: () => void, _ms: number) => {
          return 9 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: (() => {
          cleared = true;
        }) as typeof clearInterval,
      },
    });
    expect(handle).not.toBeNull();
    expect(stdin.rawModes).toEqual([true]);
    expect(stdin.resumed).toBe(1);
    stdin.emit("q");
    expect(cleared).toBe(true);
    expect(stdin.rawModes).toEqual([true, false]);
    expect(stdin.paused).toBe(1);
    expect(exitCode).toBe(0);
    expect(writes.some((w) => w.includes("\x1b[?25h"))).toBe(true);
  });

  it("quits on Q (exact, case-sensitive sibling of q)", async () => {
    const stdin = createFakeStdin(true);
    let exitCode: number | undefined;
    const handle = await runMcTuiLoop({
      stdoutIsTTY: true,
      env: {},
      intervalMs: 15_000,
      loadView: async () => view,
      hooks: {
        write: () => undefined,
        stdin,
        exit: (code) => {
          exitCode = code;
        },
        setIntervalFn: ((_fn: () => void, _ms: number) => {
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
      },
    });
    expect(handle).not.toBeNull();
    stdin.emit("Q");
    expect(exitCode).toBe(0);
    handle?.stop();
  });

  it("does not quit on a substring that merely contains q", async () => {
    const stdin = createFakeStdin(true);
    let exitCode: number | undefined;
    const handle = await runMcTuiLoop({
      stdoutIsTTY: true,
      env: {},
      intervalMs: 15_000,
      loadView: async () => view,
      hooks: {
        write: () => undefined,
        stdin,
        exit: (code) => {
          exitCode = code;
        },
        setIntervalFn: ((_fn: () => void, _ms: number) => {
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
      },
    });
    expect(handle).not.toBeNull();
    stdin.emit("quit");
    expect(exitCode).toBeUndefined();
    stdin.emit("question");
    expect(exitCode).toBeUndefined();
    handle?.stop();
  });

  it("quits on Ctrl-C byte in raw mode", async () => {
    const stdin = createFakeStdin(true);
    let exitCode: number | undefined;
    const handle = await runMcTuiLoop({
      stdoutIsTTY: true,
      env: {},
      intervalMs: 15_000,
      loadView: async () => view,
      hooks: {
        write: () => undefined,
        stdin,
        exit: (code) => {
          exitCode = code;
        },
        setIntervalFn: ((_fn: () => void, _ms: number) => {
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
      },
    });
    expect(handle).not.toBeNull();
    stdin.emit(Buffer.from([0x03]));
    expect(exitCode).toBe(0);
    expect(stdin.rawModes).toEqual([true, false]);
  });

  it("skips a tick while the previous paint is still collecting", async () => {
    let loadCount = 0;
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let tick: () => void = () => undefined;
    const handle = await runMcTuiLoop({
      stdoutIsTTY: true,
      env: {},
      intervalMs: 15_000,
      loadView: async () => {
        loadCount += 1;
        if (loadCount === 2) await secondGate;
        return view;
      },
      hooks: {
        write: () => undefined,
        setIntervalFn: ((fn: () => void, _ms: number) => {
          tick = fn;
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
      },
    });
    expect(loadCount).toBe(1);
    tick();
    expect(loadCount).toBe(2);
    tick();
    expect(loadCount).toBe(2);
    releaseSecond();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    handle?.stop();
  });

  it("a paint still collecting when stop() runs writes nothing afterwards", async () => {
    const writes: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loads = 0;
    let tick: () => void = () => undefined;
    const handle = await runMcTuiLoop({
      stdoutIsTTY: true,
      env: {},
      intervalMs: 15_000,
      loadView: async () => {
        loads += 1;
        if (loads === 2) await gate;
        return view;
      },
      hooks: {
        write: (chunk) => {
          writes.push(chunk);
        },
        setIntervalFn: ((fn: () => void, _ms: number) => {
          tick = fn;
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
      },
    });
    tick();
    expect(loads).toBe(2);
    handle?.stop();
    const afterStop = writes.length;
    expect(writes[afterStop - 1]).toBe("\x1b[?25h");
    release();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(writes.length).toBe(afterStop);
    await handle?.repaint();
    expect(writes.length).toBe(afterStop);
  });

  it("renders an error frame when loadView rejects and restores the cursor on stop", async () => {
    const writes: string[] = [];
    const handle = await runMcTuiLoop({
      stdoutIsTTY: true,
      env: {},
      intervalMs: 15_000,
      loadView: async () => {
        throw new Error("collector timed out");
      },
      hooks: {
        write: (chunk) => {
          writes.push(chunk);
        },
        setIntervalFn: ((_fn: () => void, _ms: number) => {
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
      },
    });
    expect(handle).not.toBeNull();
    expect(writes.join("")).toContain("collector timed out");
    handle?.stop();
    expect(writes.some((w) => w.includes("\x1b[?25h"))).toBe(true);
  });
});
