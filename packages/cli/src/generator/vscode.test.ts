import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectProfile } from "../types.js";
import { fileExists } from "../utils/fs.js";
import { generateVSCodeArtifacts } from "./vscode.js";

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "ak-vscode-"));
}

function minimalProfile(
  rootDir: string,
  idePlan: "vscode-pro" | "default" = "vscode-pro",
): ProjectProfile {
  return {
    rootDir,
    stack: {
      language: "node",
      workspaces: false,
      testCommands: [],
      validationCommands: [],
      hasProjectFiles: true,
    },
    git: {
      providerKind: "unknown",
      providerConfidence: "low",
      providerEvidence: [],
      remotes: [],
      mode: "none",
      workflow: "unknown",
      isDirty: false,
      hasLocalStaging: false,
      hasRemoteStaging: false,
    },
    ide: { ide: "vscode", plan: idePlan },
    infra: {
      docker: false,
      kubernetes: false,
      ci: "none",
      ciFiles: [],
      infrastructureFiles: [],
      deploymentFiles: [],
    },
    services: {},
    installHooks: false,
    selectedCoreComponents: [],
  };
}

describe("generateVSCodeArtifacts", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir();
  });

  afterEach(async () => {
    // Temp directories are left for the OS to clean; no teardown needed.
  });

  it("writes VS Code and Copilot instructions on first run", async () => {
    const profile = minimalProfile(root);
    const results = await generateVSCodeArtifacts(profile);

    expect(results).toEqual(
      expect.arrayContaining([
        { relativePath: ".vscode/settings.json", status: "applied" },
        { relativePath: ".github/copilot-instructions.md", status: "applied" },
        { relativePath: ".vscode/security-review.agent.md", status: "applied" },
      ]),
    );

    const settings = await readFile(path.join(root, ".vscode", "settings.json"), "utf8");
    expect(settings).toContain("editor.formatOnSave");

    const copilot = await readFile(path.join(root, ".github", "copilot-instructions.md"), "utf8");
    expect(copilot).toContain("Conventional Commits");

    const security = await readFile(path.join(root, ".vscode", "security-review.agent.md"), "utf8");
    expect(security).toContain("Security Review Agent");
  });

  it("skips existing consumer files without overwriting them", async () => {
    const profile = minimalProfile(root);
    await mkdir(path.join(root, ".vscode"), { recursive: true });
    await mkdir(path.join(root, ".github"), { recursive: true });
    await writeFile(path.join(root, ".vscode", "settings.json"), '{"existing": true}\n', "utf8");
    await writeFile(path.join(root, ".github", "copilot-instructions.md"), "# Existing\n", "utf8");

    const results = await generateVSCodeArtifacts(profile);

    expect(results).toContainEqual({
      relativePath: ".vscode/settings.json",
      status: "skipped-customized",
    });
    expect(results).toContainEqual({
      relativePath: ".github/copilot-instructions.md",
      status: "skipped-customized",
    });

    const settings = await readFile(path.join(root, ".vscode", "settings.json"), "utf8");
    expect(settings).toContain("existing");
    expect(settings).not.toContain("formatOnSave");

    const copilot = await readFile(path.join(root, ".github", "copilot-instructions.md"), "utf8");
    expect(copilot).toContain("Existing");
    expect(copilot).not.toContain("Conventional Commits");
  });

  it("writes the security-review artifact only for the vscode-pro plan", async () => {
    const freeProfile = minimalProfile(root, "default");
    const results = await generateVSCodeArtifacts(freeProfile);

    expect(results).not.toContainEqual(
      expect.objectContaining({ relativePath: ".vscode/security-review.agent.md" }),
    );
    expect(await fileExists(path.join(root, ".vscode", "security-review.agent.md"))).toBe(false);
  });

  it("returns an empty result for non-vscode-pro plans and skips the security file", async () => {
    const freeProfile = minimalProfile(root, "default");
    const results = await generateVSCodeArtifacts(freeProfile);

    expect(results).toEqual(
      expect.arrayContaining([
        { relativePath: ".vscode/settings.json", status: "applied" },
        { relativePath: ".github/copilot-instructions.md", status: "applied" },
      ]),
    );
    expect(results.length).toBe(2);
  });
});
