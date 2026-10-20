import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DRIVER_PROTOCOL_VERSION } from "../plan-loop/driver-events.js";
import {
  buildEngineManifest,
  parseDashboardDataVersion,
  renderEngineManifest,
} from "./engine-info.js";

const cliRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const repoRoot = resolve(cliRoot, "../..");
const pkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")) as {
  name: string;
  version: string;
  engines: { node: string };
};

describe("engine manifest", () => {
  it("parses dashboardDataVersion from dashboard-data.mjs text", () => {
    expect(parseDashboardDataVersion('  generatedAt: x,\n  dashboardDataVersion: "1.6.0",\n')).toBe(
      "1.6.0",
    );
    // The schema description line (a sentence, not a version) is not a match.
    expect(
      parseDashboardDataVersion('      dashboardDataVersion: "Semantic version of the data model"'),
    ).toBeNull();
    expect(parseDashboardDataVersion("nothing here")).toBeNull();
  });

  it("matches the repo's dashboard and package metadata", () => {
    const real = readFileSync(join(repoRoot, "dashboard", "dashboard-data.mjs"), "utf8");
    const m = buildEngineManifest({
      dashboardCandidates: [join(repoRoot, "dashboard", "dashboard-data.mjs")],
    });
    expect(m).toEqual({
      manifestVersion: 1,
      name: "@dadado/agent-kit-cli",
      version: pkg.version,
      node: pkg.engines.node,
      driverProtocol: DRIVER_PROTOCOL_VERSION,
      dashboardDataVersion: parseDashboardDataVersion(real),
      entry: "dist/index.js",
      dashboardServe: "dashboard/serve.mjs",
    });
    expect(m.dashboardDataVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("falls through missing candidates and reports null when no dashboard ships", () => {
    const dir = mkdtempSync(join(tmpdir(), "ak-engine-info-"));
    try {
      const file = join(dir, "dashboard-data.mjs");
      writeFileSync(file, 'export const x = {\n  dashboardDataVersion: "2.0.1",\n};\n');
      const meta = {
        name: "@dadado/agent-kit-cli",
        version: "9.9.9",
        engines: { node: ">=22.12" },
      };
      expect(
        buildEngineManifest({ metadata: meta, dashboardCandidates: [join(dir, "nope.mjs"), file] })
          .dashboardDataVersion,
      ).toBe("2.0.1");
      const none = buildEngineManifest({
        metadata: meta,
        dashboardCandidates: [join(dir, "nope.mjs")],
      });
      expect(none.dashboardDataVersion).toBeNull();
      expect(renderEngineManifest(none)).toContain("dashboard data (no dashboard found)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
