import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentKitManifest } from "./index.js";
import { ManifestValidationError, parseAgentKitManifest } from "./parse.js";

describe("parseAgentKitManifest", () => {
  it("accepts a minimal valid manifest", () => {
    const m = parseAgentKitManifest({ schemaVersion: 1, version: "3.0.0" });
    expect(m).toEqual({ schemaVersion: 1, version: "3.0.0" });
  });

  it("accepts full dogfood shape and strips $schema", () => {
    const m = parseAgentKitManifest({
      $schema: "./schemas/agent-kit.manifest.schema.json",
      schemaVersion: 1,
      version: "3.0.0",
      profile: "default",
      packs: ["clean-code"],
      skills: ["json-data-config"],
      protected: [".cursor/HANDOFF.md"],
      overrides: [{ path: ".cursor/rules/domain.mdc", replaces: ".cursor/rules/ux-tone.mdc" }],
      registry: { url: "https://example.com", ref: "main" },
      personalization: {
        contractVersion: 1,
        generatorVersion: "4.4.7",
        origin: "repository-profile",
        resultPath: ".cursor/context/personalization.json",
      },
      installedAt: "2026-07-16T00:00:00.000Z",
    });
    expect(m.packs).toEqual(["clean-code"]);
    expect(m.skills).toEqual(["json-data-config"]);
    expect(m.overrides?.[0]?.path).toBe(".cursor/rules/domain.mdc");
    expect(m.personalization?.origin).toBe("repository-profile");
  });

  it("rejects bad semver", () => {
    expect(() => parseAgentKitManifest({ schemaVersion: 1, version: "v3" })).toThrow(
      ManifestValidationError,
    );
  });

  it("accepts an unknown top-level field with one warning (forward-compat)", () => {
    const warnings: string[] = [];
    const m = parseAgentKitManifest({ schemaVersion: 1, version: "3.0.0", extra: true }, warnings);
    expect(m).toEqual({ schemaVersion: 1, version: "3.0.0", unknownFields: { extra: true } });
    expect(warnings).toEqual(["unknown field: extra"]);
  });

  it("still rejects a known field with a wrong type, next to an unknown field", () => {
    const warnings: string[] = [];
    let caught: unknown;
    try {
      parseAgentKitManifest(
        { schemaVersion: 1, version: "3.0.0", registry: { url: 42 }, extra: true },
        warnings,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ManifestValidationError);
    expect((caught as ManifestValidationError).issues).toEqual(["registry.url must be a string"]);
  });

  it("rejects invalid pack ids", () => {
    expect(() =>
      parseAgentKitManifest({ schemaVersion: 1, version: "3.0.0", packs: ["Clean_Code"] }),
    ).toThrow(ManifestValidationError);
  });
});

describe("loadAgentKitManifest", () => {
  it("passes unknown-field warnings to onWarning and still loads", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-manifest-"));
    try {
      await mkdir(path.join(dir, ".cursor"), { recursive: true });
      await writeFile(
        path.join(dir, ".cursor", "agent-kit.json"),
        JSON.stringify({ schemaVersion: 1, version: "3.0.0", futureField: {} }),
      );
      const seen: string[] = [];
      const m = await loadAgentKitManifest(dir, { onWarning: (w) => seen.push(w) });
      expect(m?.version).toBe("3.0.0");
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain("unknown field: futureField");
      expect(seen[0]).toContain("kept, but not understood by this CLI");
      expect(m?.unknownFields).toEqual({ futureField: {} });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
