import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HELMET_ACCENT,
  HELMET_FILL,
  HELMET_OUTLINE,
  KIT_TIPS,
  SPACE_MARKS,
  SPINNER_FRAMES,
  TtySpinner,
  renderProgressLine,
  shouldUseVisualMotion,
  shouldUseWelcomeColor,
  spinnerFrame,
  tipAt,
  withCliProgress,
  wrapNarrow,
} from "./visual-kit.js";

function clearEnv(key: string): void {
  Reflect.deleteProperty(process.env, key);
}

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) clearEnv(key);
  else process.env[key] = value;
}

describe("visual-kit color and motion gates", () => {
  const prev = {
    NO_COLOR: process.env.NO_COLOR,
    CI: process.env.CI,
    FORCE_COLOR: process.env.FORCE_COLOR,
    NODE_DISABLE_COLORS: process.env.NODE_DISABLE_COLORS,
    AGENT_KIT_REDUCED_MOTION: process.env.AGENT_KIT_REDUCED_MOTION,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      setEnv(k, v);
    }
  });

  it("disables color and motion when NO_COLOR is set", () => {
    setEnv("NO_COLOR", "1");
    clearEnv("CI");
    clearEnv("FORCE_COLOR");
    clearEnv("AGENT_KIT_REDUCED_MOTION");
    expect(shouldUseWelcomeColor({ stdoutIsTTY: true, color: undefined })).toBe(false);
    expect(shouldUseVisualMotion({ stdoutIsTTY: true })).toBe(false);
  });

  it("disables color in CI even on TTY", () => {
    clearEnv("NO_COLOR");
    setEnv("CI", "true");
    expect(shouldUseWelcomeColor({ stdoutIsTTY: true })).toBe(false);
    expect(shouldUseVisualMotion({ stdoutIsTTY: true })).toBe(false);
  });

  it("disables color when stdout is not a TTY", () => {
    clearEnv("NO_COLOR");
    clearEnv("CI");
    clearEnv("FORCE_COLOR");
    expect(shouldUseWelcomeColor({ stdoutIsTTY: false })).toBe(false);
    expect(shouldUseVisualMotion({ stdoutIsTTY: false })).toBe(false);
  });

  it("disables motion when AGENT_KIT_REDUCED_MOTION=1 on a color TTY", () => {
    clearEnv("NO_COLOR");
    clearEnv("CI");
    clearEnv("FORCE_COLOR");
    clearEnv("NODE_DISABLE_COLORS");
    setEnv("AGENT_KIT_REDUCED_MOTION", "1");
    expect(shouldUseWelcomeColor({ stdoutIsTTY: true })).toBe(true);
    expect(shouldUseVisualMotion({ stdoutIsTTY: true })).toBe(false);
  });
});

describe("visual-kit catalog", () => {
  it("reuses HELMET_* space tokens", () => {
    expect(HELMET_OUTLINE).toBe("#e2e8f0");
    expect(HELMET_FILL).toBe("#0C8DEB");
    expect(HELMET_ACCENT).toBe("#00D0E7");
  });

  it("exposes spinner frames and small marks without a full helmet reprint", () => {
    expect(SPINNER_FRAMES.length).toBeGreaterThanOrEqual(4);
    expect(SPACE_MARKS.star).toBe("✦");
    expect(SPACE_MARKS.visor).toBe("( )");
    expect(Object.values(SPACE_MARKS).join("\n")).not.toContain(".-'");
  });

  it("rotates tips without home paths or token-like secrets", () => {
    expect(KIT_TIPS.length).toBeGreaterThanOrEqual(4);
    const blob = KIT_TIPS.join("\n");
    expect(blob).not.toMatch(/\/Users\/|\/home\/|API_KEY|SECRET=|TOKEN=/);
    expect(tipAt(0)).toBe(KIT_TIPS[0]);
    expect(tipAt(KIT_TIPS.length)).toBe(KIT_TIPS[0]);
    expect(spinnerFrame(0)).toBe(SPINNER_FRAMES[0]);
    expect(spinnerFrame(SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0]);
  });
});

describe("wrapNarrow", () => {
  it("wraps to the column budget", () => {
    const out = wrapNarrow("HITL gates stay in Cursor slash commands.", 12);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 12)).toBe(true);
  });

  it("floors width at 8 and splits overlong tokens", () => {
    const out = wrapNarrow("abcdefghijk", 4);
    expect(out.split("\n").every((line) => line.length <= 8)).toBe(true);
    expect(out).toContain("abcdefgh");
  });
});

describe("renderProgressLine", () => {
  it("uses a static mark when motion is off", () => {
    const line = renderProgressLine({
      frameIndex: 3,
      tipIndex: 0,
      columns: 80,
      motion: false,
      color: false,
    });
    expect(line.startsWith(SPACE_MARKS.tick)).toBe(true);
    expect(line).toContain(KIT_TIPS[0]);
    expect(line.includes("\u001b")).toBe(false);
  });

  it("uses a spinner frame when motion is on", () => {
    const line = renderProgressLine({
      frameIndex: 1,
      tipIndex: 1,
      columns: 120,
      motion: true,
      color: false,
    });
    expect(line.startsWith(SPINNER_FRAMES[1])).toBe(true);
    expect(line).toContain(KIT_TIPS[1]);
  });
});

describe("TtySpinner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes one static line when motion is off", () => {
    const chunks: string[] = [];
    const spinner = new TtySpinner({
      write: (c) => {
        chunks.push(c);
      },
      columns: () => 80,
      motion: false,
      color: false,
    });
    spinner.start("install");
    spinner.stop();
    expect(chunks.join("")).toContain("install");
    expect(chunks.join("")).toContain("\n");
    expect(chunks.join("")).not.toContain("\r");
  });

  it("advances frames on the interval when motion is on", () => {
    vi.useFakeTimers();
    const chunks: string[] = [];
    const spinner = new TtySpinner({
      write: (c) => {
        chunks.push(c);
      },
      columns: () => 80,
      motion: true,
      color: false,
      intervalMs: 80,
      now: () => Date.now(),
    });
    spinner.start("sync");
    vi.advanceTimersByTime(160);
    spinner.stop("done");
    const out = chunks.join("");
    expect(out).toContain("sync");
    expect(out).toContain("\r");
    expect(out).toContain("done");
  });
});

describe("withCliProgress", () => {
  it("does not start a spinner when motion is off", async () => {
    const start = vi.spyOn(TtySpinner.prototype, "start");
    await expect(withCliProgress("install", async () => "ok", { motion: false })).resolves.toBe(
      "ok",
    );
    expect(start).not.toHaveBeenCalled();
    start.mockRestore();
  });

  it("stops the spinner when fn throws", async () => {
    const stop = vi.spyOn(TtySpinner.prototype, "stop");
    await expect(
      withCliProgress(
        "install",
        async () => {
          throw new Error("boom");
        },
        { motion: true, color: false, write: () => undefined },
      ),
    ).rejects.toThrow("boom");
    expect(stop).toHaveBeenCalled();
    stop.mockRestore();
  });
});
