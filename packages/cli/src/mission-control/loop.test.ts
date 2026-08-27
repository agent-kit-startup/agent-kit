import { describe, expect, it } from "vitest";
import { runMcTuiLoop } from "./loop.js";
import type { McTuiView } from "./view.js";

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
});
