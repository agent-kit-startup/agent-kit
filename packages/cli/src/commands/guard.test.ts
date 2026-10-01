import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_PATTERNS } from "../invariants/secrets-scan.js";
import { SHELL_DENY_RULES } from "../invariants/shell-guard.js";
import {
  type GuardShellDeps,
  evaluateGuardShell,
  guardCommand,
  runGuardShellHook,
} from "./guard.js";

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

describe("evaluateGuardShell git helper gating", () => {
  function spyDeps() {
    const calls: string[] = [];
    const deps: GuardShellDeps = {
      detectCurrentBranch: async (cwd) => {
        calls.push(`branch:${cwd}`);
        return "main";
      },
      detectRemotes: async (cwd) => {
        calls.push(`remotes:${cwd}`);
        return { origin: "git@github.com:example/repo.git" };
      },
    };
    return { calls, deps };
  }

  it("makes zero git helper calls for a non-git command", async () => {
    const { calls, deps } = spyDeps();
    const result = await evaluateGuardShell("rm -rf dist && ls -la", "/tmp/x", deps);
    expect(result.permission).toBe("allow");
    expect(calls).toEqual([]);
  });

  it("passes the payload cwd to both helpers for a git command", async () => {
    const { calls, deps } = spyDeps();
    const result = await evaluateGuardShell("git push", "/tmp/repo", deps);
    expect(calls.sort()).toEqual(["branch:/tmp/repo", "remotes:/tmp/repo"]);
    expect(result.permission).toBe("deny");
  });
});

describe("runGuardShellHook --format claude (PreToolUse)", () => {
  const featureBranchDeps = {
    detectCurrentBranch: async () => "feat/x",
    detectRemotes: async () => ({ origin: "git@github.com:example/repo.git" }),
  };
  const claudeStdin = (command: string) => async () => ({
    session_id: "s",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    cwd: "/tmp/repo",
  });

  // A host-level ALLOW_MAIN_PUSH=1 would turn the deny cases into allows.
  beforeEach(() => {
    vi.stubEnv("ALLOW_MAIN_PUSH", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies git push origin main on a feature branch with a GitHub remote", async () => {
    const out = await runGuardShellHook("claude", {
      ...featureBranchDeps,
      readStdin: claudeStdin("git push origin main"),
    });
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed.hookSpecificOutput)).toHaveLength(3);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("git-push-main");
  });

  it("denies a force push to main even with ALLOW_MAIN_PUSH=1", async () => {
    const out = await runGuardShellHook("claude", {
      ...featureBranchDeps,
      readStdin: claudeStdin("ALLOW_MAIN_PUSH=1 git push --force origin main"),
    });
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("allows ls with empty stdout", async () => {
    const out = await runGuardShellHook("claude", {
      ...featureBranchDeps,
      readStdin: claudeStdin("ls"),
    });
    expect(out).toBe("");
  });

  it("fails open when a git dep throws", async () => {
    const out = await runGuardShellHook("claude", {
      detectCurrentBranch: async () => {
        throw new Error("git exploded");
      },
      detectRemotes: featureBranchDeps.detectRemotes,
      readStdin: claudeStdin("git push origin main"),
    });
    expect(out).toBe("");
    expect(out).not.toContain("deny");
  });

  it("fails open on empty stdin or a stdin read that throws", async () => {
    expect(
      await runGuardShellHook("claude", { ...featureBranchDeps, readStdin: async () => ({}) }),
    ).toBe("");
    const out = await runGuardShellHook("claude", {
      ...featureBranchDeps,
      readStdin: async () => {
        throw new SyntaxError("bad json");
      },
    });
    expect(out).toBe("");
  });

  it("allows ALLOW_MAIN_PUSH=1 git push origin main (Cursor parity)", async () => {
    const command = "ALLOW_MAIN_PUSH=1 git push origin main";
    const claude = await runGuardShellHook("claude", {
      ...featureBranchDeps,
      readStdin: claudeStdin(command),
    });
    expect(claude).toBe("");
    const cursor = await runGuardShellHook("cursor", {
      ...featureBranchDeps,
      readStdin: async () => ({ command, cwd: "/tmp/repo" }),
    });
    expect(JSON.parse(cursor).permission).toBe("allow");
  });

  it("keeps cursor output identical to JSON.stringify(evaluateGuardShell)", async () => {
    for (const command of ["git push origin main", "ls", "git reset --hard"]) {
      const expected = JSON.stringify(
        await evaluateGuardShell(command, "/tmp/repo", featureBranchDeps),
      );
      const viaStdin = await runGuardShellHook(undefined, {
        ...featureBranchDeps,
        readStdin: async () => ({ command, cwd: "/tmp/repo" }),
      });
      const viaFlag = await runGuardShellHook("cursor", {
        ...featureBranchDeps,
        command,
        cwd: "/tmp/repo",
      });
      expect(viaStdin).toBe(expected);
      expect(viaFlag).toBe(expected);
    }
  });

  it("cursor path ignores tool_input and still reads the top-level command", async () => {
    const out = await runGuardShellHook("cursor", {
      ...featureBranchDeps,
      readStdin: async () => ({ tool_input: { command: "git push origin main" } }),
    });
    expect(JSON.parse(out).permission).toBe("allow");
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
