import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { performInstall } from "../commands/install.js";
import { fileExists } from "../utils/fs.js";
import { createReadinessReport } from "./readiness.js";
import { executeSafeReadinessFixes } from "./safe-fixes.js";
import { runScanner } from "./scan.js";

const exec = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const FIXTURE_ROOT = path.join(REPOSITORY_ROOT, "dogfood/fixtures/ops-knowledge-self-hosted");
const GENERATED_AT = "2026-07-24T15:00:00.000Z";

async function git(root: string, ...args: string[]): Promise<void> {
  await exec("git", args, { cwd: root });
}

async function initializeGit(root: string): Promise<void> {
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "readiness@example.test");
  await git(root, "config", "user.name", "Readiness Test");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
}

describe("readiness integration scenarios", () => {
  it("classifies an empty directory as greenfield with unknown purpose", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-empty-"));
    const scan = await runScanner(root);
    const report = createReadinessReport(scan, {
      generatorVersion: "test",
      generatedAt: GENERATED_AT,
    });

    expect(scan.isGreenfield).toBe(true);
    expect(scan.purpose.value).toBe("unknown");
    expect(scan.stack.packageManager).toBeUndefined();
    expect(report.pillars).toHaveLength(9);
    expect(report.pendingActions.length).toBeGreaterThan(0);
  });

  it("detects Node with lockfile package manager without inventing pnpm", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-node-lock-"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "consumer-app",
        scripts: { test: "vitest run", lint: "biome check ." },
      }),
    );
    await writeFile(path.join(root, "package-lock.json"), "{}");

    const scan = await runScanner(root);

    expect(scan.isGreenfield).toBe(false);
    expect(scan.purpose.categories).toContain("application");
    expect(scan.stack.packageManager).toBe("npm");
    expect(scan.stack.packageManager).not.toBe("pnpm");
    expect(scan.quality.testCommands).toEqual(["npm run test"]);
  });

  it("detects a monorepo from workspace configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-monorepo-"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
        scripts: { test: "vitest run" },
      }),
    );
    await writeFile(path.join(root, "package-lock.json"), "{}");
    await mkdir(path.join(root, "packages", "api"), { recursive: true });
    await writeFile(
      path.join(root, "packages", "api", "package.json"),
      JSON.stringify({ name: "@example/api" }),
    );

    const scan = await runScanner(root);

    expect(scan.isGreenfield).toBe(false);
    expect(scan.stack.workspaces).toBe(true);
    expect(scan.purpose.categories).toContain("monorepo");
    expect(scan.stack.packageManager).toBe("npm");
  });

  it("preserves customized artifacts while applying safe readiness fixes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-customized-"));
    const handoff = "# Handoff - active work\n\n- Next: keep this file\n";
    const plan = "---\nname: active-delivery\n---\n# Active delivery\n";
    const customRule = "# Custom project rule\n";
    await mkdir(path.join(root, ".cursor/plans"), { recursive: true });
    await mkdir(path.join(root, ".cursor/rules"), { recursive: true });
    await writeFile(path.join(root, "README.md"), "# Customized repository\n");
    await writeFile(path.join(root, ".cursor/HANDOFF.md"), handoff);
    await writeFile(path.join(root, ".cursor/plans/active-delivery.plan.md"), plan);
    await writeFile(path.join(root, ".cursor/rules/custom-project.mdc"), customRule);
    await writeFile(path.join(root, ".gitignore"), "node_modules\n.env\nproject-local.tmp\n");

    const execution = await executeSafeReadinessFixes(root, {
      generatorVersion: "test",
      generatedAt: GENERATED_AT,
    });

    expect(execution.changes.some((change) => change.status === "applied")).toBe(true);
    expect(await readFile(path.join(root, ".cursor/HANDOFF.md"), "utf8")).toBe(handoff);
    expect(await readFile(path.join(root, ".cursor/plans/active-delivery.plan.md"), "utf8")).toBe(
      plan,
    );
    expect(await readFile(path.join(root, ".cursor/rules/custom-project.mdc"), "utf8")).toBe(
      customRule,
    );
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain("project-local.tmp");
    expect(await fileExists(path.join(root, ".cursor/agent-kit.config.json"))).toBe(true);
  });

  it("classifies docs/ops n8n+SQL repositories without inventing an app stack", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-docs-ops-"));
    await Promise.all([
      mkdir(path.join(root, "docs")),
      mkdir(path.join(root, "n8n")),
      mkdir(path.join(root, "sql")),
      mkdir(path.join(root, "runbooks")),
    ]);
    await writeFile(path.join(root, "docs", "overview.md"), "# Overview\n");
    await writeFile(path.join(root, "n8n", "workflow.json"), '{"name":"sample"}\n');
    await writeFile(path.join(root, "sql", "schema.sql"), "create table items (id int);\n");
    await writeFile(path.join(root, "runbooks", "ops.md"), "# Ops\n");

    const scan = await runScanner(root);

    expect(scan.isGreenfield).toBe(false);
    expect(scan.stack.packageManager).toBeUndefined();
    expect(scan.purpose.categories).toEqual(
      expect.arrayContaining(["documentation", "operations", "automation"]),
    );
    expect(scan.purpose.categories).not.toContain("application");
  });

  it("dogfoods the ops/knowledge self-hosted fixture signals", async () => {
    if (
      !(await access(FIXTURE_ROOT)
        .then(() => true)
        .catch(() => false))
    ) {
      return; // dogfood fixture only in private repo
    }
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-dogfood-ops-"));
    await cp(FIXTURE_ROOT, root, { recursive: true });
    await initializeGit(root);
    await git(root, "remote", "add", "origin", "git@git.example.test:ops/knowledge-base.git");
    await git(root, "branch", "staging");
    await git(root, "update-ref", "refs/remotes/origin/staging", "HEAD");

    const install = await performInstall({ cwd: root, registry: REPOSITORY_ROOT });
    const scan = await runScanner(root);
    const handoffBefore = await readFile(path.join(FIXTURE_ROOT, ".cursor/HANDOFF.md"), "utf8");
    const sitePlan = await readFile(path.join(root, ".cursor/plans/site-redesign.plan.md"), "utf8");
    const channelPlan = await readFile(
      path.join(root, ".cursor/plans/channel-automation.plan.md"),
      "utf8",
    );

    expect(scan.isGreenfield).toBe(false);
    expect(scan.purpose.categories).toEqual(
      expect.arrayContaining(["documentation", "knowledge", "operations", "automation"]),
    );
    expect(scan.stack.packageManager).toBeUndefined();
    expect(scan.git.provider).toBe("gitlab");
    expect(scan.git.providerKind).toBe("gitlab-self-hosted");
    expect(scan.git.hasLocalStaging).toBe(true);
    expect(scan.git.hasRemoteStaging).toBe(true);
    expect(JSON.stringify(scan)).not.toMatch(/github/i);
    expect(JSON.stringify(scan)).not.toMatch(/pnpm/i);
    expect(await readFile(path.join(root, ".cursor/HANDOFF.md"), "utf8")).toBe(handoffBefore);
    expect(sitePlan).toContain("active site work");
    expect(channelPlan).toContain("active channel work");
    expect(await fileExists(path.join(root, ".cursor/commands/onboard.md"))).toBe(false);
    expect(await fileExists(path.join(root, ".cursor/commands/agent-kit-onboard.md"))).toBe(true);
    expect(install.readiness.generatorVersion).toBeTruthy();
    expect(
      install.readiness.pillars
        .flatMap((pillar) => pillar.checks)
        .some((check) => check.id === "collaboration.provider"),
    ).toBe(true);
  }, 30_000);
});
