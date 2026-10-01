import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { type TurnResult, TurnWatcher } from "./hitl-relay.js";
import { TICK_PROMPT } from "./run-loop.js";
import {
  type TickSentinel,
  parseSentinelFromLog,
  parseTickResultStatus,
  resolveTickResultStatus,
  resolveTickSentinel,
  sentinelFromTurn,
} from "./sentinel.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parseTickResultStatus", () => {
  it("returns null without a result event (plain text, cursor-agent, early death)", () => {
    expect(parseTickResultStatus("LOOP_TICK_RESULT: continue\n")).toBeNull();
    expect(parseTickResultStatus('{"type":"assistant","message":{"content":[]}}')).toBeNull();
    expect(parseTickResultStatus("")).toBeNull();
  });

  it("reads is_error, subtype and errors from the last result event", () => {
    const log = [
      '{"type":"system","subtype":"init"}',
      '{"type":"result","subtype":"success","is_error":false,"result":"LOOP_TICK_RESULT: continue"}',
    ].join("\n");
    expect(parseTickResultStatus(log)).toEqual({ isError: false, subtype: "success", errors: [] });

    const failed = [
      '{"type":"result","subtype":"error_max_turns","is_error":true,"errors":["Reached max turns (25)"],"num_turns":25}',
    ].join("\n");
    expect(parseTickResultStatus(failed)).toEqual({
      isError: true,
      subtype: "error_max_turns",
      errors: ["Reached max turns (25)"],
    });

    const auth =
      '{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["401 Unauthorized"]}';
    expect(parseTickResultStatus(auth)?.errors).toEqual(["401 Unauthorized"]);
  });
});

describe("parseSentinelFromLog", () => {
  it("parses continue from plain text", () => {
    const s = parseSentinelFromLog("done\nLOOP_TICK_RESULT: continue\n");
    expect(s).toEqual({ kind: "continue" });
  });

  it("parses stop with hyphen reason", () => {
    const s = parseSentinelFromLog("LOOP_TICK_RESULT: stop - plan exhausted\n");
    expect(s).toEqual({ kind: "stop", reason: "plan exhausted" });
  });

  it("parses stop with em dash reason", () => {
    const s = parseSentinelFromLog("LOOP_TICK_RESULT: stop — human gate\n");
    expect(s).toEqual({ kind: "stop", reason: "human gate" });
  });

  it("prefers stream-json result event", () => {
    const log = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}',
      '{"type":"result","result":"summary\\nLOOP_TICK_RESULT: continue"}',
    ].join("\n");
    expect(parseSentinelFromLog(log)).toEqual({ kind: "continue" });
  });

  it("ignores the TICK_PROMPT echoed in a user event", () => {
    const log = JSON.stringify({
      type: "user",
      message: { content: [{ type: "text", text: TICK_PROMPT }] },
    });
    expect(parseSentinelFromLog(log)).toEqual({ kind: "missing" });
  });

  it("reads assistant text and skips plain lines when the log is stream-json", () => {
    const log = [
      "LOOP_TICK_RESULT: continue",
      '{"type":"assistant","message":{"content":[{"type":"text","text":"LOOP_TICK_RESULT: stop - gate"}]}}',
    ].join("\n");
    expect(parseSentinelFromLog(log)).toEqual({ kind: "stop", reason: "gate" });
    expect(parseSentinelFromLog('{"type":"system"}\nLOOP_TICK_RESULT: continue\n')).toEqual({
      kind: "missing",
    });
  });

  it("returns missing when absent", () => {
    expect(parseSentinelFromLog("no sentinel here")).toEqual({ kind: "missing" });
  });
});

/** The last `result` a TurnWatcher sees over the whole log text. */
function watchedLastResult(log: string): TurnResult | undefined {
  let last: TurnResult | undefined;
  const watcher = new TurnWatcher((turn) => {
    last = turn;
  });
  watcher.feed(log);
  watcher.end();
  return last;
}

describe("tick outcome from the watched last result", () => {
  const inlineLogs: Record<string, string> = {
    continue: [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"LOOP_TICK_RESULT: stop - early"}]}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"gate"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"working"},{"type":"text","text":"done\\nLOOP_TICK_RESULT: continue"}]}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"done"}',
    ].join("\n"),
    stop: [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"LOOP_TICK_RESULT: continue"}]}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"LOOP_TICK_RESULT: stop - plan exhausted"}',
    ].join("\n"),
    isError: [
      '{"type":"system","subtype":"init"}',
      '{"type":"result","subtype":"error_max_turns","is_error":true,"errors":["Reached max turns (25)"]}',
    ].join("\n"),
  };
  const fixtureLogs: Record<string, string> = {
    "cursor-agent-stream-synthetic.log": readFileSync(
      path.join(FIXTURES, "cursor-agent-stream-synthetic.log"),
      "utf8",
    ),
    "claude-stream-run-plan-all-queue-drift.log": readFileSync(
      path.join(FIXTURES, "claude-stream-run-plan-all-queue-drift.log"),
      "utf8",
    ),
  };

  for (const [name, log] of Object.entries({ ...inlineLogs, ...fixtureLogs })) {
    it(`matches the file parsers on ${name}`, async () => {
      const lastResult = watchedLastResult(log);
      expect(lastResult).toBeDefined();
      const sentinelFile = vi.fn(async () => parseSentinelFromLog(log));
      const statusFile = vi.fn(async () => parseTickResultStatus(log));
      expect(await resolveTickResultStatus(lastResult, "unused.log", statusFile)).toEqual(
        parseTickResultStatus(log),
      );
      expect(statusFile).not.toHaveBeenCalled();
      expect(await resolveTickSentinel(lastResult, "unused.log", sentinelFile)).toEqual(
        parseSentinelFromLog(log),
      );
      // The file is read only when the watched turn has no sentinel.
      const turnHasSentinel = lastResult ? sentinelFromTurn(lastResult) !== null : false;
      expect(sentinelFile).toHaveBeenCalledTimes(turnHasSentinel ? 0 : 1);
    });
  }

  it("never calls the file parsers when the watched result carries the outcome", async () => {
    const lastResult = watchedLastResult(inlineLogs.stop ?? "");
    const sentinelFile = vi.fn(async (): Promise<TickSentinel> => ({ kind: "continue" }));
    const statusFile = vi.fn(async () => null);
    expect(await resolveTickSentinel(lastResult, "tick.log", sentinelFile)).toEqual({
      kind: "stop",
      reason: "plan exhausted",
    });
    expect(await resolveTickResultStatus(lastResult, "tick.log", statusFile)).toEqual({
      isError: false,
      subtype: "success",
      errors: [],
    });
    expect(sentinelFile).not.toHaveBeenCalled();
    expect(statusFile).not.toHaveBeenCalled();
  });

  it("falls back to the file parsers when there is no watched result", async () => {
    const sentinelFile = vi.fn(async (): Promise<TickSentinel> => ({ kind: "continue" }));
    const statusFile = vi.fn(async () => null);
    expect(await resolveTickSentinel(undefined, "tick.log", sentinelFile)).toEqual({
      kind: "continue",
    });
    expect(await resolveTickResultStatus(undefined, "tick.log", statusFile)).toBeNull();
    expect(sentinelFile).toHaveBeenCalledWith("tick.log");
    expect(statusFile).toHaveBeenCalledWith("tick.log");
  });
});
