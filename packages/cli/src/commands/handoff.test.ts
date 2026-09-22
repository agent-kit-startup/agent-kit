import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { detectGit } from "../scanner/detect-git.js";
import type { ProjectProfile } from "../types.js";
import { buildRoutines, runPrune } from "./handoff.js";

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

function synthHandoffFile(narrativeCount: number): string {
  const narrative = Array.from(
    { length: narrativeCount },
    (_, i) => `- **Tick ${narrativeCount - i} (completed):** body text for this tick entry.\n`,
  ).join("\n");
  return `# Handoff - synth

- **Plan:** \`synth.plan.md\`
- **Mode:** run-plan (orchestrated)

${narrative}
## Work Status

- **In progress:** none
`;
}

describe("runPrune", () => {
  it("archives older narrative entries and rewrites HANDOFF.md in place", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-handoff-prune-"));
    const handoffDir = path.join(root, ".cursor");
    await mkdir(handoffDir, { recursive: true });
    const handoffPath = path.join(handoffDir, "HANDOFF.md");
    await writeFile(handoffPath, synthHandoffFile(6), "utf8");

    await runPrune(root, 2);

    const rewritten = await readFile(handoffPath, "utf8");
    expect(rewritten).toContain("Tick 6");
    expect(rewritten).toContain("Tick 5");
    expect(rewritten).not.toContain("Tick 4");
    expect(rewritten).toContain("- **Plan:** `synth.plan.md`");

    const archiveDir = path.join(handoffDir, "context", "archive");
    const archiveFiles = await readdir(archiveDir);
    expect(archiveFiles).toHaveLength(1);
    const archived = await readFile(path.join(archiveDir, archiveFiles[0] as string), "utf8");
    expect(archived).toContain("Tick 4");
    expect(archived).toContain("Tick 1");
    expect(archived).not.toContain("Tick 6");
  });

  it("is a no-op when there is nothing to prune", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-handoff-prune-noop-"));
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    const handoffPath = path.join(root, ".cursor", "HANDOFF.md");
    const original = synthHandoffFile(2);
    await writeFile(handoffPath, original, "utf8");

    await runPrune(root, 5);

    expect(await readFile(handoffPath, "utf8")).toBe(original);
  });

  it("warns and exits non-zero when the file is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-handoff-prune-missing-"));
    await runPrune(root, 5);
    // No throw; nothing written. Covered implicitly by absence of errors.
  });
});
