import { describe, expect, it } from "vitest";
import { SHELL_DENY_RULES, evaluateShellCommand } from "./shell-guard.js";

describe("evaluateShellCommand", () => {
  it("allows benign git status", () => {
    expect(evaluateShellCommand("git status").permission).toBe("allow");
  });

  it("denies git checkout --", () => {
    const r = evaluateShellCommand("git checkout -- packages/cli/src/index.ts");
    expect(r.permission).toBe("deny");
    expect(r.rule).toBe("git-checkout-path");
    expect(r.agent_message).toContain("agent-kit guard shell");
  });

  it("denies git checkout HEAD -- and git checkout .", () => {
    expect(evaluateShellCommand("git checkout HEAD -- src/a.ts").rule).toBe("git-checkout-path");
    expect(evaluateShellCommand("git checkout .").rule).toBe("git-checkout-path");
  });

  it("denies git restore", () => {
    expect(evaluateShellCommand("git restore README.md").rule).toBe("git-restore");
  });

  it("denies git reset --hard", () => {
    expect(evaluateShellCommand("git reset --hard HEAD").rule).toBe("git-reset-hard");
  });

  it("denies git clean -fd", () => {
    expect(evaluateShellCommand("git clean -fd").rule).toBe("git-clean-fd");
  });

  it("denies push to main", () => {
    expect(evaluateShellCommand("git push origin main").rule).toBe("git-push-main");
    expect(evaluateShellCommand("git push origin HEAD:main").rule).toBe("git-push-main");
  });

  it("denies force-refspec and refs/heads/ pushes to main", () => {
    expect(evaluateShellCommand("git push origin +main").rule).toBe("git-push-main");
    expect(evaluateShellCommand("git push origin refs/heads/main").rule).toBe("git-push-main");
    expect(evaluateShellCommand("git push origin +refs/heads/main").rule).toBe("git-push-main");
  });

  it("denies quoted push refspecs to main", () => {
    expect(evaluateShellCommand("git push origin 'main'").rule).toBe("git-push-main");
    expect(evaluateShellCommand('git push origin "+main"').rule).toBe("git-push-main");
  });

  it("denies bare push / force HEAD when current branch is protected", () => {
    expect(evaluateShellCommand("git push", { currentBranch: "main" }).rule).toBe("git-push-main");
    expect(
      evaluateShellCommand("git push --force origin HEAD", { currentBranch: "main" }).rule,
    ).toBe("git-push-main");
  });

  it("allows bare push when current branch is staging", () => {
    expect(evaluateShellCommand("git push", { currentBranch: "staging" }).permission).toBe("allow");
  });

  it("allows push to staging", () => {
    expect(evaluateShellCommand("git push origin staging").permission).toBe("allow");
  });

  it("allows meta CLI that only mentions git checkout in an argument", () => {
    expect(
      evaluateShellCommand('node dist/index.js guard shell --json --command "git checkout -- foo"')
        .permission,
    ).toBe("allow");
  });

  it("denies git checkout -- after &&", () => {
    expect(evaluateShellCommand("cd pkg && git checkout -- README.md").rule).toBe(
      "git-checkout-path",
    );
  });

  it("exports SHELL_DENY_RULES covering the named deny ids", () => {
    const ids = SHELL_DENY_RULES.map((r) => r.id);
    expect(ids).toEqual([
      "git-checkout-path",
      "git-restore",
      "git-reset-hard",
      "git-clean-fd",
      "git-push-main",
    ]);
    for (const rule of SHELL_DENY_RULES) {
      expect(typeof rule.test).toBe("function");
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });
});
