import { describe, expect, it } from "vitest";
import { SECRET_PATTERNS } from "../invariants/secrets-scan.js";
import { SHELL_DENY_RULES } from "../invariants/shell-guard.js";
import { guardCommand } from "./guard.js";

/**
 * These tests exist so the advertised sentences stay derived from the invariants
 * instead of asserted next to them (`errors/2026-08-14_guard-secrets-scope-vs-claims`).
 */

type MetaLike = { meta?: { description?: string } };

function subDescription(name: string): string {
  const subs = guardCommand.subCommands as unknown as Record<string, MetaLike> | undefined;
  return subs?.[name]?.meta?.description ?? "";
}

describe("guard shell help text matches SHELL_DENY_RULES", () => {
  const description = subDescription("shell");

  it("does not claim a general destructive deny-list", () => {
    expect(description).not.toMatch(/destructive deny-list/i);
    expect(description).toMatch(/git-workflow/i);
    expect(description).toMatch(/protected-branch/i);
  });

  it("only ships git-scoped rules, which is what the sentence promises", () => {
    expect(SHELL_DENY_RULES).toHaveLength(5);
    for (const rule of SHELL_DENY_RULES) {
      expect(rule.id.startsWith("git-")).toBe(true);
    }
  });

  it("names every rule family it actually enforces", () => {
    // Derived from the rule ids: git-checkout-path, git-restore, git-reset-hard,
    // git-clean-fd, git-push-main. A new rule family must reach the help sentence.
    const families = SHELL_DENY_RULES.map((rule) => rule.id.split("-")[1]);
    for (const family of families) {
      expect(description.toLowerCase()).toContain(family);
    }
  });
});

describe("guard prompt help text matches the scan posture", () => {
  const description = subDescription("prompt");

  it("stays advisory / fail-open in the sentence, as the hook is", () => {
    expect(description).toMatch(/advisory/i);
    expect(description).toMatch(/fail-open/i);
  });

  it("has a non-empty pattern set behind the sentence", () => {
    expect(SECRET_PATTERNS.length).toBeGreaterThan(0);
  });
});
