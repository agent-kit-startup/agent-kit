import { describe, expect, it } from "vitest";
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
      installedAt: "2026-07-16T00:00:00.000Z",
    });
    expect(m.packs).toEqual(["clean-code"]);
    expect(m.skills).toEqual(["json-data-config"]);
    expect(m.overrides?.[0]?.path).toBe(".cursor/rules/domain.mdc");
  });

  it("rejects bad semver and unknown fields", () => {
    expect(() => parseAgentKitManifest({ schemaVersion: 1, version: "v3" })).toThrow(
      ManifestValidationError,
    );
    try {
      parseAgentKitManifest({ schemaVersion: 1, version: "3.0.0", extra: true });
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as ManifestValidationError).issues.some((i) => i.includes("unknown"))).toBe(true);
    }
  });

  it("rejects invalid pack ids", () => {
    expect(() =>
      parseAgentKitManifest({ schemaVersion: 1, version: "3.0.0", packs: ["Clean_Code"] }),
    ).toThrow(ManifestValidationError);
  });
});
