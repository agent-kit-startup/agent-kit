import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROTECTED_PATHS } from "../manifest/types.js";
import { buildManifest, copyRegistryFile } from "./apply.js";
import { migrateLegacyOnboardCommand } from "./onboard-migration.js";
import { installL0 } from "./sync.js";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("lifecycle apply L3", () => {
  it("skips writing into protected L3 paths", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l3-"));
    await mkdir(path.join(project, ".cursor"), { recursive: true });
    await writeFile(path.join(project, ".cursor", "HANDOFF.md"), "local handoff\n", "utf8");

    const outcome = await copyRegistryFile(
      kitRoot,
      project,
      ".cursor/rules/ux-tone.mdc",
      ".cursor/HANDOFF.md",
      [...DEFAULT_PROTECTED_PATHS],
    );
    expect(outcome).toBe("skipped-protected");
    expect(await readFile(path.join(project, ".cursor", "HANDOFF.md"), "utf8")).toBe(
      "local handoff\n",
    );
  });

  it("installL0 writes core rules from the kit registry", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l0-"));
    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);
    expect(stats.written.some((p) => p.includes(".cursor/rules/"))).toBe(true);
    expect(stats.written.some((p) => p.includes(".cursor/commands/"))).toBe(true);
    expect(stats.written).toContain(".cursor/commands/agent-kit-onboard.md");
    expect(stats.written).not.toContain(".cursor/commands/onboard.md");
    expect(stats.written.some((p) => p === "autogit/gitupdate.md")).toBe(true);
    expect(stats.written.some((p) => p === "autogit/plan-routine.md")).toBe(true);
  });

  it("removes a managed legacy onboard command after installing the namespaced command", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-onboard-managed-"));
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });
    const legacyContent = "# Command: /onboard\n\nManaged legacy version.\n";
    await writeFile(path.join(project, ".cursor/commands/onboard.md"), legacyContent, "utf8");
    await writeFile(
      path.join(project, ".cursor/commands/agent-kit-onboard.md"),
      "# Command: /agent-kit-onboard\n",
      "utf8",
    );
    const managedHash = createHash("sha256").update(legacyContent).digest("hex");

    const migration = await migrateLegacyOnboardCommand(project, new Set([managedHash]));

    await expect(
      readFile(path.join(project, ".cursor/commands/onboard.md"), "utf8"),
    ).rejects.toThrow();
    expect(migration).toBe("removed-managed");
    expect(
      await readFile(path.join(project, ".cursor/commands/agent-kit-onboard.md"), "utf8"),
    ).toContain("# Command: /agent-kit-onboard");
  });

  it("preserves a customized legacy onboard command and reports the slash collision", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-onboard-custom-"));
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });
    await writeFile(
      path.join(project, ".cursor/commands/onboard.md"),
      "# Custom onboard\n",
      "utf8",
    );

    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);

    expect(await readFile(path.join(project, ".cursor/commands/onboard.md"), "utf8")).toBe(
      "# Custom onboard\n",
    );
    expect(stats.collisions).toContain(".cursor/commands/onboard.md");
  });

  it("installL0 writes external-review templates (not L3-blocked)", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l0-tpl-"));
    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);
    expect(
      stats.written.some((p) => p === ".cursor/context/templates/plan-external-review-prompt.md"),
    ).toBe(true);
    expect(stats.written.some((p) => p === ".cursor/context/config.example.json")).toBe(true);
    expect(stats.skippedProtected).not.toContain(
      ".cursor/context/templates/plan-external-review-prompt.md",
    );
  });

  it("copyRegistryFile reports unchanged when content matches", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-unchanged-"));
    const rel = ".cursor/rules/ux-tone.mdc";
    const outcome1 = await copyRegistryFile(kitRoot, project, rel, rel, []);
    expect(outcome1).toBe("written");
    const outcome2 = await copyRegistryFile(kitRoot, project, rel, rel, []);
    expect(outcome2).toBe("unchanged");
  });

  it("buildManifest preserves personalization and optional metadata", () => {
    const personalization = {
      contractVersion: 1,
      generatorVersion: "4.8.4",
      origin: "repository-profile" as const,
      resultPath: ".cursor/context/personalization.json",
    };
    const manifest = buildManifest({
      version: "4.8.4",
      profile: "ops",
      packs: ["clean-code"],
      skills: ["json-data-config"],
      protected: [".cursor/HANDOFF.md"],
      personalization,
      registryUrl: "https://github.com/agent-kit-startup/agent-kit",
      registryRef: "main",
    });
    expect(manifest.version).toBe("4.8.4");
    expect(manifest.personalization).toEqual(personalization);
    expect(manifest.registry).toEqual({
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    expect(manifest.protected).toContain(".cursor/HANDOFF.md");
  });
});
