import { describe, expect, it } from "vitest";
import type { AgentKitManifest } from "../manifest/types.js";
import { DEFAULT_PROTECTED_PATHS } from "../manifest/types.js";
import { matchesAnyGlob, normalizeRelPath } from "./glob.js";
import { isProtectedPath, resolveProtectedGlobs } from "./protected.js";

describe("lifecycle globs", () => {
  it("normalizes relative paths", () => {
    expect(normalizeRelPath("./.cursor/plans/foo.md")).toBe(".cursor/plans/foo.md");
    expect(normalizeRelPath(".cursor\\memory\\x.md")).toBe(".cursor/memory/x.md");
  });

  it("matches ** across depth", () => {
    expect(matchesAnyGlob(".cursor/plans/a/b.md", [".cursor/plans/**"])).toBe(true);
    expect(matchesAnyGlob(".cursor/rules/x.mdc", [".cursor/plans/**"])).toBe(false);
  });

  it("matches exact protected files", () => {
    expect(matchesAnyGlob(".cursor/HANDOFF.md", [".cursor/HANDOFF.md"])).toBe(true);
  });
});

describe("L3 protected", () => {
  it("merges defaults with manifest protected + overrides", () => {
    const manifest: AgentKitManifest = {
      schemaVersion: 1,
      version: "3.0.0",
      protected: [".cursor/custom/**"],
      overrides: [{ path: ".cursor/rules/local.mdc" }],
    };
    const globs = resolveProtectedGlobs(manifest);
    for (const d of DEFAULT_PROTECTED_PATHS) {
      expect(globs).toContain(d);
    }
    expect(globs).toContain(".cursor/custom/**");
    expect(globs).toContain(".cursor/rules/local.mdc");
  });

  it("isProtectedPath blocks HANDOFF and plans", () => {
    const globs = resolveProtectedGlobs(null);
    expect(isProtectedPath(".cursor/HANDOFF.md", globs)).toBe(true);
    expect(isProtectedPath(".cursor/plans/foo.plan.md", globs)).toBe(true);
    expect(isProtectedPath(".cursor/rules/ux-tone.mdc", globs)).toBe(false);
  });
});
