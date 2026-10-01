import { describe, expect, it } from "vitest";
import { emptyStats } from "./apply.js";
import { SkippedSymlinkError, formatSkippedSymlinks } from "./report.js";

describe("SkippedSymlinkError", () => {
  it("defaults to the skipped-symlink message and carries SessionStart instructions when given", () => {
    const stats = { ...emptyStats(), skippedSymlink: [".cursor/rules/a.mdc"] };
    const plain = new SkippedSymlinkError(stats);
    expect(plain.message).toBe(formatSkippedSymlinks(stats.skippedSymlink));
    expect(plain.claudeSessionStartInstructions).toBeUndefined();

    const withHook = new SkippedSymlinkError(stats, "custom", '{"hooks":{}}');
    expect(withHook.message).toBe("custom");
    expect(withHook.claudeSessionStartInstructions).toBe('{"hooks":{}}');
  });
});
