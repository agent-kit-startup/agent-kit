import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf8");

/**
 * Docs-contract: the /field-report-resolve L0 command and its lazy procedure agree
 * that a terminal plan lifecycle clears `attention:prompt:` rows but only demotes
 * `attention:report:` rows to Review debt (dashboard/lib/semantic-model.mjs:
 * isPromptClearedByPlanLifecycle vs isReportDemotedByPlanLifecycle /
 * buildExternalReportItems). An agent reading only L0 is the default path.
 * Origin: memory errors/2026-11-10_field-report-resolve-l0-report-demotion-drift.md.
 */
describe("docs-contract: /field-report-resolve report demotion", () => {
  const l0 = read(".cursor/commands/field-report-resolve.md");
  const procedure = read(".cursor/skills/core/field-report-resolve/procedure.md");

  it("L0 never lists report demotion as a dismiss signal", () => {
    expect(l0).not.toMatch(/terminal reviewed-plan demotion/i);
    expect(l0).toMatch(/terminal plan lifecycle clears prompt/);
  });

  it("L0 states report demotion is not dismiss-eligible and names the data layer", () => {
    expect(l0).toMatch(/Report demotion is not dismiss-eligible/);
    expect(l0).toMatch(/Review debt/);
    expect(l0).toMatch(/isReportDemotedByPlanLifecycle/);
    expect(l0).toMatch(/buildExternalReportItems/);
  });

  it("procedure keeps `triaged` to a heading or follow-up plan, with lifecycle separate", () => {
    const contract = procedure.match(/\*\*worker_contract:\*\* "triaged:[^\n]*/)?.[0] ?? "";
    expect(contract).not.toBe("");
    expect(contract).toMatch(/terminal lifecycle alone is false/);
    expect(contract).toMatch(/lifecycle: completed\|exhausted\|parked\|active\|none/);
    expect(contract).not.toMatch(/follow-up plan, or terminal lifecycle/);
    expect(procedure).toMatch(/Demotion to Review debt[^\n]*NOT a dismiss signal/);
  });
});
