import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INTERACTIVE_DENY_RULES } from "../generator/claude-permissions.js";
import { mergeSessionStartHookIntoSettings } from "../generator/claude-session-start-hook.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { updateCommand } from "./update.js";

vi.mock("../lifecycle/sync.js", () => ({
  syncFromManifest: vi.fn(async () => ({
    written: [],
    removed: [],
    collisions: [],
    skippedProtected: [],
    missing: [],
    unchanged: [],
    preservedCustomized: [],
    skippedSymlink: [],
  })),
}));

async function fixture(protectedGlobs: string[] = []): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ak-update-claude-drift-"));
  await mkdir(path.join(root, ".cursor"), { recursive: true });
  await writeFile(
    path.join(root, ".cursor", "agent-kit.json"),
    JSON.stringify({
      schemaVersion: 1,
      version: KIT_VERSION,
      protected: protectedGlobs,
      installedAt: "2026-07-30T00:00:00.000Z",
    }),
    "utf8",
  );
  return root;
}

async function runUpdate(root: string, claude = false): Promise<string> {
  const out: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...p: unknown[]) => {
    out.push(p.map(String).join(" "));
  });
  try {
    await (
      updateCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>
    )({
      args: {
        _: [],
        cwd: root,
        check: false,
        json: false,
        "respect-prefs": false,
        stamp: false,
        "seed-overlay": false,
        claude,
        registry: undefined as unknown as string,
        url: undefined as unknown as string,
        ref: undefined as unknown as string,
        refresh: false,
      },
    });
  } finally {
    spy.mockRestore();
  }
  return out.join("\n");
}

const SETTINGS = ".claude/settings.json";
const LEDGER = ".cursor/agent-kit.claude-settings.json";

function settingsMissingRow(row: string): string {
  const merged = mergeSessionStartHookIntoSettings(null).content as string;
  const parsed = JSON.parse(merged);
  parsed.permissions.deny = parsed.permissions.deny.filter((r: string) => r !== row);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

describe("update --claude (opt-in ledger-aware merge)", () => {
  const originalExitCode = process.exitCode;
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it("writes the ambiguous row with install authority, creates the ledger, leaves manifest.protected alone", async () => {
    const row = INTERACTIVE_DENY_RULES[0] as string;
    const root = await fixture([SETTINGS]);
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await writeFile(path.join(root, SETTINGS), settingsMissingRow(row), "utf8");

    const out = await runUpdate(root, true);

    const settings = JSON.parse(await readFile(path.join(root, SETTINGS), "utf8"));
    expect(settings.permissions.deny).toContain(row);
    const ledger = JSON.parse(await readFile(path.join(root, LEDGER), "utf8"));
    expect(ledger.denyRowsWritten).toContain(row);
    expect(out).toContain("Claude settings");
    expect(out).not.toContain("Claude settings drift");
    const manifest = JSON.parse(
      await readFile(path.join(root, ".cursor", "agent-kit.json"), "utf8"),
    );
    expect(manifest.protected).toEqual([SETTINGS]);
  });

  it("a row the ledger says was deleted stays deleted", async () => {
    const row = INTERACTIVE_DENY_RULES[0] as string;
    const root = await fixture();
    await mkdir(path.join(root, ".claude"), { recursive: true });
    const body = settingsMissingRow(row);
    await writeFile(path.join(root, SETTINGS), body, "utf8");
    await writeFile(
      path.join(root, LEDGER),
      JSON.stringify({
        schemaVersion: 1,
        denyRowsWritten: [...INTERACTIVE_DENY_RULES],
        hookEntriesWritten: [],
      }),
      "utf8",
    );
    await runUpdate(root, true);
    expect(await readFile(path.join(root, SETTINGS), "utf8")).toBe(body);
  });

  it("symlinked settings.json outside the project -> exit 1, no success line, target untouched", async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), "ak-update-claude-outside-"));
    const target = path.join(outside, "settings.json");
    await writeFile(target, "{}\n", "utf8");
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await symlink(target, path.join(root, SETTINGS));
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...p: unknown[]) => {
      errors.push(p.map(String).join(" "));
    });
    const out = await runUpdate(root, true);
    expect(process.exitCode).toBe(1);
    expect(out).not.toContain("Update complete");
    expect(errors.join("\n")).toContain("symlink");
    expect(await readFile(target, "utf8")).toBe("{}\n");
    await expect(readFile(path.join(root, LEDGER), "utf8")).rejects.toThrow();
  });

  it("symlinked ledger -> exit 1, settings untouched", async () => {
    const row = INTERACTIVE_DENY_RULES[0] as string;
    const root = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), "ak-update-claude-outside-"));
    await mkdir(path.join(root, ".claude"), { recursive: true });
    const body = settingsMissingRow(row);
    await writeFile(path.join(root, SETTINGS), body, "utf8");
    await symlink(path.join(outside, "ledger.json"), path.join(root, LEDGER));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await runUpdate(root, true);
    expect(process.exitCode).toBe(1);
    expect(out).not.toContain("Update complete");
    expect(await readFile(path.join(root, SETTINGS), "utf8")).toBe(body);
  });

  it("plan-loop never invokes `update --claude`", async () => {
    const dir = path.resolve(import.meta.dirname, "../plan-loop");
    const files = (await readdir(dir, { recursive: true })).filter((f) => /\.[mc]?[jt]s$/.test(f));
    for (const f of files) {
      const text = await readFile(path.join(dir, f), "utf8");
      expect(text, f).not.toMatch(/update\s+--claude/);
    }
  });
});
