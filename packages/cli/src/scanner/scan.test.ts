import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createReadinessReport } from "./readiness.js";
import { runScanner } from "./scan.js";
import { serializeReadinessReport } from "./snapshot.js";

const exec = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<void> {
  await exec("git", args, { cwd: root });
}

async function initializeGit(root: string): Promise<void> {
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "scanner@example.test");
  await git(root, "config", "user.name", "Scanner Test");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test fixture");
}

describe("runScanner", () => {
  it("detects greenfield repo", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-greenfield-"));
    await writeFile(path.join(root, "README.md"), "# temp");
    const result = await runScanner(root);
    expect(result.isGreenfield).toBe(true);
  });

  it("detects existing node project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-existing-"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        packageManager: "npm@10.0.0",
        scripts: { test: "vitest run", lint: "biome check ." },
      }),
    );
    await writeFile(path.join(root, "package-lock.json"), "{}");
    const result = await runScanner(root);
    expect(result.isGreenfield).toBe(false);
    expect(result.stack.language).toBe("node");
    expect(result.stack.packageManager).toBe("npm");
    expect(result.quality.testCommands).toEqual(["npm run test"]);
  });

  it("recognizes documentation, operations, automation, and knowledge evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-ops-"));
    await Promise.all([
      mkdir(path.join(root, "docs")),
      mkdir(path.join(root, "runbooks")),
      mkdir(path.join(root, "n8n")),
      mkdir(path.join(root, "sql")),
      mkdir(path.join(root, "knowledge")),
    ]);
    await writeFile(path.join(root, "docs", "architecture.md"), "# Architecture");
    const result = await runScanner(root);
    expect(result.isGreenfield).toBe(false);
    expect(result.purpose.value).toBe("mixed");
    expect(result.purpose.categories).toEqual(
      expect.arrayContaining(["documentation", "knowledge", "operations", "automation"]),
    );
  });

  it("does not infer a provider from a custom hostname substring", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-custom-provider-"));
    await writeFile(path.join(root, "README.md"), "# Repository");
    await initializeGit(root);
    await git(root, "remote", "add", "origin", "ssh://git@github.internal.example/team/repo.git");
    const result = await runScanner(root);
    const report = createReadinessReport(result, {
      generatorVersion: "test",
      generatedAt: "2026-07-24T12:00:00.000Z",
    });
    const providerCheck = report.pillars
      .find((item) => item.pillar === "collaboration")
      ?.checks.find((item) => item.id === "collaboration.provider");

    expect(result.git.provider).toBe("other");
    expect(result.git.providerKind).toBe("custom");
    expect(result.git.providerConfidence).toBe("low");
    expect(providerCheck?.status).toBe("needs_choice");
    expect(providerCheck?.essential).toBe(false);
    expect(report.pendingActions.some((item) => item.id === "confirm-provider")).toBe(true);
  }, 15_000);

  it("uses GitLab CI as supporting evidence for self-hosted GitLab", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-gitlab-provider-"));
    await writeFile(path.join(root, ".gitlab-ci.yml"), "test:\n  script: echo test\n");
    await initializeGit(root);
    await git(root, "remote", "add", "origin", "git@git.example.test:team/repo.git");
    await git(root, "branch", "staging");
    await git(root, "update-ref", "refs/remotes/origin/staging", "HEAD");
    const result = await runScanner(root);
    expect(result.git.provider).toBe("gitlab");
    expect(result.git.providerKind).toBe("gitlab-self-hosted");
    expect(result.git.providerConfidence).toBe("medium");
    expect(result.git.hasLocalStaging).toBe(true);
    expect(result.git.hasRemoteStaging).toBe(true);
  }, 15_000);

  it("does not request provider confirmation for a local-only repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-local-only-"));
    await writeFile(path.join(root, "README.md"), "# Local repository");
    await initializeGit(root);
    const scan = await runScanner(root);
    const report = createReadinessReport(scan, {
      generatorVersion: "test",
      generatedAt: "2026-07-24T12:00:00.000Z",
    });
    const providerCheck = report.pillars
      .find((item) => item.pillar === "collaboration")
      ?.checks.find((item) => item.id === "collaboration.provider");

    expect(scan.git.mode).toBe("local-only");
    expect(providerCheck?.status).toBe("ready");
    expect(providerCheck?.essential).toBe(false);
    expect(report.pendingActions.some((item) => item.id === "confirm-provider")).toBe(false);
  }, 15_000);

  it("builds a portable readiness snapshot with grouped checks and owned actions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-readiness-"));
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "docs", "runbook.md"), "# Runbook");
    const scan = await runScanner(root);
    const report = createReadinessReport(scan, {
      generatorVersion: "test",
      generatedAt: "2026-07-24T12:00:00.000Z",
    });
    const serialized = serializeReadinessReport(report);
    const parsed = JSON.parse(serialized);

    expect(report.pillars).toHaveLength(9);
    expect(report.repositoryFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized).not.toContain(root);
    expect(parsed.schemaVersion).toBe(1);
    expect(
      report.pendingActions.every(
        (item) => item.status && item.recommendation.length > 0 && item.owner,
      ),
    ).toBe(true);
  });
});
