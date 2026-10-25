import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateShellCommand,
  forgeApiMergeCall,
  parsePrMergeHead,
  prMergeKey,
  prMergeTargets,
  SHELL_DENY_RULES,
  unresolvedPrMergeCall,
} from "./shell-guard.js";

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

  it("splits on newlines and a bare background & before matching", () => {
    expect(evaluateShellCommand("echo hi\ngit push origin main").rule).toBe("git-push-main");
    expect(evaluateShellCommand("true & git push origin main").rule).toBe("git-push-main");
    expect(evaluateShellCommand("git push origin feat 2>&1").permission).toBe("allow");
  });

  it("denies deny-rule commands wrapped with a backslash-newline continuation", () => {
    const opts = { currentBranch: "feat/x" };
    expect(evaluateShellCommand("git push origin \\\nmain", opts).rule).toBe("git-push-main");
    expect(evaluateShellCommand("git push \\\n  origin HEAD:main", opts).rule).toBe(
      "git-push-main",
    );
    expect(evaluateShellCommand("git reset \\\r\n  --hard HEAD~1", opts).rule).toBe(
      "git-reset-hard",
    );
    expect(evaluateShellCommand("git clean \\\n -fd", opts).rule).toBe("git-clean-fd");
    expect(evaluateShellCommand("git checkout \\\n -- src/", opts).rule).toBe("git-checkout-path");
  });

  it("keeps every other newline a command boundary (no partial quote/heredoc/comment parsing)", () => {
    const opts = { currentBranch: "feat/x" };
    for (const [cmd, rule] of [
      ['bash -c "cd x\ngit push origin main"', "git-push-main"],
      ["sh -c 'true\ngit push --force origin main'", "git-push-main"],
      ['echo "$(\ngit push origin main\n)"', "git-push-main"],
      ["# don't do this\ngit push origin main", "git-push-main"],
      ['# say "hi\ngit push origin main', "git-push-main"],
      ["# it's fine\ngit restore .", "git-restore"],
      ["echo $'it\\'s'\ngit push origin main", "git-push-main"],
      ["cat <<<x\ngit push origin main", "git-push-main"],
      ["echo $((1<<2))\ngit push origin main", "git-push-main"],
      ["(( x = 1 << 2 ))\ngit reset --hard HEAD~1", "git-reset-hard"],
      ["# usage: cat <<EOF\ngit push origin main", "git-push-main"],
      ["git commit -F - <<'EOF'\nnotes\nEOF\ngit push origin main", "git-push-main"],
      ['bash -c "cd x; git push origin main"', "git-push-main"],
      // An escaped backslash is not a continuation; a comment's trailing backslash does not
      // continue it (the raw newline view still sees the next command).
      ["echo done \\\\\ngit push origin main", "git-push-main"],
      ["# note \\\ngit push origin main", "git-push-main"],
      ["echo x \\\\\ngit reset --hard HEAD~1", "git-reset-hard"],
      // Mid-token continuations: the shell joins the halves with nothing in between.
      ["git push origin ma\\\nin", "git-push-main"],
      ["gi\\\nt push origin main", "git-push-main"],
      ["git pu\\\nsh origin main", "git-push-main"],
      ["git reset --ha\\\nrd", "git-reset-hard"],
      ["git re\\\nstore .", "git-restore"],
    ] as const) {
      expect(evaluateShellCommand(cmd, opts).rule, cmd).toBe(rule);
    }
    // Fail-closed: an env prefix split off by a continuation is denied (git-prod.md: one line).
    expect(evaluateShellCommand("ALLOW_MAIN_PUSH=1 \\\ngit push origin main", opts).rule).toBe(
      "git-push-main",
    );
    // The authorized /git-prod form still passes when wrapped with a continuation.
    expect(
      evaluateShellCommand("ALLOW_MAIN_PUSH=1 git push origin \\\nmain", opts).permission,
    ).toBe("allow");
    // A multi-line message is fine as long as no line starts with a denied command.
    expect(
      evaluateShellCommand('git commit -m "fix: guard\n\nkeeps pushes safe"', opts).permission,
    ).toBe("allow");
  });

  it("canonicalizes wrappers, subshells and git global options before matching", () => {
    const denyForms: Array<[string, string]> = [
      ["git -C . push origin main", "git-push-main"],
      ["sudo git push origin main", "git-push-main"],
      ["(git push origin main)", "git-push-main"],
      ["env git reset --hard", "git-reset-hard"],
      ["git --no-pager reset --hard", "git-reset-hard"],
      ["(cd x && git push origin main)", "git-push-main"],
      ["toString -x; git push origin main", "git-push-main"],
      ["hasOwnProperty -a && git reset --hard", "git-reset-hard"],
    ];
    for (const [cmd, rule] of denyForms) {
      const r = evaluateShellCommand(cmd);
      expect(r.permission, cmd).toBe("deny");
      expect(r.rule, cmd).toBe(rule);
    }
  });

  it("allowlists main-push flags, tokenizes git clean, and treats @ as HEAD", () => {
    for (const cmd of [
      "ALLOW_MAIN_PUSH=1 git push origin main --mirror",
      "ALLOW_MAIN_PUSH=1 git push -d origin main",
      "ALLOW_MAIN_PUSH=1 git push -fu origin main",
      "ALLOW_MAIN_PUSH=1 git push --force-if-includes origin main",
    ]) {
      expect(evaluateShellCommand(cmd).rule, cmd).toBe("git-push-main");
    }
    expect(evaluateShellCommand("git clean -f -d").rule).toBe("git-clean-fd");
    expect(evaluateShellCommand("git clean --force -d").rule).toBe("git-clean-fd");
    expect(evaluateShellCommand("git push origin @", { currentBranch: "main" }).rule).toBe(
      "git-push-main",
    );
    expect(evaluateShellCommand("ALLOW_MAIN_PUSH=1 git push origin main").permission).toBe("allow");
    expect(evaluateShellCommand("ALLOW_MAIN_PUSH=1 git push -u origin HEAD:main").permission).toBe(
      "allow",
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
      "pr-merge-protected-base",
    ]);
    for (const rule of SHELL_DENY_RULES) {
      expect(typeof rule.test).toBe("function");
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });
});

describe("SHELL_DENY_RULES scope (git-workflow + two named forge exceptions, deliberately)", () => {
  it("is exactly the seven rules (five git-scoped + public-repo-write + PR merge base)", () => {
    // ADR 2026-07-29_cli-invariants-thin-hook-adapters, amended 2026-09-11 for
    // agent-signature-leak-guard phase2 (`gh pr create|merge` against the public
    // repo) and 2026-10-19 (`gh pr merge` / `glab mr merge` into a protected or
    // unresolved base): each widening beyond git-only is a deliberate, named exception.
    expect(SHELL_DENY_RULES.map((r) => r.id)).toEqual([
      "git-checkout-path",
      "git-restore",
      "git-reset-hard",
      "git-clean-fd",
      "public-repo-direct-write",
      "git-push-main",
      "pr-merge-protected-base",
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

describe("pr-merge-protected-base (gh pr merge / glab mr merge)", () => {
  afterEach(() => {
    delete process.env.ALLOW_MAIN_PUSH;
  });

  it("parses the selector, the repo and the forge, skipping flag values", () => {
    expect(parsePrMergeHead("gh pr merge 12 --squash")).toEqual({
      forge: "github",
      selector: "12",
      repo: null,
    });
    expect(parsePrMergeHead("gh pr merge -R acme/app --subject x 34 --merge")).toEqual({
      forge: "github",
      selector: "34",
      repo: "acme/app",
    });
    expect(parsePrMergeHead("gh pr merge --repo=acme/app")).toEqual({
      forge: "github",
      selector: null,
      repo: "acme/app",
    });
    expect(parsePrMergeHead("glab mr merge 5 -m done")).toEqual({
      forge: "gitlab",
      selector: "5",
      repo: null,
    });
    expect(parsePrMergeHead("gh pr view 12")).toBeNull();
  });

  it("finds every merge in a compound command, after wrappers and env", () => {
    const targets = prMergeTargets("gh pr checks 3 && sudo FOO=1 gh pr merge 3 ; glab mr merge 9");
    expect(targets.map((t) => `${t.forge}:${t.selector}`)).toEqual(["github:3", "gitlab:9"]);
  });

  const bases = (base: string | null, command: string) => {
    const [target] = prMergeTargets(command);
    if (!target) throw new Error(`no merge in ${command}`);
    return { prMergeBases: { [prMergeKey(target)]: base } };
  };

  it("allows a merge into staging, develop or a feature base", () => {
    for (const base of ["staging", "develop", "homologacao", "feat/x"]) {
      const cmd = "gh pr merge 12 --merge";
      expect(evaluateShellCommand(cmd, bases(base, cmd)).permission, base).toBe("allow");
    }
  });

  it("denies a merge into main, master or prod, and an unresolved base", () => {
    for (const base of ["main", "master", "prod", null]) {
      const cmd = "gh pr merge 12 --merge";
      const r = evaluateShellCommand(cmd, bases(base, cmd));
      expect(r.permission, String(base)).toBe("deny");
      expect(r.rule, String(base)).toBe("pr-merge-protected-base");
    }
    const glab = "glab mr merge 5";
    expect(evaluateShellCommand(glab, bases("main", glab)).rule).toBe("pr-merge-protected-base");
  });

  it("lets the authorized /git-prod env through, like the main push", () => {
    const cmd = "ALLOW_MAIN_PUSH=1 gh pr merge 12 --merge";
    expect(evaluateShellCommand(cmd, bases("main", cmd)).permission).toBe("allow");
  });

  it("denies a gh api / glab api merge whatever the base, also from pure callers", () => {
    for (const cmd of [
      "gh api -X PUT repos/acme/app/pulls/12/merge",
      "gh api --method PUT /repos/acme/app/pulls/12/merge -f merge_method=merge",
      "gh api repos/{owner}/{repo}/pulls/$n/merge -X PUT",
      "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
      "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
      "gh api repos/acme/app/merges -f base=main -f head=staging",
      "glab api -X PUT projects/1/merge_requests/5/merge",
      "bash -c 'gh api -X PUT repos/a/b/pulls/1/merge'",
      "for n in 1 2; do gh api -X PUT repos/a/b/pulls/$n/merge; done",
      "echo 7 | xargs -I{} gh api -X PUT repos/a/b/pulls/{}/merge",
      "/usr/bin/gh api -X PUT repos/a/b/pulls/1/merge",
    ]) {
      const r = evaluateShellCommand(cmd);
      expect(r.permission, cmd).toBe("deny");
      expect(r.rule, cmd).toBe("pr-merge-protected-base");
      expect(forgeApiMergeCall(cmd), cmd).toBe(true);
    }
  });

  it("allows forge API reads and the authorized env on an api merge", () => {
    for (const cmd of [
      "gh api repos/acme/app/pulls/12",
      "gh api repos/acme/app/pulls/12/files",
      "gh api graphql -f query='{ viewer { login } }'",
      "gh pr view 12 --json mergeable",
      "git log --grep mergePullRequest",
      "ALLOW_MAIN_PUSH=1 gh api -X PUT repos/a/b/pulls/1/merge",
    ]) {
      expect(evaluateShellCommand(cmd).permission, cmd).toBe("allow");
    }
  });

  it("skips the base check without resolved bases (pure callers)", () => {
    expect(evaluateShellCommand("gh pr merge 12").permission).toBe("allow");
  });

  // Error memo 2026-10-24_guard-pr-merge-unrecognized-head-fail-open: a loop merged three PRs
  // into main because the head was not `gh pr merge`, so no target was parsed and the rule
  // allowed. A merge the guard cannot resolve to a literal target now fails closed.
  const UNRESOLVED_MERGES = [
    "for n in 31 32 33 34; do gh pr merge $n -R acme/app --merge; done",
    "for n in 1 2; do gh pr merge 1; done",
    "if true; then gh pr merge 1; fi",
    "if false; then :; else gh pr merge 1; fi",
    "! gh pr merge 1",
    "echo 1 | xargs -n1 gh pr merge",
    "xargs -n1 gh pr merge < prs.txt",
    "bash -c 'gh pr merge 1'",
    'sh -c "gh pr merge 1 --squash"',
    'while read n; do gh pr merge "$n"; done < prs.txt',
    "for n in 1 2; do glab mr merge $n; done",
    "if true; then glab mr merge 1; fi",
    "! glab mr merge 1",
    "echo 1 | xargs -n1 glab mr merge",
    "bash -c 'glab mr merge 1'",
    "sh -c 'glab mr merge 1'",
  ];

  it("denies a merge it cannot resolve to a literal target, whatever the base", () => {
    for (const cmd of UNRESOLVED_MERGES) {
      expect(unresolvedPrMergeCall(cmd), cmd).toBe(true);
      for (const opts of [undefined, { prMergeBases: {} }]) {
        const r = evaluateShellCommand(cmd, opts);
        expect(r.permission, cmd).toBe("deny");
        expect(r.rule, cmd).toBe("pr-merge-protected-base");
        expect(r.agent_message, cmd).toMatch(/literal `gh pr merge <n>` at the head/);
      }
    }
  });

  it("denies a loop merge even when a literal merge in the same command resolves to staging", () => {
    const cmd = "gh pr merge 12 --merge && for n in 1 2; do gh pr merge $n; done";
    expect(evaluateShellCommand(cmd, bases("staging", cmd)).rule).toBe("pr-merge-protected-base");
  });

  it("keeps a literal merge at a recognized head on the base check", () => {
    for (const cmd of [
      "gh pr merge 12 --squash",
      "{ gh pr merge 12; }",
      "(gh pr merge 12)",
      "time gh pr merge 12",
      "env FOO=1 gh pr merge 12",
      "cd /tmp/wt && gh pr merge 12 --merge",
      "glab mr merge 12",
    ]) {
      expect(unresolvedPrMergeCall(cmd), cmd).toBe(false);
      expect(evaluateShellCommand(cmd, bases("staging", cmd)).permission, cmd).toBe("allow");
      expect(evaluateShellCommand(cmd, bases("main", cmd)).rule, cmd).toBe(
        "pr-merge-protected-base",
      );
    }
  });

  it("keeps denying selector shapes that do not resolve", () => {
    // A loop body on its own line starts its segment with `gh pr merge $n`: a recognized head
    // whose selector `$n` cannot resolve, so the base check denies it.
    for (const cmd of [
      'gh pr merge "$PR"',
      "gh pr merge $(gh pr list -q .[0].number)",
      "for n in 1 2; do\n  gh pr merge $n --merge\ndone",
    ]) {
      expect(evaluateShellCommand(cmd, bases(null, cmd)).rule, cmd).toBe("pr-merge-protected-base");
    }
  });

  it("lets ALLOW_MAIN_PUSH=1 through an unresolved merge, inline or in the env", () => {
    expect(evaluateShellCommand("ALLOW_MAIN_PUSH=1 bash -c 'gh pr merge 1'").permission).toBe(
      "allow",
    );
    process.env.ALLOW_MAIN_PUSH = "1";
    expect(evaluateShellCommand("for n in 1 2; do gh pr merge $n; done").permission).toBe("allow");
  });

  it("denies text that only mentions the command (accepted false positive)", () => {
    for (const cmd of [
      "grep -rn 'gh pr merge' docs/",
      'git commit -m "docs: explain gh pr merge"',
      "echo glab mr merge",
    ]) {
      expect(evaluateShellCommand(cmd).rule, cmd).toBe("pr-merge-protected-base");
    }
  });

  it("allows commands that only look like a merge", () => {
    for (const cmd of [
      "gh pr view 12 --json mergeable",
      "echo gh pr mergeable",
      "gh pr list --search merged",
      "git merge origin/staging",
      "glab mr view 5",
    ]) {
      expect(evaluateShellCommand(cmd).permission, cmd).toBe("allow");
    }
  });
});
