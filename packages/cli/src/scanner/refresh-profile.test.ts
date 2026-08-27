import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readJson } from "../utils/fs.js";
import { refreshRepositoryProfile } from "./safe-fixes.js";

const exec = promisify(execFile);
const GENERATED_AT = "2026-08-20T00:00:00.000Z";

async function git(root: string, ...args: string[]): Promise<void> {
  await exec("git", args, { cwd: root });
}

async function initializeGit(root: string, branch: string): Promise<void> {
  await git(root, "init", "-b", branch);
  await git(root, "config", "user.email", "refresh-profile@example.test");
  await git(root, "config", "user.name", "Refresh Profile Test");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test fixture");
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-refresh-profile-"));
  await writeFile(path.join(root, "README.md"), "# Test repository\n");
  return root;
}

describe("refreshRepositoryProfile", () => {
  it("writes a fresh profile on first run when none exists", async () => {
    const root = await createRepository();

    const result = await refreshRepositoryProfile(root, {
      generatorVersion: "test",
      generatedAt: GENERATED_AT,
    });

    expect(result.changed).toBe(true);
    const onDisk = await readJson<Record<string, unknown>>(
      path.join(root, ".cursor/agent-kit.config.json"),
    );
    expect(onDisk).toMatchObject({ schemaVersion: 1, contractVersion: 1 });
  });

  it("is idempotent: a second refresh with no repository change is a no-op", async () => {
    const root = await createRepository();
    await refreshRepositoryProfile(root, { generatorVersion: "test", generatedAt: GENERATED_AT });
    const firstContent = await readJson<Record<string, unknown>>(
      path.join(root, ".cursor/agent-kit.config.json"),
    );

    const second = await refreshRepositoryProfile(root, {
      generatorVersion: "test",
      generatedAt: "2026-08-21T00:00:00.000Z",
    });

    expect(second.changed).toBe(false);
    const secondContent = await readJson<Record<string, unknown>>(
      path.join(root, ".cursor/agent-kit.config.json"),
    );
    expect(secondContent).toEqual(firstContent);
  });

  it("overwrites a stale scanner-owned fact (currentBranch) instead of staying sticky", async () => {
    const root = await createRepository();
    await initializeGit(root, "main");
    await refreshRepositoryProfile(root, { generatorVersion: "test", generatedAt: GENERATED_AT });

    await git(root, "checkout", "-b", "feature/rename");
    const result = await refreshRepositoryProfile(root, {
      generatorVersion: "test",
      generatedAt: "2026-08-21T00:00:00.000Z",
    });

    expect(result.changed).toBe(true);
    const onDisk = await readJson<{ git: { currentBranch: string } }>(
      path.join(root, ".cursor/agent-kit.config.json"),
    );
    expect(onDisk?.git.currentBranch).toBe("feature/rename");
  });

  it("preserves an operator-confirmed purpose and unrecognized custom keys", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor/agent-kit.config.json"),
      `${JSON.stringify(
        {
          purpose: { value: "operations", confirmed: true },
          customProjectFact: "keep",
        },
        null,
        2,
      )}\n`,
    );

    const result = await refreshRepositoryProfile(root, {
      generatorVersion: "test",
      generatedAt: GENERATED_AT,
    });

    expect(result.changed).toBe(true);
    const onDisk = await readJson<Record<string, unknown>>(
      path.join(root, ".cursor/agent-kit.config.json"),
    );
    expect(onDisk).toMatchObject({
      purpose: { value: "operations", confirmed: true },
      customProjectFact: "keep",
    });
  });
});
