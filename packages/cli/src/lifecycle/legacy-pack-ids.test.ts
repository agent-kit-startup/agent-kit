import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAgentKitManifest } from "../manifest/index.js";
import type { AgentKitManifest } from "../manifest/types.js";
import { diffAgainstRegistry } from "./diff.js";
import { syncFromManifest } from "./sync.js";
import { managedPairs } from "./targets.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(here, "../../../..");

/** A manifest written by kit v3.0.0, before the L1 pack ids became English. */
async function v3Manifest(extraPacks: string[] = []): Promise<AgentKitManifest> {
  const raw = JSON.parse(
    await readFile(path.join(here, "fixtures/agent-kit-manifest-v3.0.0.json"), "utf8"),
  );
  raw.packs = [...raw.packs, ...extraPacks];
  return parseAgentKitManifest(raw);
}

describe("legacy pack ids in a v3.0.0 manifest", () => {
  it("managedPairs resolves legacy ids and lists an unknown id instead of throwing", async () => {
    const manifest = await v3Manifest(["ghost-pack"]);
    const { pairs, missingPacks } = await managedPairs(KIT_ROOT, manifest);
    const canonical = await managedPairs(KIT_ROOT, {
      ...manifest,
      packs: ["clean-code", "context-management", "project-management"],
    });
    expect(missingPacks).toEqual(["ghost-pack"]);
    expect(pairs).toEqual(canonical.pairs);
  });

  it("diffAgainstRegistry reports an unknown pack as a missing-registry row", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "ak-legacy-pack-diff-"));
    const entries = await diffAgainstRegistry(KIT_ROOT, project, await v3Manifest(["ghost-pack"]));
    expect(entries).toContainEqual({ path: "pack:ghost-pack", status: "missing-registry" });
    expect(entries.some((e) => e.path.startsWith("pack:gestao"))).toBe(false);
  });

  it("syncFromManifest installs legacy packs and warns once for an unknown id", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "ak-legacy-pack-sync-"));
    const warnings: string[] = [];
    const stats = await syncFromManifest(KIT_ROOT, project, await v3Manifest(["ghost-pack"]), {
      onWarning: (message) => warnings.push(message),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Unknown pack 'ghost-pack'");
    expect(warnings[0]).toContain("Next:");
    expect(stats.missing).toContain("pack:ghost-pack");
    expect(stats.written.length).toBeGreaterThan(0);
  }, 30_000);
});
