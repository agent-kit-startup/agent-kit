import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CURSOR_AWARENESS_SPAWN_TIMEOUT_MS } from "../hooks/session-start.js";
import {
  CHANGELOG_FETCH_TIMEOUT_MS,
  checkCursorUpdateAwareness,
  compareCursorVersion,
  extractLatestCursorVersion,
  isPlausibleCursorVersion,
  parseInventoryRefreshed,
  parseOpenActionIds,
  readCursorUpdateCheckPrefs,
  resolveInventoryRoot,
  stampCursorUpdateCheck,
} from "./cursor-update-awareness.js";

const fixtureHtml = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "cursor-changelog-excerpt.html",
  ),
  "utf8",
);

function writeInventory(cwd: string, body: string): void {
  mkdirSync(path.join(cwd, "docs"), { recursive: true });
  writeFileSync(path.join(cwd, "docs", "cursor-native-audit.md"), body, "utf8");
  writeFileSync(
    path.join(cwd, "docs", "cursor-3-features.md"),
    `| Feature | What it does | How Agent Kit uses it |
|---------|-----------|----------------------|
| Plans | Native Cursor plans | Agent Kit generates plans |
`,
    "utf8",
  );
}

describe("cursor-update-awareness helpers", () => {
  it("defaults cursorUpdateCheck to opt-in false", () => {
    expect(readCursorUpdateCheckPrefs({})).toMatchObject({
      enabled: false,
      intervalDays: 7,
      lastSeenCursorVersion: null,
    });
  });

  it("extracts latest Cursor version from changelog text", () => {
    expect(extractLatestCursorVersion("3.0 Apr 2 · Changelog\n3.6 May 29")).toBe("3.6");
    expect(extractLatestCursorVersion("ignore 2026 noise and 3.11.2")).toBe("3.11.2");
  });

  it("anchors extraction on recorded changelog HTML (not CSS 49.511)", () => {
    expect(fixtureHtml).toContain("49.511");
    expect(extractLatestCursorVersion(fixtureHtml)).toBe("3.11");
    expect(isPlausibleCursorVersion("49.511")).toBe(false);
    expect(isPlausibleCursorVersion("3.11")).toBe(true);
  });

  it("keeps spawn timeout above changelog fetch timeout", () => {
    expect(CURSOR_AWARENESS_SPAWN_TIMEOUT_MS).toBeGreaterThan(CHANGELOG_FETCH_TIMEOUT_MS);
  });

  it("compares loose Cursor versions", () => {
    expect(compareCursorVersion("3.6", "3.5")).toBe(1);
    expect(compareCursorVersion("3.6", "3.6.0")).toBe(0);
    expect(compareCursorVersion("3.5", "3.6")).toBe(-1);
  });

  it("parses inventory refresh date and open actions", () => {
    const md =
      "Living audit; last refreshed **2026-07-19**.\n\n| ID | Status | Action |\n|----|--------|--------|\n| A4 | Open | Align hooks |\n| A5 | Open | Add AGENTS.md |\n| A1 | ✅ Done | Fix |\n";
    expect(parseInventoryRefreshed(md)).toBe("2026-07-19");
    expect(parseOpenActionIds(md)).toEqual(["A4", "A5"]);
  });
});

describe("checkCursorUpdateAwareness", () => {
  it("reports open inventory actions as advisory gaps (offline)", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cursor-awareness-"));
    writeInventory(
      cwd,
      "Living audit; last refreshed **2026-07-19**.\n\n| ID | Status | Action |\n|----|--------|--------|\n| A4 | Open | Align hooks |\n",
    );

    const result = await checkCursorUpdateAwareness(cwd, { offline: true });
    expect(result.applyRecommended).toBe(false);
    expect(result.fieldReportRecommended).toBe(false);
    expect(result.status).toBe("gaps-found");
    expect(result.openActionIds).toEqual(["A4"]);
    expect(result.gaps.some((g) => g.id === "open-action-A4")).toBe(true);
    expect(result.conveyorHint).toContain("/backlog-add");
  });

  it("detects changelog ahead of lastSeen baseline", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cursor-awareness-"));
    writeInventory(
      cwd,
      "Living audit; last refreshed **2026-07-19**.\n\n| ID | Status | Action |\n|----|--------|--------|\n| A1 | ✅ Done | Fix |\n",
    );
    mkdirSync(path.join(cwd, ".cursor", "context"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".cursor", "context", "config.json"),
      JSON.stringify({
        cursorUpdateCheck: {
          enabled: true,
          lastSeenCursorVersion: "3.0",
        },
      }),
      "utf8",
    );

    const result = await checkCursorUpdateAwareness(cwd, {
      changelogBody: "3.6 May 29 · Changelog Cursor 3.6",
    });
    expect(result.status).toBe("gaps-found");
    expect(result.latestCursorVersion).toBe("3.6");
    expect(result.gaps.some((g) => g.id === "changelog-ahead")).toBe(true);
  });

  it("refuses to stamp implausible latest versions as baseline", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cursor-awareness-"));
    writeInventory(
      cwd,
      "Living audit; last refreshed **2026-07-19**.\n\n| ID | Status | Action |\n|----|--------|--------|\n| A1 | ✅ Done | Fix |\n",
    );
    mkdirSync(path.join(cwd, ".cursor", "context"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".cursor", "context", "config.json"),
      JSON.stringify({
        cursorUpdateCheck: {
          enabled: true,
          lastSeenCursorVersion: "3.0",
        },
      }),
      "utf8",
    );

    await checkCursorUpdateAwareness(cwd, {
      stamp: true,
      // Only CSS noise: extract returns null; stamp must not write 49.511.
      changelogBody: '<svg path d="0-49.511 33.51-76.69"></svg>',
    });
    const cfg = JSON.parse(
      readFileSync(path.join(cwd, ".cursor", "context", "config.json"), "utf8"),
    ) as { cursorUpdateCheck: { lastSeenCursorVersion: string | null } };
    expect(cfg.cursorUpdateCheck.lastSeenCursorVersion).toBe("3.0");
  });

  it("stampCursorUpdateCheck withholds lastSeen on implausible non-null version (T2)", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cursor-awareness-"));
    mkdirSync(path.join(cwd, ".cursor", "context"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".cursor", "context", "config.json"),
      JSON.stringify({
        cursorUpdateCheck: {
          enabled: true,
          lastSeenCursorVersion: "3.0",
        },
      }),
      "utf8",
    );

    // Reach the stamp guard directly with a non-null implausible token (extractor bypass).
    await stampCursorUpdateCheck(cwd, { lastSeenCursorVersion: "49.511" });
    const cfg = JSON.parse(
      readFileSync(path.join(cwd, ".cursor", "context", "config.json"), "utf8"),
    ) as {
      cursorUpdateCheck: {
        lastSeenCursorVersion: string | null;
        lastCheckedAt: string | null;
      };
    };
    expect(cfg.cursorUpdateCheck.lastSeenCursorVersion).toBe("3.0");
    expect(cfg.cursorUpdateCheck.lastCheckedAt).toBeTruthy();
  });

  it("skips when respectPrefs and disabled", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cursor-awareness-"));
    writeInventory(cwd, "last refreshed **2026-07-19**\n");
    const result = await checkCursorUpdateAwareness(cwd, { respectPrefs: true, offline: true });
    expect(result.status).toBe("skipped-disabled");
    expect(result.inventoryRoot).toBe(path.resolve(cwd));
  });

  it("skips when respectPrefs and within interval", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cursor-awareness-"));
    writeInventory(cwd, "last refreshed **2026-07-19**\n");
    mkdirSync(path.join(cwd, ".cursor", "context"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".cursor", "context", "config.json"),
      JSON.stringify({
        cursorUpdateCheck: {
          enabled: true,
          intervalDays: 7,
          lastCheckedAt: new Date().toISOString(),
        },
      }),
      "utf8",
    );
    const result = await checkCursorUpdateAwareness(cwd, { respectPrefs: true, offline: true });
    expect(result.status).toBe("skipped-interval");
    expect(result.inventoryRoot).toBe(path.resolve(cwd));
  });

  it("walks up from nested cwd to find inventory", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "cursor-awareness-walk-"));
    writeInventory(
      root,
      "Living audit; last refreshed **2026-07-19**.\n\n| ID | Status | Action |\n|----|--------|--------|\n| A1 | ✅ Done | Fix |\n",
    );
    mkdirSync(path.join(root, ".git"), { recursive: true });
    const nested = path.join(root, "packages", "cli");
    mkdirSync(nested, { recursive: true });

    expect(await resolveInventoryRoot(nested)).toBe(path.resolve(root));
    const result = await checkCursorUpdateAwareness(nested, { offline: true });
    expect(result.status).toBe("current");
    expect(result.message).not.toMatch(/Missing inventory/);
    expect(result.inventoryRoot).toBe(path.resolve(root));
    expect(result.inventoryRoot).not.toBe(nested);
    expect(result.inventoryPath).toBe(path.join("docs", "cursor-native-audit.md"));
    expect(result.featuresPath).toBe(path.join("docs", "cursor-3-features.md"));
  });

  it("stamps prefs at resolved inventory root, not nested cwd", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "cursor-awareness-stamp-root-"));
    writeInventory(
      root,
      "Living audit; last refreshed **2026-07-19**.\n\n| ID | Status | Action |\n|----|--------|--------|\n| A1 | ✅ Done | Fix |\n",
    );
    mkdirSync(path.join(root, ".git"), { recursive: true });
    mkdirSync(path.join(root, ".cursor", "context"), { recursive: true });
    writeFileSync(
      path.join(root, ".cursor", "context", "config.json"),
      JSON.stringify({
        cursorUpdateCheck: {
          enabled: true,
          lastSeenCursorVersion: "3.0",
        },
      }),
      "utf8",
    );
    const nested = path.join(root, "packages", "cli");
    mkdirSync(nested, { recursive: true });

    const result = await checkCursorUpdateAwareness(nested, {
      stamp: true,
      changelogBody: "3.6 May 29 · Changelog Cursor 3.6",
    });
    expect(result.inventoryRoot).toBe(path.resolve(root));
    expect(result.gaps.some((g) => g.id === "changelog-ahead")).toBe(true);

    const cfg = JSON.parse(
      readFileSync(path.join(root, ".cursor", "context", "config.json"), "utf8"),
    ) as { cursorUpdateCheck: { lastSeenCursorVersion: string | null } };
    expect(cfg.cursorUpdateCheck.lastSeenCursorVersion).toBe("3.6");
    expect(existsSync(path.join(nested, ".cursor"))).toBe(false);
  });

  it("does not inherit a parent kit inventory across a nested .git boundary", async () => {
    const kitroot = mkdtempSync(path.join(tmpdir(), "cursor-awareness-nested-kit-"));
    writeInventory(
      kitroot,
      "Living audit; last refreshed **2026-07-19**.\n\n| ID | Status | Action |\n|----|--------|--------|\n| Z9 | Open | Foreign kit action that the consumer does not own |\n",
    );
    mkdirSync(path.join(kitroot, ".git"), { recursive: true });
    const nestedCwd = path.join(kitroot, "consumer-app", "src");
    mkdirSync(nestedCwd, { recursive: true });
    mkdirSync(path.join(kitroot, "consumer-app", ".git"), { recursive: true });

    expect(await resolveInventoryRoot(nestedCwd)).toBeNull();
    const result = await checkCursorUpdateAwareness(nestedCwd, { offline: true });
    expect(result.status).toBe("error");
    expect(result.inventoryRoot).toBeNull();
    expect(result.openActionIds).toEqual([]);
    expect(result.gaps.some((g) => g.id === "open-action-Z9")).toBe(false);
    expect(result.message).toMatch(/Missing inventory/);
    expect(result.message).toMatch(/--cwd/);
  });

  it("errors with --cwd hint when no inventory in ancestors", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cursor-awareness-nodocs-"));
    expect(await resolveInventoryRoot(cwd)).toBeNull();
    const result = await checkCursorUpdateAwareness(cwd, { offline: true });
    expect(result.status).toBe("error");
    expect(result.inventoryRoot).toBeNull();
    expect(result.message).toMatch(/Missing inventory/);
    expect(result.message).toMatch(/--cwd/);
  });

  it("does not stamp under caller cwd when inventory root is missing", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cursor-awareness-nostamp-"));
    const result = await checkCursorUpdateAwareness(cwd, { stamp: true, offline: true });
    expect(result.status).toBe("error");
    expect(result.inventoryRoot).toBeNull();
    expect(existsSync(path.join(cwd, ".cursor", "context", "config.json"))).toBe(false);
  });

  it("does not stamp under caller cwd across a nested .git boundary", async () => {
    const kitroot = mkdtempSync(path.join(tmpdir(), "cursor-awareness-nostamp-git-"));
    writeInventory(
      kitroot,
      "Living audit; last refreshed **2026-07-19**.\n\n| ID | Status | Action |\n|----|--------|--------|\n| Z9 | Open | Foreign kit action that the consumer does not own |\n",
    );
    mkdirSync(path.join(kitroot, ".git"), { recursive: true });
    const nestedCwd = path.join(kitroot, "consumer-app", "src");
    mkdirSync(nestedCwd, { recursive: true });
    mkdirSync(path.join(kitroot, "consumer-app", ".git"), { recursive: true });

    const result = await checkCursorUpdateAwareness(nestedCwd, { stamp: true, offline: true });
    expect(result.status).toBe("error");
    expect(result.inventoryRoot).toBeNull();
    expect(existsSync(path.join(nestedCwd, ".cursor", "context", "config.json"))).toBe(false);
  });
});
