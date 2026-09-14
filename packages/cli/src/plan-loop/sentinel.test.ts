import { describe, expect, it } from "vitest";
import { parseSentinelFromLog, parseTickResultStatus } from "./sentinel.js";

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

  it("returns missing when absent", () => {
    expect(parseSentinelFromLog("no sentinel here")).toEqual({ kind: "missing" });
  });
});
