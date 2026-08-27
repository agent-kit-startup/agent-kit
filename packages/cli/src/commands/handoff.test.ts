import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { detectGit } from "../scanner/detect-git.js";
import type { ProjectProfile } from "../types.js";
import { buildRoutines } from "./handoff.js";

const exec = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<void> {
  await exec("git", args, { cwd: root });
}

async function initializeGit(root: string): Promise<void> {
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "handoff@example.test");
  await git(root, "config", "user.name", "Handoff Test");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test fixture");
}

function profileWithWorkflow(workflow: ProjectProfile["git"]["workflow"]): ProjectProfile {
  return {
    git: { workflow },
    services: {},
  } as unknown as ProjectProfile;
}

describe("buildRoutines", () => {
  it("suggests staging/prod routines when the profile workflow is homolog-prod", () => {
    const routines = buildRoutines(profileWithWorkflow("homolog-prod"));

    expect(routines).toEqual(
      expect.arrayContaining([
        "- [ ] `git staging` - move changes to staging",
        "- [ ] `git prod` - promote to production (after approval)",
      ]),
    );
  });

  it("suggests a plain PR/MR routine for feature-pr workflows", () => {
    const routines = buildRoutines(profileWithWorkflow("feature-pr"));

    expect(routines).toContain("- [ ] Commit, push and open PR/MR");
    expect(routines.some((line) => line.includes("git staging"))).toBe(false);
  });

  it("returns the PR/MR routine when there is no profile at all", () => {
    const routines = buildRoutines(null);

    expect(routines).toContain("- [ ] Commit, push and open PR/MR");
  });

  it("benefits from the branch-independent workflow fix: staging exists but HEAD is on main", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-handoff-routines-"));
    await writeFile(path.join(root, "README.md"), "# Repository\n");
    await initializeGit(root);
    await git(root, "branch", "staging");

    const git_ = await detectGit(root);
    const routines = buildRoutines({ git: git_, services: {} } as unknown as ProjectProfile);

    expect(git_.currentBranch).toBe("main");
    expect(routines).toEqual(
      expect.arrayContaining([
        "- [ ] `git staging` - move changes to staging",
        "- [ ] `git prod` - promote to production (after approval)",
      ]),
    );
  }, 15_000);
});
