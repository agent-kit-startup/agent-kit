import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSafeReadinessFixes } from "./safe-fixes.js";
import { runScanner } from "./scan.js";

vi.mock("./scan.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scan.js")>();
  return { ...actual, runScanner: vi.fn(actual.runScanner) };
});

const exec = promisify(execFile);
const GENERATED_AT = "2026-07-24T12:00:00.000Z";

async function git(root: string, ...args: string[]): Promise<void> {
  await exec("git", args, { cwd: root });
}

async function createGitRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-safe-fixes-scans-"));
  await writeFile(path.join(root, "README.md"), "# Test repository\n");
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test");
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "init");
  return root;
}

function execute(root: string) {
  return executeSafeReadinessFixes(root, { generatorVersion: "test", generatedAt: GENERATED_AT });
}

describe("executeSafeReadinessFixes scan count", () => {
  beforeEach(() => {
    vi.mocked(runScanner).mockClear();
  });

  it("runs two full scans and refreshes only git dirtiness after the config write", async () => {
    const root = await createGitRepository();
    await execute(root);
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "apply safe fixes");
    // Only the context config is missing now, so the evidence scan sees a clean tree.
    await rm(path.join(root, ".cursor/context/config.json"));
    await git(root, "commit", "-qam", "drop context config");
    vi.mocked(runScanner).mockClear();

    const result = await execute(root);

    expect(vi.mocked(runScanner)).toHaveBeenCalledTimes(2);
    expect(result.changes.find((c) => c.id === "merge-onboarding-state")?.status).toBe("applied");
    expect(result.after.scan.git.isDirty).toBe(true);
  });
});
