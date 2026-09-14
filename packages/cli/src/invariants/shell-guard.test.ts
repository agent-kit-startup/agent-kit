import { afterEach, describe, expect, it } from "vitest";
import { SHELL_DENY_RULES, evaluateShellCommand } from "./shell-guard.js";

describe("evaluateShellCommand", () => {
  afterEach(() => {
    // Node coerces env values to strings: `= undefined` sets the literal "undefined".
    // biome-ignore lint/performance/noDelete: process.env must be removed, not set to "undefined"
    delete process.env.ALLOW_MAIN_PUSH;
    // biome-ignore lint/performance/noDelete: process.env must be removed, not set to "undefined"
    delete process.env.ALLOW_PUBLIC_PUSH;
  });

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

  it("allows push to main when ALLOW_MAIN_PUSH=1 is inline (git-prod path)", () => {
    expect(evaluateShellCommand("ALLOW_MAIN_PUSH=1 git push origin main").permission).toBe("allow");
    expect(evaluateShellCommand("ALLOW_MAIN_PUSH=1 git push origin HEAD:main").permission).toBe(
      "allow",
    );
  });

  it("allows push to main when process.env.ALLOW_MAIN_PUSH=1", () => {
    process.env.ALLOW_MAIN_PUSH = "1";
    expect(evaluateShellCommand("git push origin main").permission).toBe("allow");
    expect(evaluateShellCommand("git push origin HEAD:main").permission).toBe("allow");
  });

  it("denies bare push to main when ALLOW_MAIN_PUSH is unset", () => {
    // biome-ignore lint/performance/noDelete: process.env must be removed, not set to "undefined"
    delete process.env.ALLOW_MAIN_PUSH;
    expect(evaluateShellCommand("git push origin main").permission).toBe("deny");
    expect(evaluateShellCommand("git push origin main").rule).toBe("git-push-main");
  });

  it("denies bare push to main when ALLOW_MAIN_PUSH=0", () => {
    process.env.ALLOW_MAIN_PUSH = "0";
    expect(evaluateShellCommand("git push origin main").permission).toBe("deny");
    expect(evaluateShellCommand("git push origin main").rule).toBe("git-push-main");
  });

  it("does not let ALLOW_MAIN_PUSH on a later segment authorize an earlier push", () => {
    expect(evaluateShellCommand("git push origin main && ALLOW_MAIN_PUSH=1 echo ok").rule).toBe(
      "git-push-main",
    );
  });

  it("denies unsafe main-push forms even when ALLOW_MAIN_PUSH=1 is present", () => {
    const denyWhileEnv: string[] = [
      "ALLOW_MAIN_PUSH=1 git push --force origin main",
      "ALLOW_MAIN_PUSH=1 git push -f origin main",
      "ALLOW_MAIN_PUSH=1 git push --force-with-lease origin main",
      "ALLOW_MAIN_PUSH=1 git push --no-verify origin main",
      "ALLOW_MAIN_PUSH=1 git push origin prod",
      "ALLOW_MAIN_PUSH=1 git push origin master",
      "ALLOW_MAIN_PUSH=1 git push origin main --tags",
      "ALLOW_MAIN_PUSH=1 git push origin main --all",
      "ALLOW_MAIN_PUSH=1 git push --tags --all origin main",
      "ALLOW_MAIN_PUSH=1 git push origin +main",
    ];
    for (const cmd of denyWhileEnv) {
      const r = evaluateShellCommand(cmd);
      expect(r.permission, cmd).toBe("deny");
      expect(r.rule, cmd).toBe("git-push-main");
    }

    process.env.ALLOW_MAIN_PUSH = "1";
    const denyWithProcessEnv: string[] = [
      "git push --force origin main",
      "git push --force-with-lease origin main",
      "git push --no-verify origin main",
      "git push origin prod",
      "git push origin master",
      "git push origin main --tags --all",
    ];
    for (const cmd of denyWithProcessEnv) {
      const r = evaluateShellCommand(cmd);
      expect(r.permission, cmd).toBe("deny");
      expect(r.rule, cmd).toBe("git-push-main");
    }
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

  it("denies prefixed and embedded quote push forms that shell collapses to main", () => {
    const denyForms = [
      "+'main'",
      '+"main"',
      "ma'in'",
      'm"ain"',
      "''main''",
      "'refs/heads'/main",
      "+refs/'heads'/main",
    ];
    for (const dest of denyForms) {
      expect(evaluateShellCommand(`git push origin ${dest}`).rule).toBe("git-push-main");
    }
  });

  it("denies backslash push forms that shell collapses to main", () => {
    // JS source needs \\ so the refspec token retains a literal backslash.
    const denyForms = ["\\main", "ma\\in", "mai\\n", "'\\main'", '"ma\\in"', "+\\main"];
    for (const dest of denyForms) {
      expect(evaluateShellCommand(`git push origin ${dest}`).rule).toBe("git-push-main");
    }
  });

  it("does not over-block staging or mainline-like branches after quote/backslash strip", () => {
    const allowForms = [
      "'staging'",
      '"+staging"',
      "'mainline'",
      '"feature/main-fix"',
      '"refs/heads/staging"',
      "\\staging",
      "sta\\ging",
      "\\mainline",
    ];
    for (const dest of allowForms) {
      expect(evaluateShellCommand(`git push origin ${dest}`).permission).toBe("allow");
    }
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

  it("denies git push directly targeting the public repo by URL or -R/--repo", () => {
    const denyForms = [
      "git push https://github.com/agent-kit-startup/agent-kit.git HEAD:main",
      "git push git@github.com:agent-kit-startup/agent-kit.git staging",
      "gh pr create --repo agent-kit-startup/agent-kit --base main --head sync/x",
      "gh pr merge 12 -R agent-kit-startup/agent-kit --squash",
    ];
    for (const cmd of denyForms) {
      const r = evaluateShellCommand(cmd);
      expect(r.permission, cmd).toBe("deny");
      expect(r.rule, cmd).toBe("public-repo-direct-write");
    }
  });

  it("does not confuse the private repo (agent-kit-dev) with the public mirror", () => {
    const allowForms = [
      "git push https://github.com/agent-kit-startup/agent-kit-dev.git staging",
      "gh pr create --repo agent-kit-startup/agent-kit-dev --base staging --head feat/x",
    ];
    for (const cmd of allowForms) {
      expect(evaluateShellCommand(cmd).permission, cmd).toBe("allow");
    }
  });

  it("resolves a named remote to the public repo via opts.remotes", () => {
    const remotes = { public: "https://github.com/agent-kit-startup/agent-kit.git" };
    const r = evaluateShellCommand("git push public HEAD:main", { remotes });
    expect(r.permission).toBe("deny");
    expect(r.rule).toBe("public-repo-direct-write");
  });

  it("does not treat a generic remote named 'public' as the public repo without a resolved URL", () => {
    // No opts.remotes provided — a consumer's own "public" remote name must not
    // false-positive on name alone.
    expect(evaluateShellCommand("git push public staging").permission).toBe("allow");
    const remotes = { public: "https://github.com/some-consumer/their-fork.git" };
    expect(evaluateShellCommand("git push public staging", { remotes }).permission).toBe("allow");
  });

  it("does not block gh issue operations against the public repo (public-issue-triage's documented flow)", () => {
    const allowForms = [
      "gh issue list --repo agent-kit-startup/agent-kit --state open --limit 30",
      "gh issue comment 5 --repo agent-kit-startup/agent-kit --body hi",
    ];
    for (const cmd of allowForms) {
      expect(evaluateShellCommand(cmd).permission, cmd).toBe("allow");
    }
  });

  it("allows a direct public-repo write when ALLOW_PUBLIC_PUSH=1 is inline or in process.env", () => {
    // Non-main branch dest: isolates the public-repo-write bypass from the
    // separate git-push-main protection (pushing to the public repo's main
    // still needs ALLOW_MAIN_PUSH=1 too — the two gates are independent).
    expect(
      evaluateShellCommand(
        "ALLOW_PUBLIC_PUSH=1 git push https://github.com/agent-kit-startup/agent-kit.git sync/x",
      ).permission,
    ).toBe("allow");
    process.env.ALLOW_PUBLIC_PUSH = "1";
    expect(
      evaluateShellCommand("gh pr merge 12 -R agent-kit-startup/agent-kit --squash").permission,
    ).toBe("allow");
  });

  it("still requires ALLOW_MAIN_PUSH=1 to push to the public repo's main even with ALLOW_PUBLIC_PUSH=1", () => {
    process.env.ALLOW_PUBLIC_PUSH = "1";
    const r = evaluateShellCommand(
      "git push https://github.com/agent-kit-startup/agent-kit.git main",
    );
    expect(r.permission).toBe("deny");
    expect(r.rule).toBe("git-push-main");
  });

  it("exports SHELL_DENY_RULES covering the named deny ids", () => {
    const ids = SHELL_DENY_RULES.map((r) => r.id);
    expect(ids).toEqual([
      "git-checkout-path",
      "git-restore",
      "git-reset-hard",
      "git-clean-fd",
      "public-repo-direct-write",
      "git-push-main",
    ]);
    for (const rule of SHELL_DENY_RULES) {
      expect(typeof rule.test).toBe("function");
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });
});

describe("SHELL_DENY_RULES scope (git-workflow + public-repo-write, deliberately)", () => {
  it("is exactly the six rules (five git-scoped + the public-repo-write ADR amendment)", () => {
    // ADR 2026-07-29_cli-invariants-thin-hook-adapters, amended 2026-09-11 for
    // agent-signature-leak-guard phase2: widening beyond git-only to also deny
    // `gh pr create|merge` against the public repo is a deliberate, named exception.
    expect(SHELL_DENY_RULES.map((r) => r.id)).toEqual([
      "git-checkout-path",
      "git-restore",
      "git-reset-hard",
      "git-clean-fd",
      "public-repo-direct-write",
      "git-push-main",
    ]);
  });

  it("allows non-git destructive commands, as the help sentence now says", () => {
    // ADR 2026-07-29_cli-invariants-thin-hook-adapters: this guard protects human
    // hunks and protected branches, not the shell's blast radius. If a plan ever
    // widens the scope, this test and `guard shell --help` must change together.
    for (const cmd of ["rm -rf /", "rm -rf ~", "chmod -R 777 /", "dd if=/dev/zero of=/dev/sda"]) {
      expect(evaluateShellCommand(cmd).permission).toBe("allow");
    }
  });
});
