import { describe, expect, it } from "vitest";
import { CONTEXT_CONFIG_REL, contextConfigPath, intervalElapsed } from "./context-config.js";

describe("context-config helpers", () => {
  it("builds the canonical config path", () => {
    expect(CONTEXT_CONFIG_REL.replace(/\\/g, "/")).toBe(".cursor/context/config.json");
    expect(contextConfigPath("/tmp/proj").replace(/\\/g, "/")).toBe(
      "/tmp/proj/.cursor/context/config.json",
    );
  });

  it("treats missing or invalid lastCheckedAt as elapsed", () => {
    expect(intervalElapsed(null, 7)).toBe(true);
    expect(intervalElapsed("not-a-date", 7)).toBe(true);
  });

  it("respects intervalDays against a fresh stamp", () => {
    const now = new Date().toISOString();
    expect(intervalElapsed(now, 7)).toBe(false);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(intervalElapsed(eightDaysAgo, 7)).toBe(true);
  });
});
