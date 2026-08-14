import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../lifecycle/apply.js";
import { loadRegistry } from "../registry/client.js";
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
