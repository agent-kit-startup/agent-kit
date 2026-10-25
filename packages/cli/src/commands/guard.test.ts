import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_PATTERNS } from "../invariants/secrets-scan.js";
import { SHELL_DENY_RULES } from "../invariants/shell-guard.js";
import {
  evaluateGuardShell,
  type GuardShellDeps,
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

  // ADR 2026-07-29_cli-invariants-thin-hook-adapters, amended 2026-09-11,
  // 2026-10-19 and 2026-10-24: the guard is git-scoped by default, with two named, deliberate
  // exceptions (`public-repo-direct-write`, which also denies `gh pr
  // create|merge`, and `pr-merge-protected-base`, the base check behind the
  // Claude merge allow rows). A new rule must be either `git-`-prefixed or
  // explicitly added to GIT_SCOPE_EXCEPTIONS below — never silently widen scope.
  const GIT_SCOPE_EXCEPTIONS = new Map([
    ["public-repo-direct-write", "repo"],
    ["pr-merge-protected-base", "merge"],
  ]);

  it("ships only git-scoped rules plus the named exceptions", () => {
    expect(SHELL_DENY_RULES).toHaveLength(7);
    for (const rule of SHELL_DENY_RULES) {
      expect(rule.id.startsWith("git-") || GIT_SCOPE_EXCEPTIONS.has(rule.id)).toBe(true);
    }
  });

  it("names every rule family it actually enforces", () => {
    // Derived from the rule ids: git-checkout-path, git-restore, git-reset-hard,
    // git-clean-fd, public-repo-direct-write, git-push-main. A new rule family
    // must reach the help sentence.
    const families = SHELL_DENY_RULES.map(
      (rule) => GIT_SCOPE_EXCEPTIONS.get(rule.id) ?? rule.id.split("-")[1],
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
      resolvePrBase: async (target, cwd) => {
        calls.push(`base:${target.forge}:${target.selector ?? ""}:${cwd}`);
        return target.selector === "7" ? "main" : "staging";
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

  it("resolves the base of each PR/MR merge and only then evaluates", async () => {
    const { calls, deps } = spyDeps();
    const staging = await evaluateGuardShell("gh pr merge 12 --merge", "/tmp/repo", deps);
    expect(staging.permission).toBe("allow");
    expect(calls).toContain("base:github:12:/tmp/repo");
    const main = await evaluateGuardShell("gh pr merge 7 --squash", "/tmp/repo", deps);
    expect(main.rule).toBe("pr-merge-protected-base");
    const gitlab = await evaluateGuardShell("glab mr merge 7", "/tmp/repo", deps);
    expect(gitlab.rule).toBe("pr-merge-protected-base");
  });

  it("denies a merge whose base cannot be resolved", async () => {
    const { deps } = spyDeps();
    const result = await evaluateGuardShell("gh pr merge 12", "/tmp/repo", {
      ...deps,
      resolvePrBase: async () => null,
    });
    expect(result.rule).toBe("pr-merge-protected-base");
  });

  it("denies a merge behind a head it cannot parse, with no base to resolve", async () => {
    const { calls, deps } = spyDeps();
    for (const cmd of [
      "for n in 31 32; do gh pr merge $n -R acme/app --merge; done",
      "if true; then gh pr merge 12; fi",
      "echo 12 | xargs -n1 gh pr merge",
      "bash -c 'gh pr merge 12'",
      "! glab mr merge 12",
    ]) {
      const result = await evaluateGuardShell(cmd, "/tmp/repo", deps);
      expect(result.permission, cmd).toBe("deny");
      expect(result.rule, cmd).toBe("pr-merge-protected-base");
    }
    expect(calls.some((c) => c.startsWith("base:"))).toBe(false);
  });

  it("denies a selector the forge cannot read, such as a quoted variable", async () => {
    const { deps } = spyDeps();
    const result = await evaluateGuardShell('gh pr merge "$PR"', "/tmp/repo", {
      ...deps,
      resolvePrBase: async (target) => (/^\d+$/.test(target.selector ?? "") ? "staging" : null),
    });
    expect(result.rule).toBe("pr-merge-protected-base");
  });

  it("resolves no base for commands that merge nothing", async () => {
    const { calls, deps } = spyDeps();
    await evaluateGuardShell("gh pr view 12 && git push origin feat/x", "/tmp/repo", deps);
    expect(calls.some((c) => c.startsWith("base:"))).toBe(false);
  });
});

describe("runGuardShellHook --format claude (PreToolUse)", () => {
  const featureBranchDeps = {
    detectCurrentBranch: async () => "feat/x",
    detectRemotes: async () => ({ origin: "git@github.com:example/repo.git" }),
    resolvePrBase: async () => "staging",
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
