import { describe, expect, it } from "vitest";
import { LiveRunFeed, type McLiveView, emptyLiveMission } from "./live-feed.js";
import { InputLine, ScrollRegion, renderMcLive, renderProgressBar, splitKeys } from "./render.js";

const ESC = String.fromCharCode(27);
const CSI_ALL = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const strip = (s: string) => s.replace(CSI_ALL, "");

describe("renderProgressBar", () => {
  it("fills proportionally inside the requested width", () => {
    expect(renderProgressBar({ done: 3, total: 7, width: 14 })).toBe(
      `[${"█".repeat(6)}${"░".repeat(8)}] 3/7`,
    );
    expect(renderProgressBar({ done: 0, total: 4, width: 8 })).toBe(`[${"░".repeat(8)}] 0/4`);
    expect(renderProgressBar({ done: 4, total: 4, width: 8 })).toBe(`[${"█".repeat(8)}] 4/4`);
  });

  it("clamps out-of-range values and an empty total", () => {
    expect(renderProgressBar({ done: 9, total: 4, width: 8 })).toBe(`[${"█".repeat(8)}] 4/4`);
    expect(renderProgressBar({ done: 2, total: 0, width: 8 })).toBe(`[${"░".repeat(8)}] 0/0`);
    expect(renderProgressBar({ done: 1, total: 2, width: 1 })).toBe(
      `[${"█".repeat(2)}${"░".repeat(2)}] 1/2`,
    );
  });

  it("paints only when asked and keeps the visible text identical", () => {
    const plain = renderProgressBar({ done: 1, total: 2, width: 6 });
    const painted = renderProgressBar({ done: 1, total: 2, width: 6, color: true });
    expect(painted).not.toBe(plain);
    expect(strip(painted)).toBe(plain);
  });
});

describe("ScrollRegion", () => {
  it("keeps the newest lines within capacity and anchors the viewport at the bottom", () => {
    const region = new ScrollRegion<string>(4);
    for (const n of [1, 2, 3, 4, 5, 6]) region.push(`l${n}`);
    expect(region.length).toBe(4);
    expect(region.viewport(2)).toEqual({ lines: ["l5", "l6"], above: 2, below: 0 });
    expect(region.viewport(10)).toEqual({ lines: ["l3", "l4", "l5", "l6"], above: 0, below: 0 });
  });

  it("scrolls up and down with bounds and reports hidden lines", () => {
    const region = new ScrollRegion<string>(10);
    for (const n of [1, 2, 3, 4, 5]) region.push(`l${n}`);
    region.scrollUp(2);
    expect(region.viewport(2)).toEqual({ lines: ["l2", "l3"], above: 1, below: 2 });
    region.scrollUp(50);
    expect(region.scrolledUp).toBe(4);
    expect(region.viewport(2).lines).toEqual(["l1"]);
    region.scrollDown(1);
    expect(region.viewport(2).lines).toEqual(["l1", "l2"]);
    region.scrollToBottom();
    expect(region.viewport(2).lines).toEqual(["l4", "l5"]);
  });

  it("returns an empty viewport for height 0", () => {
    const region = new ScrollRegion<string>(3);
    region.push("a");
    expect(region.viewport(0)).toEqual({ lines: [], above: 1, below: 0 });
  });
});

describe("splitKeys", () => {
  it("keeps escape sequences whole and splits the rest per character", () => {
    expect(splitKeys(`ab${ESC}[Dc${ESC}[3~\r`)).toEqual([
      "a",
      "b",
      `${ESC}[D`,
      "c",
      `${ESC}[3~`,
      "\r",
    ]);
    expect(splitKeys(Buffer.from([0x03]))).toEqual(["\x03"]);
  });
});

describe("InputLine", () => {
  it("inserts, moves, deletes and submits", () => {
    const line = new InputLine();
    expect(line.handleKey("ab")).toBe("edit");
    expect(line.handleKey(`${ESC}[D`)).toBe("edit");
    expect(line.handleKey("X")).toBe("edit");
    expect(line.value).toBe("aXb");
    expect(line.cursor).toBe(2);
    expect(line.handleKey("\x7f")).toBe("edit");
    expect(line.value).toBe("ab");
    expect(line.handleKey(`${ESC}[H`)).toBe("edit");
    expect(line.handleKey(`${ESC}[3~`)).toBe("edit");
    expect(line.value).toBe("b");
    expect(line.handleKey(`${ESC}[F`)).toBe("edit");
    expect(line.handleKey("\r")).toBe("submit");
    expect(line.value).toBe("b");
  });

  it("maps Ctrl-C to sigint, Ctrl-D on an empty line to eof, and ignores unknown escapes", () => {
    const line = new InputLine();
    expect(line.handleKey("\x04")).toBe("eof");
    expect(line.handleKey("q")).toBe("edit");
    expect(line.handleKey("\x04")).toBe("ignored");
    expect(line.handleKey(`${ESC}[Z`)).toBe("ignored");
    expect(line.handleKey("\x03")).toBe("sigint");
    expect(line.value).toBe("q");
  });

  it("clears with Ctrl-U, deletes a word with Ctrl-W, and rejects control bytes", () => {
    const line = new InputLine();
    line.handleKey("run as proposed");
    expect(line.handleKey("\x17")).toBe("edit");
    expect(line.value).toBe("run as ");
    expect(line.handleKey("\x02")).toBe("ignored");
    expect(line.handleKey("\x15")).toBe("edit");
    expect(line.value).toBe("");
    expect(line.handleKey("\x15")).toBe("ignored");
  });

  it("renders the prompt with a cursor marker and scrolls long input", () => {
    const line = new InputLine();
    expect(line.render(20, false)).toBe("> _");
    line.handleKey("abc");
    expect(line.render(20, false)).toBe("> abc_");
    expect(strip(line.render(20, true))).toBe("> abc ");
    line.handleKey("defghijklmnopqrstuvwxyz");
    const shown = line.render(12, false);
    expect(shown.length).toBeLessThanOrEqual(12);
    expect(shown.endsWith("z_")).toBe(true);
  });
});

describe("renderMcLive", () => {
  function view(overrides: Partial<McLiveView> = {}): McLiveView {
    const feed = new LiveRunFeed({ columns: 80, now: () => 0, backend: "claude" });
    for (let i = 0; i < 30; i += 1) feed.note(`status line ${i}`);
    return {
      mission: { ...emptyLiveMission(), planFile: "demo.plan.md", todos: { done: 2, total: 5 } },
      gate: null,
      flightLog: feed.log,
      checklist: [{ label: "a", state: "done" }],
      crew: feed.crew,
      error: null,
      ...overrides,
    };
  }

  it("bounds the frame to the terminal height and shows hidden-line counts", () => {
    const frame = strip(renderMcLive(view(), { columns: 80, rows: 24, color: false, now: 5000 }));
    const lines = frame.split("\n");
    expect(lines.length).toBeLessThanOrEqual(24);
    expect(frame).toContain("Flight Log · ");
    expect(frame).toContain("above");
    expect(frame).toContain("[");
    expect(frame).toContain("2/5");
    expect(frame).toContain("claude · no pid · starting · 5s");
    for (const line of lines.slice(1, -1)) expect(line.length).toBe(80);
  });

  it("renders the gate labels and the input line inside the Mission panel", () => {
    const input = new InputLine();
    input.handleKey("2");
    const frame = strip(
      renderMcLive(
        view({
          gate: {
            askId: "queue-drift",
            labels: ["Run as proposed", "Cancel"],
            detection: "fallback",
            input,
          },
        }),
        { columns: 100, rows: 30, color: false },
      ),
    );
    expect(frame).toContain("queue-drift (prose fallback)");
    expect(frame).toContain("1. Run as proposed");
    expect(frame).toContain("2. Cancel");
    expect(frame).toContain("> 2_");
    expect(frame).toContain("Enter sends the reply");
  });
});
