import { describe, expect, it } from "vitest";
import { REPOSITORY_PROFILE_REL } from "./paths.js";

describe("scanner paths", () => {
  it("exports the repository profile relative path as a POSIX literal", () => {
    expect(REPOSITORY_PROFILE_REL).toBe(".cursor/agent-kit.config.json");
    expect(REPOSITORY_PROFILE_REL.includes("\\")).toBe(false);
  });
});
