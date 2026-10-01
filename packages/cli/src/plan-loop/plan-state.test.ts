import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countPendingTodos, resolveActivePlanPath } from "./plan-state.js";

function plan(status: string): string {
  return `---\nname: P\ntodos:\n  - id: t1\n    content: t1\n    status: ${status}\n---\n`;
}

async function fixture(handoff: string | null): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ak-plan-state-"));
  const plans = path.join(root, ".cursor", "plans");
  await mkdir(plans, { recursive: true });
  await writeFile(path.join(plans, "aaa.plan.md"), plan("completed"), "utf8");
  await writeFile(path.join(plans, "zzz.plan.md"), plan("pending"), "utf8");
  if (handoff !== null) await writeFile(path.join(root, ".cursor", "HANDOFF.md"), handoff, "utf8");
  return root;
}

describe("resolveActivePlanPath", () => {
  it("prefers the HANDOFF-named plan over the alphabetical pick", async () => {
    const root = await fixture("- **Plan:** `zzz.plan.md`\n");
    expect(await resolveActivePlanPath(root)).toBe(
      path.join(root, ".cursor", "plans", "zzz.plan.md"),
    );
  });

  it("prefers the unfinished run queue's current plan over the Plan field", async () => {
    const root = await fixture(
      [
        "- **Plan:** `aaa.plan.md`",
        "- **Run queue:** [aaa.plan.md, zzz.plan.md]",
        "- **Queue cursor:** 1 (current: zzz.plan.md)",
        "- **Queue status:** running",
        "",
      ].join("\n"),
    );
    expect(path.basename((await resolveActivePlanPath(root)) ?? "")).toBe("zzz.plan.md");
  });

  it("falls back to the alphabetical pick only when HANDOFF names no plan", async () => {
    const root = await fixture("- **Plan:** none\n");
    expect(path.basename((await resolveActivePlanPath(root)) ?? "")).toBe("aaa.plan.md");
    const bare = await fixture(null);
    expect(path.basename((await resolveActivePlanPath(bare)) ?? "")).toBe("aaa.plan.md");
  });
});

describe("countPendingTodos", () => {
  it("counts indented to-dos and ignores status text inside content", () => {
    const raw = [
      "---",
      "name: Fixture",
      "todos:",
      "  - id: a1",
      "    content: 'Doc says status: pending but this one is done'",
      "    status: completed",
      "  - id: a2",
      "    content: Contínuo follow-up",
      "    status: pending",
      "  - id: dogfood-poc",
      "    content: dogfood",
      "    status: in_progress",
      "  - id: a3",
      "    content: next",
      "    status: in_progress",
      "---",
      "",
      "# Fixture",
      "status: pending",
      "",
    ].join("\n");
    expect(countPendingTodos(raw)).toBe(2);
  });

  it("returns 0 without frontmatter", () => {
    expect(countPendingTodos("# No frontmatter\nstatus: pending\n")).toBe(0);
  });
});
