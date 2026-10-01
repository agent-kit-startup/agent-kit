import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROTECTED_PATHS } from "../manifest/types.js";
import type { AgentKitManifest } from "../manifest/types.js";
import { MANAGED_HASHES_REL } from "./overlay.js";
import { syncFromManifest } from "./sync.js";

const ledgerIo = vi.hoisted(() => ({ loads: 0, saves: 0 }));

vi.mock("./overlay.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./overlay.js")>();
  return {
    ...actual,
    loadManagedHashLedger: async (...args: Parameters<typeof actual.loadManagedHashLedger>) => {
      ledgerIo.loads += 1;
      return actual.loadManagedHashLedger(...args);
    },
    saveManagedHashLedger: async (...args: Parameters<typeof actual.saveManagedHashLedger>) => {
      ledgerIo.saves += 1;
      return actual.saveManagedHashLedger(...args);
    },
  };
});

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("syncFromManifest managed-hash ledger I/O", () => {
  it("reads and writes the ledger once for L0 + 2 packs + 2 skills", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-sync-ledger-"));
    const manifest: AgentKitManifest = {
      schemaVersion: 1,
      version: "0.0.0-test",
      protected: [...DEFAULT_PROTECTED_PATHS],
      packs: ["clean-code", "quality"],
      skills: ["clickup", "cursor-skills-node"],
    };
    ledgerIo.loads = 0;
    ledgerIo.saves = 0;

    const stats = await syncFromManifest(kitRoot, project, manifest);

    expect(ledgerIo).toEqual({ loads: 1, saves: 1 });
    expect(stats.written.some((p) => p.includes("/clickup/"))).toBe(true);
    const ledger = JSON.parse(await readFile(path.join(project, MANAGED_HASHES_REL), "utf8"));
    expect(Object.keys(ledger.hashes)).toContain(".cursor/skills/community/clickup/SKILL.md");
  });
});
