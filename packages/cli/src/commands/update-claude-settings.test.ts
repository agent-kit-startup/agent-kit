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

  describe("command adapters", () => {
    async function addSource(root: string, name: string) {
      await mkdir(path.join(root, ".cursor", "commands"), { recursive: true });
      await writeFile(
        path.join(root, ".cursor", "commands", `${name}.md`),
        `---\nname: ${name}\ndescription: ${name} command\n---\n`,
        "utf8",
      );
    }

    async function snapshot(root: string): Promise<Map<string, string>> {
      const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter((e) =>
        e.isFile(),
      );
      const map = new Map<string, string>();
      for (const e of files) {
        const abs = path.join(e.parentPath, e.name);
        map.set(path.relative(root, abs), await readFile(abs, "utf8"));
      }
      return map;
    }

    it("generates adapters on a dirty tree; only .claude/** and the shared ledgers change", async () => {
      const root = await fixture();
      await addSource(root, "run-plan");
      await addSource(root, "handoff");
      await writeFile(path.join(root, "src-wip.ts"), "export const dirty = 1;\n", "utf8");
      await writeFile(path.join(root, "README.md"), "# uncommitted edit\n", "utf8");
      const before = await snapshot(root);

      const out = await runUpdate(root, true);

      expect(out).toContain("Claude command adapters: 2 written");
      const adapter = await readFile(path.join(root, ".claude/commands/run-plan.md"), "utf8");
      expect(adapter).toContain(".cursor/commands/run-plan.md");
      const after = await snapshot(root);
      const allowed = (rel: string) =>
        rel.startsWith(".claude/") ||
        rel === ".cursor/agent-kit.managed-hashes.json" ||
        rel === LEDGER ||
        rel === ".cursor/agent-kit.json";
      for (const [rel, content] of after) {
        if (before.get(rel) === content) continue;
        expect(allowed(rel), `unexpected write: ${rel}`).toBe(true);
      }
      for (const [rel, content] of before) {
        if (allowed(rel)) continue;
        expect(after.get(rel), rel).toBe(content);
      }
      expect(after.has(".claude/commands/agent-kit.md")).toBe(false);
    });

    it("is idempotent and preserves a hand-edited adapter", async () => {
      const root = await fixture();
      await addSource(root, "run-plan");
      await runUpdate(root, true);
      const file = path.join(root, ".claude/commands/run-plan.md");
      await writeFile(file, "my own adapter\n", "utf8");
      const out = await runUpdate(root, true);
      expect(out).toContain("1 preserved (customized)");
      expect(await readFile(file, "utf8")).toBe("my own adapter\n");
    });

    it("plain update never writes adapters", async () => {
      const root = await fixture();
      await addSource(root, "run-plan");
      await runUpdate(root, false);
      await expect(
        readFile(path.join(root, ".claude/commands/run-plan.md"), "utf8"),
      ).rejects.toThrow();
    });

    it("symlinked adapter target outside the project -> exit 1, target untouched", async () => {
      const root = await fixture();
      await addSource(root, "run-plan");
      const outside = await mkdtemp(path.join(tmpdir(), "ak-update-claude-outside-"));
      const target = path.join(outside, "run-plan.md");
      await writeFile(target, "outside\n", "utf8");
      await mkdir(path.join(root, ".claude", "commands"), { recursive: true });
      await symlink(target, path.join(root, ".claude/commands/run-plan.md"));
      const errors: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...p: unknown[]) => {
        errors.push(p.map(String).join(" "));
      });
      const out = await runUpdate(root, true);
      expect(process.exitCode).toBe(1);
      expect(out).not.toContain("Update complete");
      expect(errors.join("\n")).toContain(".claude/commands/run-plan.md");
      expect(await readFile(target, "utf8")).toBe("outside\n");
    });
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
