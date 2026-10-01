import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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

async function runUpdate(root: string): Promise<string> {
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

/** Kit settings with one deny row removed (as an operator, or an older kit, would leave them). */
function settingsMissingRow(row: string): string {
  const merged = mergeSessionStartHookIntoSettings(null).content as string;
  const parsed = JSON.parse(merged);
  parsed.permissions.deny = parsed.permissions.deny.filter((r: string) => r !== row);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

describe("update: Claude settings drift report (default, no write)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("no settings file -> nothing printed, nothing created", async () => {
    const root = await fixture();
    const out = await runUpdate(root);
    expect(out).not.toContain("Claude settings drift");
    await expect(readdir(path.join(root, ".claude"))).rejects.toThrow();
  });

  it("settings without a kit marker -> unchanged and silent", async () => {
    const root = await fixture();
    await mkdir(path.join(root, ".claude"), { recursive: true });
    const body = `${JSON.stringify({ permissions: { deny: ["Bash(rm -rf *)"] } }, null, 2)}\n`;
    await writeFile(path.join(root, SETTINGS), body, "utf8");
    const out = await runUpdate(root);
    expect(out).not.toContain("Claude settings drift");
    expect(await readFile(path.join(root, SETTINGS), "utf8")).toBe(body);
  });

  it("protected default: bytes identical, ambiguous snippet + opt-in command printed, manifest and ledger untouched", async () => {
    const row = INTERACTIVE_DENY_RULES[0] as string;
    const root = await fixture([SETTINGS]);
    await mkdir(path.join(root, ".claude"), { recursive: true });
    const body = settingsMissingRow(row);
    await writeFile(path.join(root, SETTINGS), body, "utf8");
    const manifestBefore = JSON.parse(
      await readFile(path.join(root, ".cursor", "agent-kit.json"), "utf8"),
    );

    const out = await runUpdate(root);

    expect(await readFile(path.join(root, SETTINGS), "utf8")).toBe(body);
    expect(out).toContain("protected (skipped)");
    expect(out).toContain(JSON.stringify(row));
    expect(out).toContain("ambiguous");
    expect(out).toContain("agent-kit update --claude");
    await expect(readFile(path.join(root, LEDGER), "utf8")).rejects.toThrow();
    const manifestAfter = JSON.parse(
      await readFile(path.join(root, ".cursor", "agent-kit.json"), "utf8"),
    );
    expect(manifestAfter.protected).toEqual(manifestBefore.protected);
  });

  it("ledger says the row was written and deleted -> not reported", async () => {
    const row = INTERACTIVE_DENY_RULES[0] as string;
    const root = await fixture();
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await writeFile(path.join(root, SETTINGS), settingsMissingRow(row), "utf8");
    await writeFile(
      path.join(root, LEDGER),
      JSON.stringify({
        schemaVersion: 1,
        denyRowsWritten: [...INTERACTIVE_DENY_RULES],
        hookEntriesWritten: [],
      }),
      "utf8",
    );
    const out = await runUpdate(root);
    expect(out).not.toContain("Claude settings drift");
  });

  it("ledger present, kit row never written -> listed as add (not ambiguous)", async () => {
    const row = INTERACTIVE_DENY_RULES[0] as string;
    const root = await fixture();
    await mkdir(path.join(root, ".claude"), { recursive: true });
    const body = settingsMissingRow(row);
    await writeFile(path.join(root, SETTINGS), body, "utf8");
    const ledgerBody = JSON.stringify({
      schemaVersion: 1,
      denyRowsWritten: INTERACTIVE_DENY_RULES.filter((r) => r !== row),
      hookEntriesWritten: [],
    });
    await writeFile(path.join(root, LEDGER), ledgerBody, "utf8");
    const out = await runUpdate(root);
    expect(out).toContain(JSON.stringify(row));
    expect(out).not.toContain("ambiguous");
    expect(await readFile(path.join(root, SETTINGS), "utf8")).toBe(body);
    expect(await readFile(path.join(root, LEDGER), "utf8")).toBe(ledgerBody);
  });
});
