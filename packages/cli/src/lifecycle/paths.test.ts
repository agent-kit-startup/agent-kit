import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveContained } from "./paths.js";

describe("resolveContained", () => {
  const root = path.resolve("/tmp/agent-kit-root");

  it("allows children whose first segment merely starts with ..", () => {
    expect(resolveContained(root, "..cache/a")).toBe(path.join(root, "..cache/a"));
  });

  it("rejects a real parent-directory escape", () => {
    expect(() => resolveContained(root, "../a")).toThrow(/escapes/);
    expect(() => resolveContained(root, "..")).toThrow(/escapes/);
    expect(() => resolveContained(root, "a/../../b")).toThrow(/escapes/);
  });
});
