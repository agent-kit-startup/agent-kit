import { describe, expect, it } from "vitest";
import { REGISTRY_INDEX_REL } from "./paths.js";

describe("registry paths", () => {
  it("keeps the registry index literal stable (POSIX)", () => {
    expect(REGISTRY_INDEX_REL).toBe("registry/registry.json");
    expect(REGISTRY_INDEX_REL.includes("\\")).toBe(false);
  });
});
