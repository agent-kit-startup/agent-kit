import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAUDE_SETTINGS_LEDGER_REL,
  ClaudeSettingsLedgerInvalidError,
  ClaudeSettingsLedgerSymlinkError,
  loadClaudeSettingsLedger,
  saveClaudeSettingsLedger,
} from "./claude-settings-ledger.js";

let root: string;
let outside: string;
const file = () => path.join(root, CLAUDE_SETTINGS_LEDGER_REL);

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ak-ledger-root-"));
  outside = await mkdtemp(path.join(os.tmpdir(), "ak-ledger-out-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("claude settings ledger", () => {
  it("round-trips a sorted, deduped ledger", async () => {
    expect(await loadClaudeSettingsLedger(root)).toBeNull();
    const saved = await saveClaudeSettingsLedger(root, {
      denyRowsWritten: ["Bash(b)", "Bash(a)", "Bash(a)"],
      hookEntriesWritten: [
        { event: "SessionStart", marker: "m2" },
        { event: "PreToolUse", marker: "m1" },
        { event: "PreToolUse", marker: "m1" },
      ],
    });
    expect(saved).toEqual({
      schemaVersion: 1,
      denyRowsWritten: ["Bash(a)", "Bash(b)"],
      hookEntriesWritten: [
        { event: "PreToolUse", marker: "m1" },
        { event: "SessionStart", marker: "m2" },
      ],
    });
    expect(await loadClaudeSettingsLedger(root)).toEqual(saved);
    expect((await readFile(file(), "utf8")).endsWith("\n")).toBe(true);
  });

  it("only grows: later saves never remove earlier rows", async () => {
    await saveClaudeSettingsLedger(root, {
      denyRowsWritten: ["Bash(a)"],
      hookEntriesWritten: [{ event: "PreToolUse", marker: "m1" }],
    });
    const after = await saveClaudeSettingsLedger(root, { denyRowsWritten: ["Bash(c)"] });
    expect(after.denyRowsWritten).toEqual(["Bash(a)", "Bash(c)"]);
    expect(after.hookEntriesWritten).toEqual([{ event: "PreToolUse", marker: "m1" }]);
    const again = await saveClaudeSettingsLedger(root, {});
    expect(again).toEqual(after);
  });

  it("refuses a symlinked ledger leaf, dangling symlink, and symlinked parent", async () => {
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(path.join(outside, "x.json"), "{}");
    await symlink(path.join(outside, "x.json"), file());
    await expect(loadClaudeSettingsLedger(root)).rejects.toBeInstanceOf(
      ClaudeSettingsLedgerSymlinkError,
    );
    await expect(saveClaudeSettingsLedger(root, {})).rejects.toBeInstanceOf(
      ClaudeSettingsLedgerSymlinkError,
    );
    expect(await readFile(path.join(outside, "x.json"), "utf8")).toBe("{}");

    await rm(file());
    await symlink(path.join(outside, "missing.json"), file());
    await expect(saveClaudeSettingsLedger(root, {})).rejects.toBeInstanceOf(
      ClaudeSettingsLedgerSymlinkError,
    );

    await rm(path.join(root, ".cursor"), { recursive: true });
    await symlink(outside, path.join(root, ".cursor"));
    await expect(saveClaudeSettingsLedger(root, {})).rejects.toBeInstanceOf(
      ClaudeSettingsLedgerSymlinkError,
    );
  });

  it("treats malformed JSON and unknown schemaVersion as no ledger, never overwriting", async () => {
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    for (const raw of [
      "{nope",
      JSON.stringify({ schemaVersion: 2, denyRowsWritten: [], hookEntriesWritten: [] }),
      "[]",
    ]) {
      await writeFile(file(), raw);
      expect(await loadClaudeSettingsLedger(root)).toBeNull();
      await expect(
        saveClaudeSettingsLedger(root, { denyRowsWritten: ["Bash(a)"] }),
      ).rejects.toBeInstanceOf(ClaudeSettingsLedgerInvalidError);
      expect(await readFile(file(), "utf8")).toBe(raw);
    }
    const saved = await saveClaudeSettingsLedger(
      root,
      { denyRowsWritten: ["Bash(a)"] },
      { overwriteInvalid: true },
    );
    expect(saved.denyRowsWritten).toEqual(["Bash(a)"]);
  });
});
