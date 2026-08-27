// Integration coverage for dashboard/dashboard-data.mjs run as a real subprocess
// against a scratch git repo. Unlike the "wiring" tests elsewhere in this
// directory (which grep dashboard-data.mjs's source text), these tests execute
// the script end-to-end so a regression in the git-status trim or the
// kitManaged registry/fallback resolution actually fails the suite.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dashboardDataScript = resolve(repoRoot, "dashboard/dashboard-data.mjs");

/** Minimal local git identity so `git commit` never hits an interactive prompt. */
function initGitRepo(dir: string) {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "dashboard-data-test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Dashboard Data Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
}

/** Run dashboard-data.mjs against `repo` as MISSION_CONTROL_REPO_ROOT and parse its JSON stdout. */
function runDashboardData(repo: string): Record<string, unknown> {
  const out = execFileSync("node", [dashboardDataScript], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      MISSION_CONTROL_REPO_ROOT: repo,
      // Keep optional collectors from doing extra work on a scratch repo.
      AGENT_KIT_DASHBOARD_DATA_BUDGET_MS: "5000",
    },
  });
  return JSON.parse(out);
}

describe("dashboard-data.mjs: git status snapshot (Phase 0 - trim regression)", () => {
  it("reports an unstaged-only first row correctly instead of shifting it to staged", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-git-"));
    initGitRepo(repo);
    writeFileSync(join(repo, "unstaged-only.txt"), "v1\n");
    execFileSync("git", ["add", "unstaged-only.txt"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
    // Modify the tracked file without staging: `git status --short` for this
    // single-file repo now produces exactly one line, " M unstaged-only.txt" -
    // a leading status-column space on line 1 that a full-string .trim() would eat.
    writeFileSync(join(repo, "unstaged-only.txt"), "v2\n");

    const rawStatus = execFileSync("git", ["status", "--short"], { cwd: repo, encoding: "utf8" });
    expect(rawStatus).toBe(" M unstaged-only.txt\n");

    const snapshot = runDashboardData(repo) as { git: { files: Array<Record<string, unknown>> } };

    expect(snapshot.git.files).toHaveLength(1);
    expect(snapshot.git.files[0]).toMatchObject({
      path: "unstaged-only.txt",
      status: " M",
      staged: false,
      unstaged: true,
      untracked: false,
    });
  });

  it("keeps the first row's staged/unstaged read correct even with other rows following", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-git-multi-"));
    initGitRepo(repo);
    writeFileSync(join(repo, "unstaged-only.txt"), "v1\n");
    writeFileSync(join(repo, "staged-only.txt"), "v1\n");
    execFileSync("git", ["add", "unstaged-only.txt", "staged-only.txt"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
    writeFileSync(join(repo, "unstaged-only.txt"), "v2\n"); // unstaged modification
    writeFileSync(join(repo, "staged-only.txt"), "v2\n");
    execFileSync("git", ["add", "staged-only.txt"], { cwd: repo }); // staged modification

    const snapshot = runDashboardData(repo) as { git: { files: Array<Record<string, unknown>> } };
    const byPath = Object.fromEntries(snapshot.git.files.map((f) => [f.path, f]));

    expect(byPath["unstaged-only.txt"]).toMatchObject({
      status: " M",
      staged: false,
      unstaged: true,
    });
    expect(byPath["staged-only.txt"]).toMatchObject({
      status: "M ",
      staged: true,
      unstaged: false,
    });
  });
});

describe("dashboard-data.mjs: kitManaged resolution (Phase 1 - consumer fallback)", () => {
  function writeCommand(repo: string, file: string) {
    mkdirSync(join(repo, ".cursor", "commands"), { recursive: true });
    writeFileSync(join(repo, ".cursor", "commands", file), `# ${file}\n`);
  }

  it("falls back to .cursor/agent-kit.managed-hashes.json when registry/registry.json is absent", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-kitmanaged-"));
    initGitRepo(repo);
    writeCommand(repo, "run-plan.md");
    writeCommand(repo, "project-local.md");
    writeFileSync(
      join(repo, ".cursor", "agent-kit.managed-hashes.json"),
      JSON.stringify({
        schemaVersion: 1,
        hashes: { ".cursor/commands/run-plan.md": "deadbeef" },
      }),
    );
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });

    const snapshot = runDashboardData(repo) as {
      commands: Array<{ path: string; kitManaged: boolean }>;
    };
    const byPath = Object.fromEntries(snapshot.commands.map((c) => [c.path, c.kitManaged]));

    expect(byPath[".cursor/commands/run-plan.md"]).toBe(true);
    expect(byPath[".cursor/commands/project-local.md"]).toBe(false);
  });

  it("also honors .cursor/agent-kit.json's protected[] exact-path entries as a fallback source", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-kitmanaged-protected-"));
    initGitRepo(repo);
    writeCommand(repo, "hotfix.md");
    writeCommand(repo, "project-local.md");
    writeFileSync(
      join(repo, ".cursor", "agent-kit.json"),
      JSON.stringify({
        schemaVersion: 1,
        protected: [".cursor/commands/hotfix.md", ".cursor/plans/**"],
      }),
    );
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });

    const snapshot = runDashboardData(repo) as {
      commands: Array<{ path: string; kitManaged: boolean }>;
    };
    const byPath = Object.fromEntries(snapshot.commands.map((c) => [c.path, c.kitManaged]));

    expect(byPath[".cursor/commands/hotfix.md"]).toBe(true);
    expect(byPath[".cursor/commands/project-local.md"]).toBe(false);
  });

  it("stays registry-driven (factory behavior) when registry/registry.json is present and populated", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-kitmanaged-registry-"));
    initGitRepo(repo);
    writeCommand(repo, "run-plan.md");
    writeCommand(repo, "project-local.md");
    mkdirSync(join(repo, "registry"), { recursive: true });
    writeFileSync(
      join(repo, "registry", "registry.json"),
      JSON.stringify({
        artifacts: [{ kind: "command", path: ".cursor/commands/run-plan.md" }],
      }),
    );
    // A managed-hashes.json that (if wrongly consulted) would mark BOTH commands
    // kitManaged, proving the registry stays the sole source when it's populated.
    writeFileSync(
      join(repo, ".cursor", "agent-kit.managed-hashes.json"),
      JSON.stringify({
        schemaVersion: 1,
        hashes: {
          ".cursor/commands/run-plan.md": "deadbeef",
          ".cursor/commands/project-local.md": "deadbeef",
        },
      }),
    );
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });

    const snapshot = runDashboardData(repo) as {
      commands: Array<{ path: string; kitManaged: boolean }>;
    };
    const byPath = Object.fromEntries(snapshot.commands.map((c) => [c.path, c.kitManaged]));

    expect(byPath[".cursor/commands/run-plan.md"]).toBe(true);
    expect(byPath[".cursor/commands/project-local.md"]).toBe(false);
  });
});
