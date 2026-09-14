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

  // ADR 2026-07-29_cli-invariants-thin-hook-adapters, amended 2026-09-11: the
  // guard is git-scoped by default, with exactly one named, deliberate
  // exception (`public-repo-direct-write`, which also denies `gh pr
  // create|merge`) for agent-signature-leak-guard phase2. A new rule must be
  // either `git-`-prefixed or explicitly added to GIT_SCOPE_EXCEPTIONS below —
  // never silently widen scope past that.
  const GIT_SCOPE_EXCEPTIONS = new Set(["public-repo-direct-write"]);

  it("ships only git-scoped rules plus the named public-repo-write exception", () => {
    expect(SHELL_DENY_RULES).toHaveLength(6);
    for (const rule of SHELL_DENY_RULES) {
      expect(rule.id.startsWith("git-") || GIT_SCOPE_EXCEPTIONS.has(rule.id)).toBe(true);
    }
  });

  it("names every rule family it actually enforces", () => {
    // Derived from the rule ids: git-checkout-path, git-restore, git-reset-hard,
    // git-clean-fd, public-repo-direct-write, git-push-main. A new rule family
    // must reach the help sentence.
    const families = SHELL_DENY_RULES.map((rule) =>
      GIT_SCOPE_EXCEPTIONS.has(rule.id) ? "repo" : rule.id.split("-")[1],
    );
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
