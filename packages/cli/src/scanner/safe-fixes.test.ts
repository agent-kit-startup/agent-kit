import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SafeReadinessExecution } from "../types.js";
import { fileExists, readJson } from "../utils/fs.js";
import { executeSafeReadinessFixes } from "./safe-fixes.js";

const GENERATED_AT = "2026-07-24T12:00:00.000Z";

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-safe-fixes-"));
  await writeFile(path.join(root, "README.md"), "# Test repository\n");
  return root;
}

async function execute(root: string, dryRun = false): Promise<SafeReadinessExecution> {
  return executeSafeReadinessFixes(root, {
    generatorVersion: "test",
    generatedAt: GENERATED_AT,
    dryRun,
  });
}

describe("executeSafeReadinessFixes", () => {
  it("applies local fixes idempotently", async () => {
    const root = await createRepository();
    const first = await execute(root);
    const firstProfile = await readFile(path.join(root, ".cursor/agent-kit.config.json"), "utf8");
    const firstConfig = await readFile(path.join(root, ".cursor/context/config.json"), "utf8");
    const firstGitignore = await readFile(path.join(root, ".gitignore"), "utf8");

    const second = await execute(root);

    expect(first.changes.some((change) => change.status === "applied")).toBe(true);
    expect(second.changes.every((change) => change.status === "skipped")).toBe(true);
    expect(await readFile(path.join(root, ".cursor/agent-kit.config.json"), "utf8")).toBe(
      firstProfile,
    );
    expect(await readFile(path.join(root, ".cursor/context/config.json"), "utf8")).toBe(
      firstConfig,
    );
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(firstGitignore);
    expect(first.after.appliedSafeFixes.map((action) => action.id)).toContain(
      "merge-secret-ignores",
    );
  }, 15_000);

  it("reports dry-run changes without writing files", async () => {
    const root = await createRepository();
    const result = await execute(root, true);

    expect(result.changes.some((change) => change.status === "planned")).toBe(true);
    expect(await fileExists(path.join(root, ".cursor"))).toBe(false);
    expect(await fileExists(path.join(root, ".gitignore"))).toBe(false);
    expect(result.after.repositoryFingerprint).toBe(result.before.repositoryFingerprint);
  });

  it("keeps legacy onboarded while deriving readiness state and preserving customizations", async () => {
    const root = await createRepository();
    await mkdir(path.join(root, ".cursor/context"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor/agent-kit.config.json"),
      `${JSON.stringify(
        {
          git: { provider: "gitlab", providerKind: "gitlab-self-hosted" },
          purpose: { value: "operations", confirmed: true },
          customProjectFact: "keep",
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      path.join(root, ".cursor/context/config.json"),
      `${JSON.stringify(
        {
          onboarded: true,
          autoHandoff: true,
          agentPersona: { default: "ghost-runner", customMode: "keep" },
          customPreference: "keep",
        },
        null,
        2,
      )}\n`,
    );

    await execute(root);

    const profile = await readJson<Record<string, unknown>>(
      path.join(root, ".cursor/agent-kit.config.json"),
    );
    const config = await readJson<{
      onboarded: boolean;
      onboarding: {
        status: string;
        contractVersion: number;
        checks: Record<string, { status: string; essential: boolean }>;
      };
      autoHandoff: boolean;
      agentPersona: { default: string; customMode: string; modes: Record<string, string> };
      customPreference: string;
    }>(path.join(root, ".cursor/context/config.json"));

    expect(profile).toMatchObject({
      git: { provider: "gitlab", providerKind: "gitlab-self-hosted" },
      purpose: { value: "operations", confirmed: true },
      customProjectFact: "keep",
    });
    expect(config).toMatchObject({
      onboarded: true,
      onboarding: { status: "in_progress", contractVersion: 1 },
      autoHandoff: true,
      agentPersona: { default: "ghost-runner", customMode: "keep" },
      customPreference: "keep",
    });
    expect(config?.onboarding.checks["workspace.agent-kit"]).toMatchObject({
      status: "auto_fix",
      essential: true,
    });
    expect(config?.agentPersona.modes["run-plan"]).toBe("night-shift");
  });

  it("merges every required secret ignore without removing custom entries", async () => {
    const root = await createRepository();
    await writeFile(
      path.join(root, ".gitignore"),
      "node_modules\n.env\n# project files\ncustom.tmp",
    );

    await execute(root);
    const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");

    expect(gitignore).toContain("node_modules\n");
    expect(gitignore).toContain("# project files\n");
    expect(gitignore).toContain("custom.tmp\n");
    for (const pattern of [
      ".env",
      ".env.*",
      "*.key",
      "*.pem",
      "*.p12",
      "*.pfx",
      "*credentials*.json",
      "*service-account*.json",
    ]) {
      expect(gitignore.split(/\r?\n/).filter((line) => line === pattern)).toHaveLength(1);
    }
  });

  it("does not modify protected or project-owned content", async () => {
    const root = await createRepository();
    const protectedFiles = [
      ".cursor/HANDOFF.md",
      ".cursor/plans/custom.plan.md",
      ".cursor/memory/decisions/custom.md",
      ".cursor/rules/custom.mdc",
      ".cursor/skills/custom/SKILL.md",
      ".cursor/context/current/task.md",
      ".cursor/context/backups/config.json",
    ];
    await Promise.all(
      protectedFiles.map(async (relativePath) => {
        const target = path.join(root, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, `protected:${relativePath}\n`);
      }),
    );

    await execute(root);

    for (const relativePath of protectedFiles) {
      expect(await readFile(path.join(root, relativePath), "utf8")).toBe(
        `protected:${relativePath}\n`,
      );
    }
  });
});
