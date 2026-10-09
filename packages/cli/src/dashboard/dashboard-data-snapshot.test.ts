// Integration coverage for dashboard/dashboard-data.mjs run as a real subprocess
// against a scratch git repo. Unlike the "wiring" tests elsewhere in this
// directory (which grep dashboard-data.mjs's source text), these tests execute
// the script end-to-end so a regression in the git-status trim or the
// kitManaged registry/fallback resolution actually fails the suite.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dashboardDataScript = resolve(repoRoot, "dashboard/dashboard-data.mjs");
/** Isolated HOME so terminal / transcript collectors never scan the operator's ~/.cursor. */
const fakeHome = mkdtempSync(join(tmpdir(), "ak-dashdata-home-"));
/** Real subprocess + scratch repo per test; slow on a loaded host. */
const SUBPROCESS_TIMEOUT = { timeout: 20000 };

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
      HOME: fakeHome,
      MISSION_CONTROL_REPO_ROOT: repo,
      // Keep optional collectors from doing extra work on a scratch repo.
      AGENT_KIT_DASHBOARD_DATA_BUDGET_MS: "5000",
    },
  });
  return JSON.parse(out);
}

describe(
  "dashboard-data.mjs: git status snapshot (Phase 0 - trim regression)",
  SUBPROCESS_TIMEOUT,
  () => {
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

      const snapshot = runDashboardData(repo) as {
        git: {
          files: Array<Record<string, unknown>>;
          lastCommit: string;
          ahead: number;
          behind: number;
        };
      };

      expect(snapshot.git.files).toHaveLength(1);
      // Derived from recentLog[0] / flow.vsMain (no origin/main here, so 0/0).
      expect(snapshot.git.lastCommit).toMatch(/^[0-9a-f]{7,} init$/);
      expect(snapshot.git.ahead).toBe(0);
      expect(snapshot.git.behind).toBe(0);
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
  },
);

describe(
  "dashboard-data.mjs: kitManaged resolution (Phase 1 - consumer fallback)",
  SUBPROCESS_TIMEOUT,
  () => {
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
  },
);

// ── Versioned snapshot contract (docs/contracts/mission-control-snapshot.schema.json) ──

type SchemaNode = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  enum?: unknown[];
  const?: unknown;
};

function jsonType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v === "number" ? "number" : typeof v;
}

/** Minimal checker for the keywords the contract uses (type, required, properties, items, enum, const). */
function schemaErrors(node: SchemaNode, value: unknown, at = "$"): string[] {
  const errors: string[] = [];
  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.includes(jsonType(value)))
      errors.push(`${at}: ${jsonType(value)} is not ${types.join("|")}`);
  }
  if (node.enum && !node.enum.includes(value)) errors.push(`${at}: ${String(value)} not in enum`);
  if ("const" in node && node.const !== value)
    errors.push(`${at}: ${String(value)} !== ${String(node.const)}`);
  if (jsonType(value) === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of node.required ?? []) if (!(key in obj)) errors.push(`${at}.${key}: missing`);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      if (key in obj) errors.push(...schemaErrors(child, obj[key], `${at}.${key}`));
    }
  }
  if (jsonType(value) === "array" && node.items) {
    (value as unknown[]).forEach((item, i) => {
      errors.push(...schemaErrors(node.items as SchemaNode, item, `${at}[${i}]`));
    });
  }
  return errors;
}

describe("dashboard-data.mjs: versioned snapshot contract", SUBPROCESS_TIMEOUT, () => {
  const schema = JSON.parse(
    readFileSync(resolve(repoRoot, "docs/contracts/mission-control-snapshot.schema.json"), "utf8"),
  ) as SchemaNode & { version: string };

  it("the snapshot of a scratch repo with a headless tick log matches the schema of its version", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-contract-"));
    initGitRepo(repo);
    writeFileSync(join(repo, "README.md"), "x\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
    const logs = join(repo, ".cursor", "loop-logs");
    mkdirSync(logs, { recursive: true });
    writeFileSync(
      join(logs, "tick-20261008-120000000.log"),
      readFileSync(
        resolve(
          repoRoot,
          "packages/cli/src/plan-loop/fixtures/claude-stream-run-plan-all-queue-drift.log",
        ),
        "utf8",
      ),
    );

    const snap = runDashboardData(repo);
    expect(snap.dashboardDataVersion).toBe(schema.version);
    expect((snap._schema as { version: string }).version).toBe(schema.version);
    expect(schemaErrors(schema, snap)).toEqual([]);
    const rows = snap.runLogs as { id: string; source: string; format: string }[];
    expect(rows.map((r) => [r.id, r.source, r.format])).toEqual([
      ["tick-20261008-120000000.log", "loop-logs", "stream-json"],
    ]);
  });

  it("every top-level field the snapshot documents in _schema.fields is required by the contract", () => {
    const source = readFileSync(dashboardDataScript, "utf8");
    const fieldsBlock = /fields: \{([\s\S]*?)\n {4}\},\n {2}\},/.exec(source)?.[1] ?? "";
    const fieldNames = [...fieldsBlock.matchAll(/^ {6}([a-zA-Z]+):/gm)].map((m) => m[1]);
    expect(fieldNames.length).toBeGreaterThan(10);
    for (const name of fieldNames) expect(schema.required).toContain(name);
  });
});
