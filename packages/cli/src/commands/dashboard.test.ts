import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { findDashboardBroadcastStart } from "../commands/dashboard-broadcast.js";
import {
  bundledDashboardCandidates,
  findDashboardStart,
  resolveDashboardSnapshotRoot,
} from "../commands/dashboard.js";

/** Build a fake published package layout under tmpdir for Path C hermetic tests. */
function fakeCliPackage(withDashboard: boolean): { moduleUrl: string; dashboardStart: string } {
  const pkg = mkdtempSync(join(tmpdir(), "ak-pkg-"));
  const distIndex = join(pkg, "dist", "index.js");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(distIndex, "");
  const dashboardStart = join(pkg, "dashboard", "start.mjs");
  if (withDashboard) {
    mkdirSync(join(pkg, "dashboard"), { recursive: true });
    writeFileSync(dashboardStart, "// stub\n");
    writeFileSync(join(pkg, "dashboard", "start-broadcast.mjs"), "// stub\n");
  }
  return { moduleUrl: pathToFileURL(distIndex).href, dashboardStart };
}

describe("findDashboardStart", () => {
  it("finds dashboard/start.mjs walking up from a nested cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "ak-dash-"));
    mkdirSync(join(root, "dashboard"));
    writeFileSync(join(root, "dashboard", "start.mjs"), "// stub\n");
    const nested = join(root, "packages", "cli", "src");
    mkdirSync(nested, { recursive: true });

    await expect(findDashboardStart(nested)).resolves.toBe(join(root, "dashboard", "start.mjs"));
  });

  it("finds start.mjs via AGENT_KIT_HOME when cwd has no dashboard", async () => {
    const kit = mkdtempSync(join(tmpdir(), "ak-kit-home-"));
    mkdirSync(join(kit, "dashboard"));
    writeFileSync(join(kit, "dashboard", "start.mjs"), "// stub\n");
    const consumer = mkdtempSync(join(tmpdir(), "ak-consumer-"));
    await expect(findDashboardStart(consumer, { AGENT_KIT_HOME: kit })).resolves.toBe(
      join(kit, "dashboard", "start.mjs"),
    );
  });

  it("finds sibling ../agent-kit/dashboard/start.mjs", async () => {
    const parent = mkdtempSync(join(tmpdir(), "ak-sib-"));
    const kit = join(parent, "agent-kit");
    const consumer = join(parent, "consumer-app");
    mkdirSync(join(kit, "dashboard"), { recursive: true });
    mkdirSync(consumer, { recursive: true });
    writeFileSync(join(kit, "dashboard", "start.mjs"), "// stub\n");
    await expect(findDashboardStart(consumer, {})).resolves.toBe(
      join(kit, "dashboard", "start.mjs"),
    );
  });

  it("lists Path C bundled candidates relative to a package dist module", () => {
    const pkg = mkdtempSync(join(tmpdir(), "ak-pkg-"));
    const distIndex = join(pkg, "dist", "index.js");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    mkdirSync(join(pkg, "dashboard"), { recursive: true });
    writeFileSync(distIndex, "");
    writeFileSync(join(pkg, "dashboard", "start.mjs"), "// stub\n");
    const candidates = bundledDashboardCandidates("start.mjs", pathToFileURL(distIndex).href);
    expect(candidates[0]).toBe(join(pkg, "dashboard", "start.mjs"));
  });

  it("resolves Path C bundled dashboard via injected moduleUrl (hermetic)", async () => {
    const { moduleUrl, dashboardStart } = fakeCliPackage(true);
    const consumer = mkdtempSync(join(tmpdir(), "ak-bundled-"));
    const found = await findDashboardStart(consumer, {}, { moduleUrl });
    expect(found).toBe(dashboardStart);
  });

  it("returns null when no dashboard starter exists (hermetic)", async () => {
    const { moduleUrl } = fakeCliPackage(false);
    const consumer = mkdtempSync(join(tmpdir(), "ak-none-"));
    await expect(findDashboardStart(consumer, {}, { moduleUrl })).resolves.toBeNull();
  });
});

describe("resolveDashboardSnapshotRoot", () => {
  it("returns the absolute cwd when git is unavailable", () => {
    const root = mkdtempSync(join(tmpdir(), "ak-snap-"));
    expect(resolveDashboardSnapshotRoot(root)).toBe(root);
  });

  it("prefers the nearest Agent Kit install over a parent git toplevel", () => {
    const mono = mkdtempSync(join(tmpdir(), "ak-mono-"));
    // Create a parent git tree so rev-parse would climb above the package.
    execFileSync("git", ["init"], { cwd: mono });
    const pkg = join(mono, "pkg");
    mkdirSync(join(pkg, ".cursor"), { recursive: true });
    writeFileSync(join(pkg, ".cursor", "agent-kit.json"), "{}\n");
    expect(resolveDashboardSnapshotRoot(pkg)).toBe(pkg);
  });
});

describe("findDashboardBroadcastStart", () => {
  it("finds dashboard/start-broadcast.mjs walking up from a nested cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "ak-dash-bc-"));
    mkdirSync(join(root, "dashboard"));
    writeFileSync(join(root, "dashboard", "start-broadcast.mjs"), "// stub\n");
    const nested = join(root, "packages", "cli", "src");
    mkdirSync(nested, { recursive: true });

    await expect(findDashboardBroadcastStart(nested)).resolves.toBe(
      join(root, "dashboard", "start-broadcast.mjs"),
    );
  });

  it("finds broadcast starter via AGENT_KIT_HOME", async () => {
    const kit = mkdtempSync(join(tmpdir(), "ak-kit-bc-"));
    mkdirSync(join(kit, "dashboard"));
    writeFileSync(join(kit, "dashboard", "start-broadcast.mjs"), "// stub\n");
    const consumer = mkdtempSync(join(tmpdir(), "ak-consumer-bc-"));
    await expect(findDashboardBroadcastStart(consumer, { AGENT_KIT_HOME: kit })).resolves.toBe(
      join(kit, "dashboard", "start-broadcast.mjs"),
    );
  });

  it("resolves Path C bundled broadcast via injected moduleUrl (hermetic)", async () => {
    const { moduleUrl, dashboardStart } = fakeCliPackage(true);
    const dashboardBroadcastStart = join(dirname(dashboardStart), "start-broadcast.mjs");
    const consumer = mkdtempSync(join(tmpdir(), "ak-bc-bundled-"));
    const found = await findDashboardBroadcastStart(consumer, {}, { moduleUrl });
    expect(found).toBe(dashboardBroadcastStart);
  });

  it("returns null when broadcast starter is missing (hermetic)", async () => {
    const { moduleUrl } = fakeCliPackage(false);
    const consumer = mkdtempSync(join(tmpdir(), "ak-bc-none-"));
    await expect(findDashboardBroadcastStart(consumer, {}, { moduleUrl })).resolves.toBeNull();
  });
});
