import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectUsageLimit } from "./usage-limit.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const line = (event: unknown) => JSON.stringify(event);

describe("detectUsageLimit", () => {
  it("a rejected rate_limit_event is a limit; allowed and allowed_warning are not", () => {
    const hit = detectUsageLimit(
      line({
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1791500000 },
      }),
    );
    expect(hit).toEqual({
      source: "rate_limit_event",
      detail: `five_hour rejected resets ${new Date(1791500000 * 1000).toISOString()}`,
    });
    for (const status of ["allowed", "allowed_warning"]) {
      expect(
        detectUsageLimit(line({ type: "rate_limit_event", rate_limit_info: { status } })),
      ).toBe(null);
    }
  });

  it("an error result naming a limit is a limit; a success result quoting one is not", () => {
    expect(
      detectUsageLimit(
        line({
          type: "result",
          is_error: true,
          result: "Claude AI usage limit reached|1791500000",
        }),
      ),
    ).toEqual({ source: "result", detail: "Claude AI usage limit reached|1791500000" });
    expect(
      detectUsageLimit(
        line({ type: "result", is_error: true, errors: ["429 Too Many Requests from upstream"] }),
      )?.source,
    ).toBe("result");
    expect(
      detectUsageLimit(line({ type: "result", is_error: false, result: "watch the rate limit" })),
    ).toBe(null);
    expect(
      detectUsageLimit(line({ type: "result", is_error: true, result: "Not logged in" })),
    ).toBe(null);
  });

  it("assistant text never counts; a vendor stderr line with a limit phrase does", () => {
    expect(
      detectUsageLimit(
        line({
          type: "assistant",
          message: { content: [{ type: "text", text: "We hit a usage limit last week." }] },
        }),
      ),
    ).toBe(null);
    expect(detectUsageLimit("Error: You've hit your usage limit. Try again later.")).toEqual({
      source: "stderr",
      detail: "Error: You've hit your usage limit. Try again later.",
    });
    expect(detectUsageLimit("Too many MCP tools for this model")).toBe(null);
  });

  it("the recorded claude fixture (allowed rate limits only) has no limit", async () => {
    const log = await readFile(
      path.join(FIXTURES, "claude-stream-run-plan-all-queue-drift.log"),
      "utf8",
    );
    expect(detectUsageLimit(log)).toBe(null);
  });
});
