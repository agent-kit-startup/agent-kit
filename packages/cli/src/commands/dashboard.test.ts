import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findDashboardBroadcastStart } from "../commands/dashboard-broadcast.js";
import { findDashboardStart } from "../commands/dashboard.js";

describe("findDashboardStart", () => {
  it("finds dashboard/start.mjs walking up from a nested cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "ak-dash-"));
    mkdirSync(join(root, "dashboard"));
    writeFileSync(join(root, "dashboard", "start.mjs"), "// stub\n");
    const nested = join(root, "packages", "cli", "src");
    mkdirSync(nested, { recursive: true });

    await expect(findDashboardStart(nested)).resolves.toBe(join(root, "dashboard", "start.mjs"));
  });

  it("returns null when the tree has no dashboard starter", async () => {
    const root = mkdtempSync(join(tmpdir(), "ak-nodash-"));
    await expect(findDashboardStart(root)).resolves.toBeNull();
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

  it("returns null when broadcast starter is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "ak-nodash-bc-"));
    mkdirSync(join(root, "dashboard"));
    writeFileSync(join(root, "dashboard", "start.mjs"), "// stub\n");
    await expect(findDashboardBroadcastStart(root)).resolves.toBeNull();
  });
});
