import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { StreamRenderer } from "../plan-loop/stream-render.js";
import { LiveRunFeed } from "./live-feed.js";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "plan-loop",
  "fixtures",
);
const CLAUDE_FIXTURE = readFileSync(
  path.join(FIXTURES, "claude-stream-run-plan-all-queue-drift.log"),
  "utf8",
);

function fedWhole(): LiveRunFeed {
  const feed = new LiveRunFeed({ columns: 120, now: () => 1000, backend: "claude" });
  feed.feed(CLAUDE_FIXTURE);
  feed.end();
  return feed;
}

describe("LiveRunFeed (view model from the recorded claude stream)", () => {
  it("keeps every Phase 1 status line: the Flight Log equals the plain renderer output", () => {
    const feed = fedWhole();
    const parts: string[] = [];
    const renderer = new StreamRenderer({
      write: (s) => parts.push(s),
      isTTY: false,
      env: {},
      columns: 120,
    });
    renderer.feed(CLAUDE_FIXTURE);
    renderer.end();
    const expected = parts
      .join("")
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
    const got = feed.log.all().map((l) => l.text);
    expect(got).toEqual(expected);
    expect(got.length).toBeGreaterThan(20);
  });

  it("tracks tool calls, the last result, cost, turns and the rate-limit state", () => {
    const feed = fedWhole();
    expect(feed.crew.toolCalls).toBe(11);
    expect(feed.crew.currentTool).toBeNull();
    expect(feed.crew.lastResult).toEqual({ ok: true, status: "success" });
    expect(feed.crew.costUsd).toBeGreaterThan(0);
    expect(feed.crew.turns).toBeGreaterThan(0);
    expect(feed.crew.rateLimit).not.toBeNull();
    expect(feed.crew.rateLimit?.severe).toBe(false);
    expect(feed.crew.phase).toBe("done");
    expect(feed.log.all().some((l) => l.kind === "rate_limit")).toBe(true);
    expect(feed.log.all().some((l) => l.kind === "tool")).toBe(true);
    expect(feed.log.all().some((l) => l.kind === "result")).toBe(true);
  });

  it("is chunking-agnostic: 7-byte chunks give the same model as one feed", () => {
    const whole = fedWhole();
    const chunked = new LiveRunFeed({ columns: 120, now: () => 1000 });
    const buf = Buffer.from(CLAUDE_FIXTURE, "utf8");
    for (let i = 0; i < buf.length; i += 7) chunked.feed(buf.subarray(i, i + 7));
    chunked.end();
    expect(chunked.log.all()).toEqual(whole.log.all());
    expect(chunked.crew.toolCalls).toBe(whole.crew.toolCalls);
    expect(chunked.crew.costUsd).toBe(whole.crew.costUsd);
  });

  it("shows the tool in flight until its result arrives", () => {
    const feed = new LiveRunFeed({ columns: 80, now: () => 0 });
    feed.feed(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] },
      })}\n`,
    );
    expect(feed.crew.currentTool).toEqual({ name: "Read", summary: "a.ts" });
    expect(feed.crew.toolCalls).toBe(1);
    feed.feed(
      `${JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", content: "ok", is_error: false }] },
      })}\n`,
    );
    expect(feed.crew.currentTool).toBeNull();
  });

  it("counts relayed replies and never throws on garbage", () => {
    const feed = new LiveRunFeed({ columns: 80, now: () => 0 });
    feed.feed("not json\n{broken\n");
    feed.feed(
      `${JSON.stringify({
        type: "user",
        isReplay: true,
        message: {
          content: [{ type: "text", text: "HITL_REPLY: demo | operator reply 1 | Alpha" }],
        },
      })}\n`,
    );
    feed.end();
    expect(feed.hitlReplies).toBe(1);
    expect(feed.log.all().map((l) => l.kind)).toEqual(["hitl"]);
  });

  it("gate, phase and notes are owned by the run lane, not the stream", () => {
    const feed = new LiveRunFeed({ columns: 80, now: () => 5 });
    expect(feed.crew.phase).toBe("starting");
    feed.setProcess({ backend: "claude", pid: 4242 });
    expect(feed.crew.phase).toBe("running");
    expect(feed.crew.pid).toBe(4242);
    feed.openGate({ askId: "queue-drift", labels: ["A", "B"], detection: "sentinel" });
    expect(feed.crew.phase).toBe("gate");
    feed.note("HITL gate queue-drift\n  1. A\n  2. B\n", "hitl");
    expect(feed.log.all().map((l) => l.text)).toEqual([
      "HITL gate queue-drift",
      "  1. A",
      "  2. B",
    ]);
    feed.closeGate();
    expect(feed.gate).toBeNull();
    expect(feed.crew.phase).toBe("running");
  });

  it("bounds the Flight Log to its capacity", () => {
    const feed = new LiveRunFeed({ columns: 80, capacity: 5, now: () => 0 });
    for (let i = 0; i < 12; i += 1) feed.note(`line ${i}`);
    expect(feed.log.length).toBe(5);
    expect(feed.log.all().map((l) => l.text)).toEqual([
      "line 7",
      "line 8",
      "line 9",
      "line 10",
      "line 11",
    ]);
  });
});
