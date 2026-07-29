import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRIAGE_HEADING_RE, selectUntriagedMonitors } from "./monitors-untriaged.js";

describe("selectUntriagedMonitors", () => {
  it("never picks a triaged monitor when untriaged exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-monitors-"));
    const mem = path.join(root, ".cursor", "memory");
    await mkdir(mem, { recursive: true });
    await writeFile(
      path.join(mem, "plan-monitor-old.md"),
      "## Triage note - acknowledged\n\nDone.\n",
      "utf8",
    );
    await writeFile(
      path.join(mem, "plan-monitor-fresh.md"),
      "## Current state\n\n### Still open (only these)\n\n1. Fix docs\n",
      "utf8",
    );
    await writeFile(path.join(root, ".cursor", "HANDOFF.md"), "- **Plan:** none\n", "utf8");

    const result = await selectUntriagedMonitors(root);
    expect(result.monitors.map((m) => path.basename(m.path))).toEqual(["plan-monitor-fresh.md"]);
    expect(result.cite).toContain("never newest-mtime-wins");
  });

  it("TRIAGE_HEADING_RE matches durable triage headings", () => {
    expect(TRIAGE_HEADING_RE.test("## Triage note - ack")).toBe(true);
    expect(TRIAGE_HEADING_RE.test("## Follow-up plan - x.plan.md")).toBe(true);
    expect(TRIAGE_HEADING_RE.test("## Residuals plan")).toBe(true);
    expect(TRIAGE_HEADING_RE.test("## Current state")).toBe(false);
  });
});
