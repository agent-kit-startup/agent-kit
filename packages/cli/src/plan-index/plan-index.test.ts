import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_PLANS_SCAN_GLOB,
  HANDOFF_REL,
  PLAN_INDEX_REL,
  type PlanIndexIo,
  buildPlanIndex,
  collectNamedPlanBasenames,
  extractHandoffNamedPlans,
  formatPlanIndexSection,
  namedPlanCandidatePaths,
  writePlanIndex,
} from "./plan-index.js";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const SAMPLE_HANDOFF = [
  "# Handoff",
  "",
  "- **Plan:** `active.plan.md`",
  "- **Backlog plans:**",
  "  - `backlog-open.plan.md`",
  "  - `backlog-exhausted.plan.md`",
  "- **Parked plans:**",
  "  - `parked.plan.md`",
  "- **Run queue:** [active.plan.md, queue-only-open.plan.md, queue-only-done.plan.md]",
  "",
].join("\n");

function planFile(name: string, todos: { id: string; status: string }[]): string {
  const items = todos
    .map((t) => `  - id: ${t.id}\n    content: ${t.id}\n    status: ${t.status}`)
    .join("\n");
  return `---\nname: ${name}\ntodos:\n${items}\n---\n\n# ${name}\n`;
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ak-plan-index-"));
  await mkdir(path.join(root, ".cursor", "plans", "archive"), { recursive: true });
  await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
  return root;
}

describe("extractHandoffNamedPlans", () => {
  it("reads Plan, Backlog, Parked, and Run queue machine fields", () => {
    const named = extractHandoffNamedPlans(SAMPLE_HANDOFF);
    expect(named.active).toBe("active.plan.md");
    expect(named.backlog).toEqual(["backlog-open.plan.md", "backlog-exhausted.plan.md"]);
    expect(named.parked).toEqual(["parked.plan.md"]);
    expect(named.runQueue).toEqual([
      "active.plan.md",
      "queue-only-open.plan.md",
      "queue-only-done.plan.md",
    ]);
    expect(collectNamedPlanBasenames(named)).toEqual([
      "active.plan.md",
      "backlog-open.plan.md",
      "backlog-exhausted.plan.md",
      "parked.plan.md",
      "queue-only-open.plan.md",
      "queue-only-done.plan.md",
    ]);
  });

  it("treats Plan none as no active file", () => {
    expect(extractHandoffNamedPlans("- **Plan:** none\n").active).toBeNull();
  });
});

describe("buildPlanIndex", () => {
  it("indexes HANDOFF-named roles and skips a cemetery file that is not named", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, ".cursor", "HANDOFF.md"), SAMPLE_HANDOFF, "utf8");
    const plansDir = path.join(root, ".cursor", "plans");
    await writeFile(
      path.join(plansDir, "active.plan.md"),
      planFile("Active", [{ id: "a1", status: "pending" }]),
      "utf8",
    );
    await writeFile(
      path.join(plansDir, "backlog-open.plan.md"),
      planFile("Backlog open", [{ id: "b1", status: "in_progress" }]),
      "utf8",
    );
    await writeFile(
      path.join(plansDir, "backlog-exhausted.plan.md"),
      planFile("Backlog done", [{ id: "b2", status: "completed" }]),
      "utf8",
    );
    await writeFile(
      path.join(plansDir, "parked.plan.md"),
      planFile("Parked", [{ id: "p1", status: "pending" }]),
      "utf8",
    );
    await writeFile(
      path.join(plansDir, "queue-only-open.plan.md"),
      planFile("Queue open", [{ id: "q1", status: "pending" }]),
      "utf8",
    );
    await writeFile(
      path.join(plansDir, "queue-only-done.plan.md"),
      planFile("Queue done", [{ id: "q2", status: "completed" }]),
      "utf8",
    );
    await writeFile(
      path.join(plansDir, "cemetery.plan.md"),
      planFile("Cemetery", [{ id: "c1", status: "pending" }]),
      "utf8",
    );

    const index = await buildPlanIndex(root, undefined, () => new Date("2026-09-10T14:00:00.000Z"));
    const files = index.plans.map((p) => p.file);
    expect(files).toEqual([
      "active.plan.md",
      "backlog-open.plan.md",
      "backlog-exhausted.plan.md",
      "parked.plan.md",
      "queue-only-open.plan.md",
    ]);
    expect(files).not.toContain("cemetery.plan.md");
    expect(index.source).toBe("handoff-named");
    expect(index.plans.find((p) => p.file === "active.plan.md")?.role).toBe("active");
    expect(index.plans.find((p) => p.file === "backlog-open.plan.md")?.role).toBe("backlog");
    expect(index.plans.find((p) => p.file === "backlog-exhausted.plan.md")).toMatchObject({
      role: "backlog",
      openTodos: false,
    });
    expect(index.plans.find((p) => p.file === "parked.plan.md")?.role).toBe("parked");
    expect(index.plans.find((p) => p.file === "queue-only-open.plan.md")).toMatchObject({
      role: "pending",
      openTodos: true,
      pendingTodoIds: ["q1"],
    });
    expect(formatPlanIndexSection(index)).toContain("## Pending plans (index)");
  });

  it("reads only named candidate paths and never a directory listing", async () => {
    const root = "/tmp/ak-plan-index-io";
    const named = [
      "active.plan.md",
      "backlog-open.plan.md",
      "backlog-exhausted.plan.md",
      "parked.plan.md",
      "queue-only-open.plan.md",
      "queue-only-done.plan.md",
    ];
    const allowed = new Set<string>([
      path.join(root, ".cursor", "HANDOFF.md"),
      ...named.flatMap((file) => namedPlanCandidatePaths(root, file)),
    ]);
    const reads: string[] = [];
    const io: PlanIndexIo = {
      async readFile(absPath) {
        reads.push(absPath);
        expect(allowed.has(absPath), `unexpected read: ${absPath}`).toBe(true);
        if (absPath.endsWith("HANDOFF.md")) return SAMPLE_HANDOFF;
        const base = path.basename(absPath);
        if (base === "cemetery.plan.md" || absPath.includes(`${path.sep}*`)) {
          throw new Error(`directory glob or cemetery read: ${absPath}`);
        }
        if (base === "queue-only-done.plan.md") {
          return planFile("Queue done", [{ id: "q2", status: "completed" }]);
        }
        if (base === "backlog-exhausted.plan.md") {
          return planFile("Backlog done", [{ id: "b2", status: "completed" }]);
        }
        return planFile(base, [{ id: "t1", status: "pending" }]);
      },
    };

    const index = await buildPlanIndex(root, io);
    expect(reads.every((p) => !p.includes("*"))).toBe(true);
    expect(reads.some((p) => p.endsWith(FORBIDDEN_PLANS_SCAN_GLOB))).toBe(false);
    expect(index.plans.map((p) => p.file)).not.toContain("cemetery.plan.md");
    expect(index.plans.some((p) => p.role === "pending")).toBe(true);
  });

  it("writes plan-index.json without requiring a plans directory glob", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, ".cursor", "HANDOFF.md"), SAMPLE_HANDOFF, "utf8");
    await writeFile(
      path.join(root, ".cursor", "plans", "active.plan.md"),
      planFile("Active", [{ id: "a1", status: "pending" }]),
      "utf8",
    );
    const index = await writePlanIndex(root);
    const raw = await readFile(path.join(root, PLAN_INDEX_REL), "utf8");
    const parsed = JSON.parse(raw) as { source: string; plans: { file: string }[] };
    expect(parsed.source).toBe("handoff-named");
    expect(parsed.plans.map((p) => p.file)).toEqual(index.plans.map((p) => p.file));
    expect(parsed.plans.map((p) => p.file)).not.toContain("cemetery.plan.md");
  });
});

describe("builder source allowlist", () => {
  it("does not directory-glob .cursor/plans/*.plan.md", async () => {
    const src = await readFile(new URL("./plan-index.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/readdir\s*[<(]/);
    expect(src).not.toMatch(/\bglob\s*\(/);
    expect(src).toContain('source: "handoff-named"');
    expect(src).toContain("FORBIDDEN_PLANS_SCAN_GLOB");
    expect(FORBIDDEN_PLANS_SCAN_GLOB).toBe(".cursor/plans/*.plan.md");
    expect(HANDOFF_REL).toBe(".cursor/HANDOFF.md");
  });
});

describe("L0 read-path commands", () => {
  const commands = ["continue-plan.md", "run-plan-all.md", "start-project.md", "backlog-add.md"];

  it("read index + HANDOFF and ban the plans directory scan glob", async () => {
    for (const name of commands) {
      const body = await readFile(path.join(kitRoot, ".cursor", "commands", name), "utf8");
      expect(body, name).toContain(".cursor/context/plan-index.json");
      expect(body, name).toContain(".cursor/HANDOFF.md");
      expect(body, name).toContain("2026-07-26_command-orchestration-delegation-pattern");
      expect(body, name).not.toMatch(/\*\*read_scope:\*\*[^\n]*\.cursor\/plans\/\*\.plan\.md/);
      expect(body, name).not.toMatch(/\|\s*\*\*Plans\*\*\s*\|[^\n]*\.cursor\/plans\/\*\.plan\.md/);
      expect(body, name).not.toMatch(
        /\|\s*\*\*Candidate plans\*\*\s*\|[^\n]*\.cursor\/plans\/\*\.plan\.md/,
      );
    }
  });
});
