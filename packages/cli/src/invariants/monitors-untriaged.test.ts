import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TRIAGE_HEADING_RE, selectUntriagedMonitors } from "./monitors-untriaged.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

function extractTriageHeadingLiteral(source: string): string {
  const match = source.match(
    /\/\^#\{2,6\}\\s\+\(\?:Triage note\|Follow-\?up plan\|Residuals plan\)\\b\/im/,
  );
  if (!match) {
    throw new Error("TRIAGE_HEADING_RE literal not found in source");
  }
  return match[0];
}

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

  it("TRIAGE_HEADING_RE matches durable triage headings only", () => {
    expect(TRIAGE_HEADING_RE.test("## Triage note - ack")).toBe(true);
    expect(TRIAGE_HEADING_RE.test("## Follow-up plan - x.plan.md")).toBe(true);
    expect(TRIAGE_HEADING_RE.test("## Residuals plan")).toBe(true);
    expect(TRIAGE_HEADING_RE.test("### Triage note")).toBe(true);
    expect(TRIAGE_HEADING_RE.test("## Current state")).toBe(false);
    // Tick headings that name triage-* to-do ids must stay untriaged
    expect(TRIAGE_HEADING_RE.test("## Tick 1 — `adr-quiet-triage-surface` (Phase 0)")).toBe(false);
    expect(TRIAGE_HEADING_RE.test("## Tick 2 (reconstructed) — `l0-triage-step5a` (Phase 1)")).toBe(
      false,
    );
    expect(TRIAGE_HEADING_RE.test("## Closed by residuals plan")).toBe(false);
  });

  it("keeps CLI TRIAGE_HEADING_RE identical to dashboard SoT", () => {
    const cliSrc = readFileSync(path.join(HERE, "triage-heading.ts"), "utf8");
    const dashSrc = readFileSync(path.join(REPO_ROOT, "dashboard/lib/triage-heading.mjs"), "utf8");
    expect(extractTriageHeadingLiteral(cliSrc)).toBe(extractTriageHeadingLiteral(dashSrc));
  });

  it("keeps monitors with triage-* tick headings in the untriaged set", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-monitors-tick-"));
    const mem = path.join(root, ".cursor", "memory");
    await mkdir(mem, { recursive: true });
    await writeFile(
      path.join(mem, "plan-monitor-quiet-open-triages.md"),
      [
        "# Monitor log — flight-log-quiet-open-triages",
        "",
        "## Tick 1 — `adr-quiet-triage-surface` (Phase 0)",
        "",
        "### Still open (only these)",
        "",
        "| ID | What |",
        "|----|------|",
        "| A | Gate fingerprint |",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(mem, "plan-monitor-triage-residuals.md"),
      [
        "# Monitor log — triage-residuals",
        "",
        "## Tick 2 (reconstructed) — `l0-triage-step5a` (Phase 1)",
        "",
        "### Still open (only these)",
        "",
        "1. Pin Broad Intake",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(mem, "plan-monitor-already-acked.md"),
      "## Triage note - Ack and stop\n\nNo open residuals.\n",
      "utf8",
    );
    await writeFile(path.join(root, ".cursor", "HANDOFF.md"), "- **Plan:** none\n", "utf8");

    const result = await selectUntriagedMonitors(root);
    const names = result.monitors.map((m) => path.basename(m.path)).sort();
    expect(names).toEqual([
      "plan-monitor-quiet-open-triages.md",
      "plan-monitor-triage-residuals.md",
    ]);
  });
});
