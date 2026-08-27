import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { detectGit, inferWorkflow } from "./detect-git.js";

const exec = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<void> {
  await exec("git", args, { cwd: root });
}

async function initializeGit(root: string, branch = "main"): Promise<void> {
  await git(root, "init", "-b", branch);
  await git(root, "config", "user.email", "detect-git@example.test");
  await git(root, "config", "user.name", "Detect Git Test");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test fixture");
}

describe("inferWorkflow", () => {
  it("returns homolog-prod when a local staging branch exists, regardless of the current branch", () => {
    expect(inferWorkflow("main", true, false)).toBe("homolog-prod");
  });

  it("returns homolog-prod when only a remote staging branch exists", () => {
    expect(inferWorkflow("main", false, true)).toBe("homolog-prod");
  });

  it("falls back to feature-pr on main/master when no staging branch exists anywhere", () => {
    expect(inferWorkflow("main", false, false)).toBe("feature-pr");
    expect(inferWorkflow("master", false, false)).toBe("feature-pr");
  });

  it("falls back to gitflow for develop/release branches when no staging branch exists", () => {
    expect(inferWorkflow("develop", false, false)).toBe("gitflow");
    expect(inferWorkflow("release/1.0", false, false)).toBe("gitflow");
  });

  it("falls back to branch-name matching for homolog/staging-like branches", () => {
    expect(inferWorkflow("homolog", false, false)).toBe("homolog-prod");
    expect(inferWorkflow("feature/staging-fix", false, false)).toBe("homolog-prod");
  });

  it("returns unknown when there is no current branch and no staging fact", () => {
    expect(inferWorkflow(undefined, false, false)).toBe("unknown");
  });

  it("returns feature-pr for an unmatched branch name with no staging fact", () => {
    expect(inferWorkflow("feature/add-widget", false, false)).toBe("feature-pr");
  });
});

describe("detectGit workflow", () => {
  it("reports homolog-prod even when HEAD is on the default branch, not the staging branch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-detect-git-local-staging-"));
    await writeFile(path.join(root, "README.md"), "# Repository\n");
    await initializeGit(root);
    await git(root, "branch", "staging");
    // HEAD stays on "main" -- the bug this guards against is workflow
    // flipping to feature-pr just because the operator isn't checked out
    // on the staging branch itself.

    const result = await detectGit(root);

    expect(result.currentBranch).toBe("main");
    expect(result.hasLocalStaging).toBe(true);
    expect(result.workflow).toBe("homolog-prod");
  }, 15_000);

  it("reports homolog-prod from a remote-only staging branch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-detect-git-remote-staging-"));
    await writeFile(path.join(root, "README.md"), "# Repository\n");
    await initializeGit(root);
    await git(root, "remote", "add", "origin", "git@git.example.test:team/repo.git");
    await git(root, "update-ref", "refs/remotes/origin/staging", "HEAD");

    const result = await detectGit(root);

    expect(result.hasLocalStaging).toBe(false);
    expect(result.hasRemoteStaging).toBe(true);
    expect(result.workflow).toBe("homolog-prod");
  }, 15_000);

  it("reports feature-pr on main when there is no staging branch anywhere", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-detect-git-no-staging-"));
    await writeFile(path.join(root, "README.md"), "# Repository\n");
    await initializeGit(root);

    const result = await detectGit(root);

    expect(result.hasLocalStaging).toBe(false);
    expect(result.hasRemoteStaging).toBe(false);
    expect(result.workflow).toBe("feature-pr");
  }, 15_000);
});
