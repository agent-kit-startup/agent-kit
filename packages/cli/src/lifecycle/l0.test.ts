import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { L0_ARTIFACTS } from "./l0.js";
import { KIT_VERSION } from "./version.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

async function repositoryFileExists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(REPOSITORY_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function expectUnique(values: readonly string[], label: string): void {
  expect(new Set(values).size, `${label} contains duplicate entries`).toBe(values.length);
}

function artifactPair(source: string, target: string): string {
  return `${source}\0${target}`;
}

function parsePortBArtifacts(section: string): Array<{ source: string; target: string }> {
  return [...section.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)].map((match) => {
    const target = match[1] ?? "";
    const sourceCell = match[2]?.trim() ?? "";
    const explicitSource = sourceCell.match(/^`([^`]+)`/)?.[1];
    return {
      source: sourceCell.startsWith("idem") ? target : (explicitSource ?? ""),
      target,
    };
  });
}

describe("canonical L0 inventory", () => {
  it("contains the required HITL rule and planning templates", () => {
    const targets = L0_ARTIFACTS.map((artifact) => artifact.target);
    expect(targets).toEqual(
      expect.arrayContaining([
        ".cursor/rules/hitl-ask-questions.mdc",
        ".cursor/commands/agent-kit-onboard.md",
        ".cursor/context/templates/plan.md",
        ".cursor/context/templates/context-pack.md",
        ".cursor/context/templates/task-brief.md",
        ".cursor/context/templates/handoff.md",
        ".cursor/context/templates/adr.md",
      ]),
    );
    expect(targets).not.toContain(".cursor/commands/onboard.md");
  });

  it("keeps the onboarding command on the repository-readiness contract", async () => {
    const command = await readRepositoryFile(".cursor/commands/agent-kit-onboard.md");

    expect(command).toContain("agent-kit doctor --json");
    expect(command).toContain(".cursor/context/readiness.json");
    expect(command).toContain("Ask one concrete Ask questions question at a time");
    expect(command).toContain("pillars[].checks[]");
    expect(command).toContain("essential: true");
    expect(command).toContain("Do not treat `pendingActions` as an essential-only queue");
    expect(command).toContain("Essential checks cannot be completed by deferral");
    expect(command).toContain('status: "blocked"` cannot be deferred');
    expect(command).toContain('leave `onboarding.status: "in_progress"` and `onboarded` unchanged');
    const finalDoctor = command.indexOf(
      "Run `agent-kit doctor --json` once more and read the refreshed report",
    );
    const persistCompletion = command.indexOf(
      'merge `onboarding.status: "completed"` and `onboarded: true`',
    );
    expect(finalDoctor).toBeGreaterThan(-1);
    expect(persistCompletion).toBeGreaterThan(finalDoctor);
    expect(command).toContain("exactly one call to action");
    expect(command).toContain("Next: /start-project");
    expect(command).not.toContain("Pick a workspace skin");
    expect(command).not.toContain("Enable Claude external review");
  });

  it("keeps registry and Port B install sources aligned with the canonical inventory", async () => {
    const [registryText, installText] = await Promise.all([
      readRepositoryFile("registry/registry.json"),
      readRepositoryFile("install.md"),
    ]);
    const registry = JSON.parse(registryText) as {
      artifacts: Array<{ path: string; layer?: string; kind?: string; id?: string }>;
    };
    const canonicalSources = L0_ARTIFACTS.map((artifact) => artifact.source);
    const canonicalTargets = L0_ARTIFACTS.map((artifact) => artifact.target);
    const canonicalPairs = L0_ARTIFACTS.map((artifact) =>
      artifactPair(artifact.source, artifact.target),
    );
    const registryL0Paths = registry.artifacts
      .filter((artifact) => artifact.layer === "L0")
      .map((artifact) => artifact.path);
    const portBSection =
      installText.split("### 2. L0 content")[1]?.split("### 3. Manifest")[0] ?? "";
    const portBArtifacts = parsePortBArtifacts(portBSection);
    const portBSources = portBArtifacts.map((artifact) => artifact.source);
    const portBTargets = portBArtifacts.map((artifact) => artifact.target);
    const portBPairs = portBArtifacts.map((artifact) =>
      artifactPair(artifact.source, artifact.target),
    );
    const requiredRuleTargets = [
      ".cursor/rules/hitl-ask-questions.mdc",
      ".cursor/rules/docs-professional-standard.mdc",
      ".cursor/rules/memory-loop.mdc",
    ];
    const requiredTemplateTargets = [
      ".cursor/context/templates/plan.md",
      ".cursor/context/templates/context-pack.md",
      ".cursor/context/templates/task-brief.md",
      ".cursor/context/templates/handoff.md",
      ".cursor/context/templates/adr.md",
    ];

    expectUnique(canonicalSources, "canonical L0 sources");
    expectUnique(canonicalTargets, "canonical L0 targets");
    expectUnique(canonicalPairs, "canonical L0 mappings");
    expectUnique(registryL0Paths, "registry L0 paths");
    expectUnique(portBSources, "Port B sources");
    expectUnique(portBTargets, "Port B targets");
    expectUnique(portBPairs, "Port B mappings");

    expect(sorted(portBPairs)).toEqual(sorted(canonicalPairs));
    expect(canonicalTargets).toEqual(expect.arrayContaining(requiredRuleTargets));
    expect(canonicalTargets).toEqual(expect.arrayContaining(requiredTemplateTargets));
    expect(
      registry.artifacts.some((artifact) => artifact.path.endsWith("commands/onboard.md")),
    ).toBe(false);
    expect(registry.artifacts.some((artifact) => artifact.id === "onboard")).toBe(false);
    expect(
      registry.artifacts.some(
        (artifact) => artifact.id === "agent-kit-onboard" && artifact.kind === "command",
      ),
    ).toBe(true);

    for (const source of canonicalSources) {
      expect(await repositoryFileExists(source), `missing L0 source: ${source}`).toBe(true);
    }
  });

  it("uses the published package version across runtime manifests", async () => {
    const [rootPackage, cliPackage, manifest, plugin] = await Promise.all([
      readRepositoryFile("package.json"),
      readRepositoryFile("packages/cli/package.json"),
      readRepositoryFile(".cursor/agent-kit.json"),
      readRepositoryFile(".cursor-plugin/plugin.json"),
    ]);

    expect(KIT_VERSION).toBe(JSON.parse(cliPackage).version);
    expect(JSON.parse(rootPackage).version).toBe(KIT_VERSION);
    expect(JSON.parse(manifest).version).toBe(KIT_VERSION);
    expect(JSON.parse(plugin).version).toBe(KIT_VERSION);
  });
});
