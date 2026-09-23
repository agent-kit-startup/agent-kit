import { describe, expect, it } from "vitest";
import { HANDOFF_REL } from "./kit-paths.js";

describe("kit paths", () => {
  it("keeps the HANDOFF literal stable (POSIX)", () => {
    expect(HANDOFF_REL).toBe(".cursor/HANDOFF.md");
    expect(HANDOFF_REL.includes("\\")).toBe(false);
  });
});
