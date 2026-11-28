// Integration coverage for dashboard/dashboard-data.mjs run as a real subprocess
// against a scratch git repo. Unlike the "wiring" tests elsewhere in this
// directory (which grep dashboard-data.mjs's source text), these tests execute
// the script end-to-end so a regression in the git-status trim or the
// kitManaged registry/fallback resolution actually fails the suite.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/** Raw stdout of dashboard-data.mjs run against `repo` as MISSION_CONTROL_REPO_ROOT. */
function runDashboardDataRaw(repo: string, extraEnv: Record<string, string> = {}): string {
  return execFileSync("node", [dashboardDataScript], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: fakeHome,
      MISSION_CONTROL_REPO_ROOT: repo,
      // Keep optional collectors from doing extra work on a scratch repo.
      AGENT_KIT_DASHBOARD_DATA_BUDGET_MS: "5000",
      // Loopback unless a test opts into broadcast.
      HOST: "127.0.0.1",
      MISSION_CONTROL_TOKEN: "",
      ...extraEnv,
    },
  });
}

/** Run dashboard-data.mjs against `repo` as MISSION_CONTROL_REPO_ROOT and parse its JSON stdout. */
function runDashboardData(
  repo: string,
  extraEnv: Record<string, string> = {},
): Record<string, unknown> {
  return JSON.parse(runDashboardDataRaw(repo, extraEnv));
}

/** Seed one saved Claude Code chat for `repo` under the fake HOME. */
function seedChat(repo: string, id: string, title: string) {
  const dir = join(fakeHome, ".claude", "projects", repo.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(join(dir, id, "subagents"), { recursive: true });
  writeFileSync(
    join(dir, `${id}.jsonl`),
    `${JSON.stringify({ type: "user", message: { content: "hello" } })}\n${JSON.stringify({ type: "custom-title", customTitle: title })}\n`,
  );
  writeFileSync(join(dir, id, "subagents", "agent-1.jsonl"), "{}\n");
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

  it("a pending gate exit reaches gateExit and the Flight Log tickets lane (1.6.0)", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-gate-exit-"));
    initGitRepo(repo);
    execFileSync("git", ["checkout", "-q", "-b", "staging"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "x\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
    const stamp = "20261015T031500Z";
    execFileSync("git", ["checkout", "-q", "-b", `gate-exit/${stamp}`], { cwd: repo });
    mkdirSync(join(repo, ".cursor", "gate-exit"), { recursive: true });
    writeFileSync(
      join(repo, ".cursor", "gate-exit", `${stamp}.md`),
      `# Gate exit ${stamp}: unanswered gate backlog-write\n\nagent-inferred\n`,
    );
    execFileSync("git", ["add", ".cursor/gate-exit"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "gate exit"], { cwd: repo });
    execFileSync("git", ["checkout", "-q", "staging"], { cwd: repo });
    mkdirSync(join(repo, ".cursor", "context"), { recursive: true });
    writeFileSync(
      join(repo, ".cursor", "context", "gate-exit.json"),
      JSON.stringify({
        schema: 1,
        pending: [
          {
            stamp,
            openedAt: "2026-10-15T03:15:00.000Z",
            trigger: "gate",
            askId: "backlog-write",
            labels: ["Write plan to backlog", "Cancel"],
            base: "staging",
            branch: `gate-exit/${stamp}`,
            pushed: false,
            url: null,
          },
        ],
        skipped: ["skipped 20261015T040000Z"],
      }),
    );

    const snap = runDashboardData(repo);
    expect(schemaErrors(schema, snap)).toEqual([]);
    const gateExit = snap.gateExit as { marker: string; tickets: Record<string, unknown>[] };
    expect(gateExit.marker).toBe("ok");
    expect(gateExit.tickets).toHaveLength(1);
    expect(gateExit.tickets[0]).toMatchObject({
      stamp,
      askId: "backlog-write",
      branch: `gate-exit/${stamp}`,
      branchState: "unmerged",
      inMarker: true,
      headline: `# Gate exit ${stamp}: unanswered gate backlog-write`,
    });
    const flightLog = (snap.missionControl as { flightLog: { tickets: Record<string, unknown>[] } })
      .flightLog;
    expect(flightLog.tickets).toHaveLength(1);
    expect(flightLog.tickets[0]).toMatchObject({
      id: `flight-log-ticket:${stamp}`,
      text: `Gate exit ${stamp}: unanswered gate backlog-write`,
      branchState: "unmerged",
    });
  });

  it("lists the workspace's saved chats in `chats` and matches the schema (1.7.0)", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-chats-"));
    initGitRepo(repo);
    const id = "33333333-3333-4333-8333-333333333333";
    seedChat(repo, id, "chat <b>title</b>");

    const snap = runDashboardData(repo);
    expect(schemaErrors(schema, snap)).toEqual([]);
    const chats = snap.chats as {
      withheld: boolean;
      vendors: {
        vendor: string;
        status: string;
        sessions: Record<string, unknown>[];
        total: number;
      }[];
    };
    expect(chats.withheld).toBe(false);
    expect(chats.vendors.map((v) => [v.vendor, v.status, v.total])).toEqual([
      ["claude", "ok", 1],
      ["codex", "unsupported", 0],
      ["cursor", "unsupported", 0],
    ]);
    expect(chats.vendors[0].sessions[0]).toMatchObject({
      id,
      title: "chat <b>title</b>",
      titleSource: "custom",
    });
  });

  it("withholds chats when the snapshot is generated for a broadcast server", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-chats-bc-"));
    initGitRepo(repo);
    const id = "44444444-4444-4444-8444-444444444444";
    const sentinel = "broadcast-sentinel-title-91c2";
    seedChat(repo, id, sentinel);

    const raw = runDashboardDataRaw(repo, {
      HOST: "0.0.0.0",
      MISSION_CONTROL_TOKEN: "t".repeat(24),
    });
    expect(raw).not.toContain(sentinel);
    expect(raw).not.toContain(id);
    const snap = JSON.parse(raw);
    expect(snap.chats).toEqual({ withheld: true, vendors: [] });
    expect(schemaErrors(schema, snap)).toEqual([]);
  });

  it("folds the outcome ledger from plans, tags and test results, idempotently (1.9.0)", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-outcome-"));
    initGitRepo(repo);
    writeFileSync(join(repo, "README.md"), "x\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    const ledgerPath = join(repo, ".cursor", "context", "outcome-ledger.json");

    // Fresh install: a valid empty field and no ledger file left behind.
    const fresh = runDashboardData(repo);
    expect(schemaErrors(schema, fresh)).toEqual([]);
    const freshLedger = fresh.outcomeLedger as { entries: number; totals: Record<string, number> };
    expect(freshLedger.entries).toBe(0);
    expect(freshLedger.totals).toEqual({ logic: 0, compute: 0, rare: 0 });
    expect(existsSync(ledgerPath)).toBe(false);

    execFileSync("git", ["tag", "v1.0.0"], { cwd: repo });

    mkdirSync(join(repo, ".cursor", "plans"), { recursive: true });
    writeFileSync(
      join(repo, ".cursor", "plans", "demo.plan.md"),
      '---\nname: "Demo"\ntodos:\n  - id: one\n    content: "First"\n    status: completed\n  - id: two\n    content: "Second"\n    status: completed\n---\n\n# Demo\n',
    );
    mkdirSync(join(repo, ".cursor", "context"), { recursive: true });
    writeFileSync(
      join(repo, ".cursor", "context", "test-results.json"),
      JSON.stringify({
        version: 1,
        runs: [
          { at: "2026-10-24T10:00:00.000Z", ok: false, exitCode: 1, head, commands: ["t"] },
          { at: "2026-10-24T10:05:00.000Z", ok: true, exitCode: 0, head, commands: ["t"] },
          { at: "2026-10-24T10:06:00.000Z", ok: true, exitCode: 0, head, commands: ["t"] },
        ],
      }),
    );

    const snap = runDashboardData(repo);
    expect(schemaErrors(schema, snap)).toEqual([]);
    const ledger = snap.outcomeLedger as {
      available: boolean;
      totals: Record<string, number>;
      byKind: Record<string, number>;
      tests: { configured: boolean; lastRun: { ok: boolean } | null };
    };
    expect(ledger.available).toBe(true);
    expect(ledger.byKind).toMatchObject({ todo: 2, test: 1, releaseCut: 1, plan: 1 });
    expect(ledger.totals).toEqual({ logic: 3, compute: 1, rare: 1 });
    expect(ledger.tests).toEqual({
      configured: false,
      lastRun: { at: "2026-10-24T10:06:00.000Z", ok: true, head },
    });
    const first = readFileSync(ledgerPath, "utf8");

    // Re-open a to-do: nothing is taken back and nothing new is earned.
    writeFileSync(
      join(repo, ".cursor", "plans", "demo.plan.md"),
      '---\nname: "Demo"\ntodos:\n  - id: one\n    content: "First"\n    status: pending\n  - id: two\n    content: "Second"\n    status: completed\n---\n',
    );
    const again = runDashboardData(repo);
    expect((again.outcomeLedger as { totals: Record<string, number> }).totals).toEqual(
      ledger.totals,
    );
    expect(readFileSync(ledgerPath, "utf8")).toBe(first);
  });

  it("lists rules and a decision index for a host's Workspace view and matches the schema (1.10.0)", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-workspace-docs-"));
    initGitRepo(repo);
    mkdirSync(join(repo, ".cursor", "rules"), { recursive: true });
    writeFileSync(
      join(repo, ".cursor", "rules", "hygiene.mdc"),
      "---\ndescription: Output hygiene\nalwaysApply: true\n---\n# Hygiene\n",
    );
    const decisions = join(repo, ".cursor", "memory", "decisions");
    mkdirSync(decisions, { recursive: true });
    writeFileSync(join(decisions, "_index.md"), "# Decisions index\n");
    writeFileSync(
      join(decisions, "2026-10-28_rail.md"),
      "# Rail\n\n- **Date:** 2026-10-28\n- **Status:** Accepted\n- **Tags:** colony, rail\n",
    );

    const snap = runDashboardData(repo);
    expect(schemaErrors(schema, snap)).toEqual([]);
    expect(snap.rules).toEqual([
      expect.objectContaining({
        id: "hygiene",
        path: ".cursor/rules/hygiene.mdc",
        description: "Output hygiene",
        alwaysApply: true,
        kitManaged: false,
      }),
    ]);
    const memory = snap.memory as {
      decisionIndex: { id: string; status: string; tags: string[] }[];
    };
    expect(memory.decisionIndex).toEqual([
      expect.objectContaining({
        id: "2026-10-28_rail",
        status: "accepted",
        tags: ["colony", "rail"],
      }),
    ]);
  });

  it("ships to-do evidence refs, never the evidence prose (1.12.0)", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-evidence-"));
    initGitRepo(repo);
    mkdirSync(join(repo, ".cursor", "plans"), { recursive: true });
    const prose = "evidence-prose-sentinel-7d1f";
    writeFileSync(
      join(repo, ".cursor", "plans", "demo.plan.md"),
      [
        "---",
        'name: "Demo"',
        "todos:",
        "  - id: one",
        '    content: "First"',
        "    status: completed",
        `    evidence: "agent-kit-dev#1484 merged c01a6978. ${prose}"`,
        "  - id: two",
        '    content: "Second"',
        "    status: pending",
        "---",
        "",
      ].join("\n"),
    );
    const raw = runDashboardDataRaw(repo);
    expect(raw).not.toContain(prose);
    const snap = JSON.parse(raw);
    expect(schemaErrors(schema, snap)).toEqual([]);
    const items = (snap.plans as { todos: { items: Record<string, unknown>[] } }[])[0].todos.items;
    expect(items[0].evidenceRefs).toEqual({
      prs: [{ repo: "agent-kit-dev", number: 1484 }],
      shas: ["c01a6978"],
      structured: true,
    });
    expect(items[1].evidenceRefs).toBeUndefined();
  });

  it("an operator verdict row takes the plan out of the cadence warning", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-verdict-"));
    initGitRepo(repo);
    mkdirSync(join(repo, ".cursor", "plans"), { recursive: true });
    mkdirSync(join(repo, ".cursor", "context"), { recursive: true });
    for (const name of ["kept", "gone"]) {
      writeFileSync(
        join(repo, ".cursor", "plans", `${name}.plan.md`),
        [
          "---",
          `name: "${name}"`,
          "todos:",
          "  - id: one",
          '    content: "First"',
          "    status: completed",
          "---",
          "",
        ].join("\n"),
      );
    }
    writeFileSync(
      join(repo, ".cursor", "context", "field-report-cadence.json"),
      JSON.stringify({
        version: 1,
        ticksSinceClear: 3,
        activeWarningId: "attention:cadence:w-test",
        windowId: "w-test",
        pendingPlanFiles: ["gone.plan.md", "kept.plan.md"],
      }),
    );
    const cadencePlans = () => {
      const snap = JSON.parse(runDashboardDataRaw(repo));
      expect(schemaErrors(schema, snap)).toEqual([]);
      const attention = (
        snap.missionControl as {
          attention: { kind: string; planEvidence?: { planFile: string }[] }[];
        }
      ).attention;
      return (attention.find((a) => a.kind === "cadence")?.planEvidence ?? [])
        .map((e) => e.planFile)
        .sort();
    };
    expect(cadencePlans()).toEqual(["gone.plan.md", "kept.plan.md"]);
    writeFileSync(
      join(repo, ".cursor", "context", "field-report-plan-verdicts.json"),
      JSON.stringify({
        verdicts: [
          {
            plan: "gone.plan.md",
            verdict: "delivered-nothing",
            at: "2026-11-23T12:00:00.000Z",
            ask: "HITL_REPLY: plan-verdict | operator reply 1 | Delivered nothing",
          },
        ],
      }),
    );
    expect(cadencePlans()).toEqual(["kept.plan.md"]);
  });

  it("every top-level field the snapshot documents in _schema.fields is required by the contract", () => {
    const source = readFileSync(dashboardDataScript, "utf8");
    const fieldsBlock = /fields: \{([\s\S]*?)\n {4}\},\n {2}\},/.exec(source)?.[1] ?? "";
    const fieldNames = [...fieldsBlock.matchAll(/^ {6}([a-zA-Z]+):/gm)].map((m) => m[1]);
    expect(fieldNames.length).toBeGreaterThan(10);
    for (const name of fieldNames) expect(schema.required).toContain(name);
  });
});

// ── Health first run (ADR 2026-07-29 mc-health-healthcenter, Amend 2026-11-19) ──
type HealthCheck = { id: string; ok: boolean; severity: string; detail: string };
type HealthSnapshot = { health: { status: string; checks: HealthCheck[] } };

/** Per-test HOME so a seeded plugin never leaks into other snapshot tests. */
function scratchHome(): string {
  return mkdtempSync(join(tmpdir(), "ak-dashdata-health-home-"));
}

/** A Mission Kit Cursor local plugin under `home` with two commands. */
function seedCursorPlugin(home: string) {
  const root = join(home, ".cursor", "plugins", "local", "agent-kit");
  mkdirSync(join(root, ".cursor-plugin"), { recursive: true });
  mkdirSync(join(root, ".cursor", "commands"), { recursive: true });
  writeFileSync(
    join(root, ".cursor-plugin", "plugin.json"),
    JSON.stringify({ name: "agent-kit", version: "6.18.0", commands: ".cursor/commands" }),
  );
  writeFileSync(join(root, ".cursor", "commands", "run-plan.md"), "# /run-plan\n");
  writeFileSync(join(root, ".cursor", "commands", "start-project.md"), "# /start-project\n");
}

function healthById(snap: HealthSnapshot): Record<string, HealthCheck> {
  return Object.fromEntries(snap.health.checks.map((c) => [c.id, c]));
}

describe("dashboard-data.mjs: Health first run (Amend 2026-11-19)", SUBPROCESS_TIMEOUT, () => {
  it("plugin-installed fresh workspace: Commands ok, Git warning, aggregate not-initialized, nothing degraded", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-health-fresh-"));
    initGitRepo(repo);
    const home = scratchHome();
    seedCursorPlugin(home);
    const snap = runDashboardData(repo, { HOME: home }) as unknown as HealthSnapshot;
    const by = healthById(snap);
    expect(snap.health.checks.map((c) => c.id)).toEqual([
      "plans",
      "handoff",
      "agents",
      "commands",
      "memory",
      "git",
      "config",
    ]);
    expect(snap.health.status).toBe("not-initialized");
    expect(snap.health.checks.filter((c) => c.severity === "degraded")).toEqual([]);
    for (const id of ["plans", "handoff", "memory"]) {
      expect(by[id].severity).toBe("not-initialized");
      expect(by[id].ok).toBe(false);
    }
    expect(by.commands).toMatchObject({ ok: true, severity: "ok" });
    expect(by.commands.detail).toContain("2 commands from the Cursor plugin agent-kit 6.18.0");
    expect(by.commands.detail).toContain("~/.cursor/plugins/local/agent-kit");
    expect(by.commands.detail).not.toContain(home);
    expect(by.git.severity).toBe("warning");
    expect(by.git.detail).toMatch(/^No commits on /);
    expect(by.config).toMatchObject({ ok: true, severity: "ok" });
    expect(by.config.detail).toContain("Defaults (no config.json)");
    expect(by.agents).toMatchObject({ ok: true, severity: "ok" });
    for (const c of snap.health.checks) expect(c.ok).toBe(c.severity === "ok");
  });

  it("broadcast snapshot names the plugin source kind without paths", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-health-bcast-"));
    initGitRepo(repo);
    const home = scratchHome();
    seedCursorPlugin(home);
    const snap = runDashboardData(repo, {
      HOME: home,
      HOST: "0.0.0.0",
      MISSION_CONTROL_TOKEN: "h".repeat(32),
    }) as unknown as HealthSnapshot;
    const commands = healthById(snap).commands;
    expect(commands.severity).toBe("ok");
    expect(commands.detail).toContain("the Cursor plugin agent-kit 6.18.0");
    expect(commands.detail).not.toContain("~/");
    expect(commands.detail).not.toContain(home);
  });

  it("empty repository with a kit install: Git warning 'no commits', not degraded", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-health-empty-"));
    initGitRepo(repo);
    mkdirSync(join(repo, ".cursor", "commands"), { recursive: true });
    writeFileSync(join(repo, ".cursor", "commands", "run-plan.md"), "# /run-plan\n");
    mkdirSync(join(repo, ".cursor", "plans"), { recursive: true });
    writeFileSync(
      join(repo, ".cursor", "plans", "first.plan.md"),
      "---\nname: First\ntodos: []\n---\n",
    );
    const snap = runDashboardData(repo, { HOME: scratchHome() }) as unknown as HealthSnapshot;
    const by = healthById(snap);
    expect(by.git.severity).toBe("warning");
    expect(by.git.detail).toMatch(/^No commits on /);
    expect(by.plans.severity).toBe("ok");
    expect(by.commands.severity).toBe("ok");
    // Not fresh (a plan exists): a missing HANDOFF reports on its own.
    expect(by.handoff.severity).toBe("warning");
    expect(snap.health.status).toBe("warning");
  });

  it("fresh workspace with no kit and no plugin: Commands degraded, aggregate degraded", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-health-bare-"));
    initGitRepo(repo);
    const snap = runDashboardData(repo, { HOME: scratchHome() }) as unknown as HealthSnapshot;
    const by = healthById(snap);
    expect(by.commands.severity).toBe("degraded");
    expect(by.plans.severity).toBe("not-initialized");
    expect(snap.health.status).toBe("degraded");
  });

  it("config: unparseable config.json is degraded; agents without frontmatter are a warning", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-health-config-"));
    initGitRepo(repo);
    mkdirSync(join(repo, ".cursor", "context"), { recursive: true });
    writeFileSync(join(repo, ".cursor", "context", "config.json"), "{ not json");
    mkdirSync(join(repo, ".cursor", "agents"), { recursive: true });
    writeFileSync(
      join(repo, ".cursor", "agents", "good.md"),
      "---\nname: good\ndescription: Does things.\n---\nBody\n",
    );
    writeFileSync(join(repo, ".cursor", "agents", "bare.md"), "# No frontmatter\n");
    const snap = runDashboardData(repo, { HOME: scratchHome() }) as unknown as HealthSnapshot;
    const by = healthById(snap);
    expect(by.config.severity).toBe("degraded");
    expect(by.agents.severity).toBe("warning");
    expect(by.agents.detail).toContain(".cursor/agents/bare.md");
    expect(by.agents.detail).not.toContain("good.md");
  });
});

// ── Install health (plan cli-install-update-overhaul c2): doctor writes, Health reads ──
type InstallSnapshot = {
  health: {
    status: string;
    checks: HealthCheck[];
    install: null | {
      generatedAt: string | null;
      status: string;
      checks: Array<HealthCheck & { fix: string | null }>;
    };
  };
};

function seedInstallHealth(repo: string) {
  mkdirSync(join(repo, ".cursor", "context"), { recursive: true });
  writeFileSync(
    join(repo, ".cursor", "context", "install-health.json"),
    JSON.stringify({
      version: 1,
      generatedAt: "2026-11-26T10:00:00.000Z",
      status: "warning",
      checks: [
        {
          id: "global-cli",
          label: "Global CLI vs npm latest",
          severity: "info",
          detail: "v6.22.1 at /usr/local/bin/agent-kit; npm registry did not answer, not compared",
          fix: null,
          fixKind: null,
        },
        {
          id: "node-manager",
          label: "Node version manager",
          severity: "warning",
          detail:
            "~/.local/share/mise/installs/node/26.8.2/bin/agent-kit lives in mise node 26.8.2",
          fix: '"npm:@dadado/agent-kit-cli" = { version = "latest", allow_low_downloads = true, minimum_release_age = "0s" }',
          fixKind: "config-line",
        },
        {
          id: "registry-pin",
          label: "Registry pin",
          severity: "warning",
          detail: "registry.ref v5.4.0 in .cursor/agent-kit.json is older than v5.9.0",
          fix: "agent-kit update --ref v5.9.0",
          fixKind: "command",
        },
        { id: "unknown-id", label: "x", severity: "warning", detail: "dropped", fix: null },
      ],
    }),
  );
}

describe("dashboard-data.mjs: Health install group (c2)", SUBPROCESS_TIMEOUT, () => {
  it("absent install-health.json: install is null and the seven checks are unchanged", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-install-absent-"));
    initGitRepo(repo);
    const snap = runDashboardData(repo, { HOME: scratchHome() }) as unknown as InstallSnapshot;
    expect(snap.health.install).toBeNull();
    expect(snap.health.checks).toHaveLength(7);
  });

  it("loopback: reads doctor's file, keeps it outside checks[] and status, command fixes only", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-install-loop-"));
    initGitRepo(repo);
    seedInstallHealth(repo);
    const snap = runDashboardData(repo, { HOME: scratchHome() }) as unknown as InstallSnapshot;
    expect(snap.health.checks.map((c) => c.id)).not.toContain("node-manager");
    const install = snap.health.install;
    expect(install?.status).toBe("warning");
    expect(install?.generatedAt).toBe("2026-11-26T10:00:00.000Z");
    expect(install?.checks.map((c) => c.id)).toEqual([
      "global-cli",
      "node-manager",
      "registry-pin",
    ]);
    const by = Object.fromEntries((install?.checks ?? []).map((c) => [c.id, c]));
    expect(by["global-cli"]).toMatchObject({ ok: true, severity: "ok", fix: null });
    expect(by["node-manager"]).toMatchObject({ ok: false, severity: "warning", fix: null });
    expect(by["node-manager"].detail).toContain("~/.local/share/mise/installs/node/26.8.2");
    // The mise tool entry is a config line, not a terminal command: it rides in the detail.
    expect(by["node-manager"].detail).toContain(
      '(add: "npm:@dadado/agent-kit-cli" = { version = "latest", allow_low_downloads = true, minimum_release_age = "0s" })',
    );
    expect(by["registry-pin"].fix).toBe("agent-kit update --ref v5.9.0");
  });

  it("broadcast: no paths and no fix leave the machine", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-install-bcast-"));
    initGitRepo(repo);
    seedInstallHealth(repo);
    const snap = runDashboardData(repo, {
      HOME: scratchHome(),
      HOST: "0.0.0.0",
      MISSION_CONTROL_TOKEN: "h".repeat(32),
    }) as unknown as InstallSnapshot;
    const raw = JSON.stringify(snap.health.install);
    expect(raw).not.toContain("~/");
    expect(raw).not.toContain("/usr/local/bin");
    expect(snap.health.install?.checks.every((c) => c.fix === null)).toBe(true);
  });
});

type UpdateNoticeSnapshot = {
  health: {
    checks: HealthCheck[];
    updateNotice: null | {
      cliVersion: string | null;
      npmLatest: string | null;
      cliBehind: boolean;
      installsBehind: number;
      oldest: { kitVersion: string; path: string | null } | null;
      label: string;
      severity: string;
      detail: string;
      fix: string | null;
    };
  };
};

/** Seed the machine notice cache the sessionStart hook writes; returns the env that points at it. */
function seedUpdateNotice(notice: Record<string, unknown> | null): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "ak-dashdata-notice-"));
  writeFileSync(
    join(dir, "update-notice.json"),
    JSON.stringify({
      schemaVersion: 1,
      checkedAt: "2026-11-26T10:00:00.000Z",
      npm: { packageName: "@dadado/agent-kit-cli", version: "6.22.0" },
      notice,
    }),
  );
  return {
    AGENT_KIT_INSTALLS_FILE: join(dir, "installs.json"),
    CI: "",
    AGENT_KIT_NO_UPDATE_CHECK: "",
    NO_UPDATE_NOTIFIER: "",
  };
}

const BEHIND_NOTICE = {
  generatedAt: "2026-11-26T10:00:00.000Z",
  cliVersion: "6.19.1",
  npmLatest: { packageName: "@dadado/agent-kit-cli", version: "6.22.0" },
  cliBehind: true,
  installsBehind: 9,
  oldest: { path: "~/x", kitVersion: "3.0.0" },
  cliCommand: "npm i -g @dadado/agent-kit-cli@latest",
  line: "Agent Kit: CLI 6.19.1 < npm 6.22.0 (`npm i -g @dadado/agent-kit-cli@latest`); 9 installs behind, oldest v3.0.0 at ~/x (`agent-kit update --all`).",
};

describe("dashboard-data.mjs: update notice card (c4)", SUBPROCESS_TIMEOUT, () => {
  it("loopback: one card with the count, the oldest install and the CLI command first", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-notice-loop-"));
    initGitRepo(repo);
    const snap = runDashboardData(repo, {
      HOME: scratchHome(),
      ...seedUpdateNotice(BEHIND_NOTICE),
    }) as unknown as UpdateNoticeSnapshot;
    expect(snap.health.checks).toHaveLength(7);
    expect(snap.health.updateNotice).toMatchObject({
      cliVersion: "6.19.1",
      npmLatest: "6.22.0",
      cliBehind: true,
      installsBehind: 9,
      oldest: { kitVersion: "3.0.0", path: "~/x" },
      label: "9 installs behind",
      severity: "warning",
      fix: "npm i -g @dadado/agent-kit-cli@latest",
    });
    expect(snap.health.updateNotice?.detail).toBe(
      "CLI 6.19.1 is behind npm 6.22.0; 9 installs behind CLI 6.19.1, oldest v3.0.0 at ~/x. Check-only: nothing is applied.",
    );
  });

  it("installs only: the fix is update --all", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-notice-inst-"));
    initGitRepo(repo);
    const snap = runDashboardData(repo, {
      HOME: scratchHome(),
      ...seedUpdateNotice({
        ...BEHIND_NOTICE,
        cliBehind: false,
        cliCommand: null,
        installsBehind: 1,
      }),
    }) as unknown as UpdateNoticeSnapshot;
    expect(snap.health.updateNotice).toMatchObject({
      label: "1 install behind",
      fix: "agent-kit update --all",
    });
  });

  it("broadcast: no path and no fix leave the machine", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-notice-bcast-"));
    initGitRepo(repo);
    const snap = runDashboardData(repo, {
      HOME: scratchHome(),
      HOST: "0.0.0.0",
      MISSION_CONTROL_TOKEN: "h".repeat(32),
      ...seedUpdateNotice(BEHIND_NOTICE),
    }) as unknown as UpdateNoticeSnapshot;
    const raw = JSON.stringify(snap.health.updateNotice);
    expect(raw).not.toContain("~/");
    expect(snap.health.updateNotice?.oldest).toEqual({ kitVersion: "3.0.0", path: null });
    expect(snap.health.updateNotice?.fix).toBeNull();
  });

  it("null when current, absent, under CI, with the env opt-out or updateCheck.enabled false", () => {
    const repo = mkdtempSync(join(tmpdir(), "ak-dashdata-notice-off-"));
    initGitRepo(repo);
    const home = scratchHome();
    const run = (env: Record<string, string>) =>
      (runDashboardData(repo, { HOME: home, ...env }) as unknown as UpdateNoticeSnapshot).health
        .updateNotice;
    expect(run(seedUpdateNotice(null))).toBeNull();
    const behind = seedUpdateNotice(BEHIND_NOTICE);
    expect(
      run({ ...behind, AGENT_KIT_INSTALLS_FILE: join(home, "nowhere", "installs.json") }),
    ).toBeNull();
    expect(run({ ...behind, CI: "true" })).toBeNull();
    expect(run({ ...behind, AGENT_KIT_NO_UPDATE_CHECK: "1" })).toBeNull();
    expect(run({ ...behind, NO_UPDATE_NOTIFIER: "1" })).toBeNull();
    mkdirSync(join(repo, ".cursor", "context"), { recursive: true });
    writeFileSync(
      join(repo, ".cursor", "context", "config.json"),
      JSON.stringify({ updateCheck: { enabled: false } }),
    );
    expect(run(behind)).toBeNull();
  });
});
