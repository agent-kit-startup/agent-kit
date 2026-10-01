import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../lifecycle/apply.js";
import { loadRegistry } from "../registry/client.js";
import { loadPackManifest, packMemberTargets } from "../registry/install.js";
import { executeSafeReadinessFixes } from "../scanner/safe-fixes.js";
import type { RepositoryProfile } from "../types.js";
import { fileExists } from "../utils/fs.js";
import {
  applyPersonalization,
  buildPersonalizationPlan,
  readRepositoryProfile,
  renderProjectContext,
} from "./personalization.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const GENERATED_AT = "2026-07-24T12:00:00.000Z";

async function preparedNodeRepository(): Promise<{
  root: string;
  profile: RepositoryProfile;
  report: Awaited<ReturnType<typeof executeSafeReadinessFixes>>["after"];
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-personalization-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      packageManager: "npm@10.0.0",
      scripts: { test: "vitest run", lint: "biome check ." },
    }),
  );
  await writeFile(path.join(root, "package-lock.json"), "{}");
  const execution = await executeSafeReadinessFixes(root, {
    generatorVersion: "test",
    generatedAt: GENERATED_AT,
  });
  const profile = await readRepositoryProfile(root);
  if (!profile) throw new Error("profile was not generated");
  return { root, profile, report: execution.after };
}

describe("repository personalization", () => {
  it("selects a minimal evidence-based component set", async () => {
    const { profile, report } = await preparedNodeRepository();
    const registry = await loadRegistry(REPOSITORY_ROOT);
    const plan = buildPersonalizationPlan(profile, report, registry);

    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "skill", id: "cursor-skills-node", status: "applied" }),
        expect.objectContaining({ kind: "pack", id: "quality", status: "applied" }),
      ]),
    );
    expect(plan.map((item) => item.id)).not.toEqual(
      expect.arrayContaining(["n8n-workflows", "sql-postgres", "cybersec", "project-management"]),
    );
    expect(plan.every((item) => item.evidence.length > 0)).toBe(true);
  });

  it("keeps uncertain integrations behind confirmation and reports missing catalog entries", async () => {
    const { profile, report } = await preparedNodeRepository();
    profile.services.projectManagement = ["clickup"];
    const registry = await loadRegistry(REPOSITORY_ROOT);
    const withoutNode = {
      ...registry,
      skills: {
        ...registry.skills,
        community: registry.skills.community.filter((skill) => skill.id !== "cursor-skills-node"),
      },
    };
    const plan = buildPersonalizationPlan(profile, report, withoutNode);

    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pack",
          id: "project-management",
          status: "recommended-confirmation",
        }),
        expect.objectContaining({
          kind: "skill",
          id: "cursor-skills-node",
          status: "unavailable",
        }),
      ]),
    );
  });

  it("preserves customized files and registers generated ownership", async () => {
    const { root, profile, report } = await preparedNodeRepository();
    const registry = await loadRegistry(REPOSITORY_ROOT);
    await writeFile(path.join(root, "AGENTS.md"), "# Existing guidance\n");

    const applied = await applyPersonalization({
      rootDir: root,
      registryRoot: REPOSITORY_ROOT,
      profile,
      report,
      registry,
      manifest: buildManifest({ version: "4.4.7" }),
      generatorVersion: "4.4.7",
    });

    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("# Existing guidance\n");
    expect(applied.result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "AGENTS.md",
          status: "skipped-customized",
        }),
      ]),
    );
    expect(applied.manifest.protected).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        ".cursor/project-context.md",
        "CLAUDE.md",
        ".claude/commands/agent-kit.md",
      ]),
    );
    expect(applied.manifest.personalization).toEqual(
      expect.objectContaining({
        contractVersion: 1,
        generatorVersion: "4.4.7",
        origin: "repository-profile",
      }),
    );
    expect(await fileExists(path.join(root, ".cursor/context/personalization.json"))).toBe(true);
  });

  it("does not protect freshly installed skills or pack targets", async () => {
    const { root, profile, report } = await preparedNodeRepository();
    const registry = await loadRegistry(REPOSITORY_ROOT);

    const applied = await applyPersonalization({
      rootDir: root,
      registryRoot: REPOSITORY_ROOT,
      profile,
      report,
      registry,
      manifest: buildManifest({ version: "4.4.7" }),
      generatorVersion: "4.4.7",
    });

    expect(applied.manifest.skills).toContain("cursor-skills-node");
    expect(applied.manifest.packs).toContain("quality");
    const quality = applied.result.items.find((item) => item.kind === "pack");
    expect(quality?.status).toBe("applied");
    const packTargets = (await loadPackManifest(REPOSITORY_ROOT, "quality")).members.map(
      (member) => packMemberTargets(member).targetRel,
    );
    expect(packTargets.length).toBeGreaterThan(0);
    const protectedPaths = applied.manifest.protected ?? [];
    expect(protectedPaths.filter((p) => p.startsWith(".cursor/skills/"))).toEqual([]);
    expect(protectedPaths.filter((p) => packTargets.includes(p))).toEqual([]);
  });

  it("detects an edited skill companion of a pack member as customized", async () => {
    const { root, profile, report } = await preparedNodeRepository();
    // Fixture registry: the planned `quality` pack ships one skill whose
    // directory carries a companion file next to SKILL.md.
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-kit-personalization-reg-"));
    const skillDir = path.join(registryRoot, "registry/skills/community/demo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# Demo\n\n[checklist](checklist.md)\n");
    await writeFile(path.join(skillDir, "checklist.md"), "# Registry checklist\n");
    const packDir = path.join(registryRoot, "registry/packs/quality");
    await mkdir(packDir, { recursive: true });
    await writeFile(
      path.join(packDir, "pack.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "quality",
        title: "Quality",
        description: "Fixture pack.",
        version: "0.1.0",
        members: [{ kind: "skill", id: "demo", source: "registry/skills/community/demo" }],
      }),
    );
    const registry = {
      skills: { core: [], community: [] },
      packs: [
        {
          id: "quality",
          title: "Quality",
          description: "Fixture pack.",
          version: "0.1.0",
          path: "registry/packs/quality",
        },
      ],
    } as unknown as Awaited<ReturnType<typeof loadRegistry>>;
    await writeFile(path.join(registryRoot, "registry/registry.json"), JSON.stringify(registry));

    const companion = ".cursor/skills/community/demo/checklist.md";
    await mkdir(path.join(root, path.dirname(companion)), { recursive: true });
    await writeFile(path.join(root, companion), "# Edited locally\n");

    const applied = await applyPersonalization({
      rootDir: root,
      registryRoot,
      profile,
      report,
      registry,
      manifest: buildManifest({ version: "4.4.7" }),
      generatorVersion: "4.4.7",
    });

    const quality = applied.result.items.find((item) => item.kind === "pack");
    expect(quality?.status).toBe("skipped-customized");
    expect(applied.manifest.protected).toContain(companion);
    expect(applied.manifest.protected).not.toContain(".cursor/skills/community/demo/SKILL.md");
    expect(await readFile(path.join(root, companion), "utf8")).toBe("# Edited locally\n");
  });

  it("does not generate .claude/commands/*.md adapters by default (opt-in only, byte-identical L0)", async () => {
    const { root, profile, report } = await preparedNodeRepository();
    const registry = await loadRegistry(REPOSITORY_ROOT);
    await mkdir(path.join(root, ".cursor/commands"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor/commands/foo.md"),
      "---\nname: foo\ndescription: Foo command.\n---\n\nBody.\n",
      "utf8",
    );

    const applied = await applyPersonalization({
      rootDir: root,
      registryRoot: REPOSITORY_ROOT,
      profile,
      report,
      registry,
      manifest: buildManifest({ version: "4.4.7" }),
      generatorVersion: "4.4.7",
    });

    expect(await fileExists(path.join(root, ".claude/commands/foo.md"))).toBe(false);
    expect(await fileExists(path.join(root, ".claude/settings.json"))).toBe(false);
    expect(applied.result.items.some((item) => item.id === ".claude/commands/foo.md")).toBe(false);
    expect(applied.result.items.some((item) => item.id === ".claude/settings.json")).toBe(false);
  });

  it("generates .claude/commands/*.md adapters and merges the SessionStart hook when opted in", async () => {
    const { root, profile, report } = await preparedNodeRepository();
    const registry = await loadRegistry(REPOSITORY_ROOT);
    await mkdir(path.join(root, ".cursor/commands"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor/commands/foo.md"),
      "---\nname: foo\ndescription: Foo command.\n---\n\nBody.\n",
      "utf8",
    );

    const applied = await applyPersonalization({
      rootDir: root,
      registryRoot: REPOSITORY_ROOT,
      profile,
      report,
      registry,
      manifest: buildManifest({ version: "4.4.7" }),
      generatorVersion: "4.4.7",
      claudeAdapters: true,
    });

    const adapterPath = path.join(root, ".claude/commands/foo.md");
    expect(await fileExists(adapterPath)).toBe(true);
    expect(await readFile(adapterPath, "utf8")).toContain(
      "Read `.cursor/commands/foo.md` now and follow that contract exactly",
    );
    expect(applied.result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ".claude/commands/foo.md", status: "applied" }),
        expect.objectContaining({ id: ".claude/settings.json", status: "applied" }),
      ]),
    );
    expect(applied.manifest.protected).toEqual(
      expect.arrayContaining([".claude/commands/foo.md", ".claude/settings.json"]),
    );
    const settings = JSON.parse(await readFile(path.join(root, ".claude/settings.json"), "utf8"));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain(
      "hook session-start --format claude",
    );
    expect(applied.result.claudeSessionStartInstructions).toBeUndefined();
    const preToolUse = settings.hooks.PreToolUse as Array<{
      matcher?: string;
      hooks: Array<{ command: string }>;
    }>;
    const guardGroup = preToolUse.find((g) => g.matcher === "Bash");
    expect(guardGroup?.hooks[0]?.command).toContain("guard shell --format claude");
  });

  it("omits unverified provider and legacy version claims", async () => {
    const { root, profile, report } = await preparedNodeRepository();
    const registry = await loadRegistry(REPOSITORY_ROOT);
    profile.git.provider = undefined;
    profile.git.providerEvidence = [];

    await applyPersonalization({
      rootDir: root,
      registryRoot: REPOSITORY_ROOT,
      profile,
      report,
      registry,
      manifest: buildManifest({ version: "4.4.7" }),
      generatorVersion: "4.4.7",
    });
    const context = await readFile(path.join(root, ".cursor/project-context.md"), "utf8");

    expect(context).not.toContain("GitHub");
    expect(context).not.toContain("Agent Kit v3");
  });

  it("keeps start-project focused on the deliverable after readiness", async () => {
    const command = await readFile(
      path.join(REPOSITORY_ROOT, ".cursor/commands/start-project.md"),
      "utf8",
    );

    expect(command).toContain(".cursor/agent-kit.config.json");
    expect(command).toContain(".cursor/context/readiness.json");
    expect(command).toContain("Ask only for the deliverable goal");
    expect(command).toContain("point to `/agent-kit-onboard`");
    expect(command).toContain("essential: true");
    expect(command).toContain("Do **not** treat `pendingActions` as an essential-only queue");
    expect(command).toContain("confirm-provider");
    expect(command).toContain("warnings only");
  });

  it("fills Relevant skills from installed components instead of a hardcoded empty row", async () => {
    const { root, profile, report } = await preparedNodeRepository();
    const registry = await loadRegistry(REPOSITORY_ROOT);

    await applyPersonalization({
      rootDir: root,
      registryRoot: REPOSITORY_ROOT,
      profile,
      report,
      registry,
      manifest: buildManifest({ version: "4.4.7" }),
      generatorVersion: "4.4.7",
    });
    const context = await readFile(path.join(root, ".cursor/project-context.md"), "utf8");

    expect(context).toContain("cursor-skills-node");
    expect(context).not.toContain(
      "Add rows when `/agent-kit-onboard` scaffolds domain skills or personalization installs packs",
    );
    expect(context).not.toMatch(/\|\s*\(none yet\)\s*\|/);
  });

  it("emits a generated empty Relevant skills row when no skills are installed", async () => {
    const { profile } = await preparedNodeRepository();
    const context = renderProjectContext(profile, []);

    expect(context).toContain("| (none yet) | No installed or project-owned skills detected | — |");
    expect(context).not.toContain(
      "Add rows when `/agent-kit-onboard` scaffolds domain skills or personalization installs packs",
    );
  });
});
