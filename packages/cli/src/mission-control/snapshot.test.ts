import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PERIODIC_REFRESH_MS } from "../../../../dashboard/lib/live-refresh.mjs";
import {
  dataScriptTimeoutMs,
  PERIODIC_REFRESH_MS as exportedInterval,
  findDashboardDataScript,
  loadDashboardSnapshot,
} from "./snapshot.js";

function fakeCliPackage(): { moduleUrl: string; dataScript: string } {
  const pkg = mkdtempSync(join(tmpdir(), "ak-tui-pkg-"));
  const distIndex = join(pkg, "dist", "index.js");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  mkdirSync(join(pkg, "dashboard"), { recursive: true });
  writeFileSync(distIndex, "");
  writeFileSync(join(pkg, "dashboard", "start.mjs"), "// stub\n");
  const dataScript = join(pkg, "dashboard", "dashboard-data.mjs");
  writeFileSync(
    dataScript,
    `process.stdout.write(JSON.stringify({ missionControl: { now: { status: "idle" } } }));\n`,
  );
  return { moduleUrl: pathToFileURL(distIndex).href, dataScript };
}

describe("findDashboardDataScript", () => {
  it("resolves Path C bundled dashboard-data.mjs via injected moduleUrl", async () => {
    const { moduleUrl, dataScript } = fakeCliPackage();
    const consumer = mkdtempSync(join(tmpdir(), "ak-tui-consumer-"));
    const found = await findDashboardDataScript(consumer, {}, { moduleUrl });
    expect(found).toBe(dataScript);
  });
});

describe("loadDashboardSnapshot", () => {
  it("parses JSON from the data script without starting an HTTP server", async () => {
    const { dataScript } = fakeCliPackage();
    const root = mkdtempSync(join(tmpdir(), "ak-tui-root-"));
    const loaded = await loadDashboardSnapshot({ dataScript, snapshotRoot: root });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.snapshot.missionControl).toMatchObject({ now: { status: "idle" } });
    }
  });

  it("returns an error on invalid JSON", async () => {
    const loaded = await loadDashboardSnapshot({
      dataScript: "/unused.mjs",
      snapshotRoot: mkdtempSync(join(tmpdir(), "ak-tui-bad-")),
      execFileFn: (_file, _args, _opts, cb) => {
        cb(null, "not-json", "");
      },
    });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error).toContain("invalid JSON");
  });
});

describe("poll interval", () => {
  it("reuses PERIODIC_REFRESH_MS from live-refresh.mjs", () => {
    expect(exportedInterval).toBe(PERIODIC_REFRESH_MS);
    expect(exportedInterval).toBe(15_000);
  });

  it("reads AGENT_KIT_DASHBOARD_DATA_TIMEOUT_MS", () => {
    expect(dataScriptTimeoutMs({ AGENT_KIT_DASHBOARD_DATA_TIMEOUT_MS: "90000" })).toBe(90_000);
    expect(dataScriptTimeoutMs({})).toBe(60_000);
  });
});
