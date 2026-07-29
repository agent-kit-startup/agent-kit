import { describe, expect, it } from "vitest";
import { buildPreCompactUserMessage } from "./pre-compact.js";
import { parseUnprocessedDogfoodItems } from "./session-start.js";

describe("parseUnprocessedDogfoodItems", () => {
  it("skips None placeholders", () => {
    const text = "### Unprocessed Files\n\n*None*\n\n### Processed Files\n";
    expect(parseUnprocessedDogfoodItems(text)).toEqual([]);
  });

  it("collects file bullets", () => {
    const text = "### Unprocessed Files\n\n- `a.md`\n- `b.md`\n\n### Processed Files\n";
    expect(parseUnprocessedDogfoodItems(text)).toEqual(["`a.md`", "`b.md`"]);
  });
});

describe("buildPreCompactUserMessage", () => {
  it("includes usage percent when provided", () => {
    const out = buildPreCompactUserMessage({ context_usage_percent: 85, trigger: "auto" });
    expect(out.user_message).toContain("~85%");
    expect(out.user_message).toContain("/continue-plan");
  });
});
