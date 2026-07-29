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
});
