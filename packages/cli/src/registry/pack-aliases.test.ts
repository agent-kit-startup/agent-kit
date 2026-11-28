import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOMAIN_PACK_IDS } from "../manifest/index.js";
import { canonicalizePackIds, findPack, loadRegistry, resolvePackSummary } from "./client.js";
import {
  formatPackIdRewrite,
  LEGACY_PACK_ID_ALIASES,
  legacyPackIdTarget,
  UnknownPackError,
} from "./pack-aliases.js";

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Registry pinned to a ref that still ships the pre-rename id. */
async function legacyRegistry(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ak-pack-alias-legacy-"));
  await mkdir(path.join(root, "registry"), { recursive: true });
  await writeFile(
    path.join(root, "registry/registry.json"),
    JSON.stringify({
      skills: { core: [], community: [] },
      packs: [
        {
          id: "gestao-contexto",
          title: "Context",
          description: "Old id.",
          version: "0.1.0",
          path: "registry/packs/gestao-contexto",
        },
      ],
    }),
  );
  return root;
}

describe("LEGACY_PACK_ID_ALIASES", () => {
  it("maps the three ADR 2026-07-19 renames onto current L1 pack ids", () => {
    expect(LEGACY_PACK_ID_ALIASES).toEqual({
      "gestao-projeto": "project-management",
      "gestao-contexto": "context-management",
      "engenharia-arquitetura": "engineering-architecture",
    });
    for (const target of Object.values(LEGACY_PACK_ID_ALIASES)) {
      expect(DOMAIN_PACK_IDS).toContain(target);
    }
    expect(legacyPackIdTarget("gestao-contexto")).toBe("context-management");
    expect(legacyPackIdTarget("toString")).toBeUndefined();
    expect(legacyPackIdTarget("clean-code")).toBeUndefined();
  });

  it("formats one rewrite line naming both ids and the manifest", () => {
    expect(formatPackIdRewrite({ from: "gestao-contexto", to: "context-management" })).toBe(
      "Pack id 'gestao-contexto' renamed to 'context-management' in .cursor/agent-kit.json (legacy L1 pack id).",
    );
  });
});

describe("pack lookup with legacy aliases", () => {
  it("findPack resolves every legacy id against the real registry", async () => {
    for (const [legacy, current] of Object.entries(LEGACY_PACK_ID_ALIASES)) {
      expect((await findPack(KIT_ROOT, legacy)).id).toBe(current);
    }
  });

  it("findPack throws a named UnknownPackError with the next step for an unknown id", async () => {
    const err = await findPack(KIT_ROOT, "ghost-pack").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownPackError);
    const message = (err as Error).message;
    expect(message).toContain("Unknown pack 'ghost-pack'");
    expect(message).toContain("context-management");
    expect(message).toContain("Next: replace or remove 'ghost-pack'");
  });

  it("an exact registry id wins over the alias", async () => {
    const index = await loadRegistry(await legacyRegistry());
    expect(resolvePackSummary(index, "gestao-contexto")?.id).toBe("gestao-contexto");
  });

  it("canonicalizePackIds rewrites legacy ids, dedupes, and keeps unknown ids", async () => {
    const result = await canonicalizePackIds(KIT_ROOT, [
      "clean-code",
      "gestao-contexto",
      "context-management",
      "ghost-pack",
    ]);
    expect(result.packs).toEqual(["clean-code", "context-management", "ghost-pack"]);
    expect(result.rewrites).toEqual([{ from: "gestao-contexto", to: "context-management" }]);
    expect(result.unknown).toEqual(["ghost-pack"]);
    expect(result.knownIds).toContain("project-management");
    expect((await canonicalizePackIds(KIT_ROOT, undefined)).packs).toBeUndefined();
  });
});
