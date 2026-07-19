import { describe, expect, it } from "vitest";
import { parseSentinelFromLog } from "./sentinel.js";

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
