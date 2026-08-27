import { describe, expect, it } from "vitest";
import { CONTEXT_USAGE_CAP_PERCENT, buildPreCompactUserMessage } from "./pre-compact.js";

describe("buildPreCompactUserMessage", () => {
  it("escalates to a forced checkpoint when usage is at or above the cap", () => {
    const out = buildPreCompactUserMessage({
      context_usage_percent: CONTEXT_USAGE_CAP_PERCENT,
      trigger: "auto",
    });
    expect(out.user_message).toContain(`~${CONTEXT_USAGE_CAP_PERCENT}%`);
    expect(out.user_message).toContain("forced checkpoint");
    expect(out.user_message).toContain(`${CONTEXT_USAGE_CAP_PERCENT}% per-agent context-usage cap`);
    expect(out.user_message).toContain("/continue-plan");
  });

  it("escalates well above the cap", () => {
    const out = buildPreCompactUserMessage({ context_usage_percent: 92, trigger: "auto" });
    expect(out.user_message).toContain("~92%");
    expect(out.user_message).toContain("forced checkpoint");
  });

  it("escalates when usage percent is missing (auto-compaction with no reported pct implies high pressure)", () => {
    const out = buildPreCompactUserMessage({ trigger: "auto" });
    expect(out.user_message).toContain("usage high");
    expect(out.user_message).toContain("forced checkpoint");
  });

  it("stays gentle when usage is known and below the cap", () => {
    const out = buildPreCompactUserMessage({ context_usage_percent: 30, trigger: "manual" });
    expect(out.user_message).toContain("~30%");
    expect(out.user_message).not.toContain("forced checkpoint");
    expect(out.user_message).not.toContain("per-agent context-usage cap");
    expect(out.user_message).toContain("/continue-plan");
  });

  it("defaults trigger to auto when omitted", () => {
    const out = buildPreCompactUserMessage({ context_usage_percent: 10 });
    expect(out.user_message).toContain("auto");
  });
});
