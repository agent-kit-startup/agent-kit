import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectProfile } from "../types.js";
import { ensureDir, fileExists } from "../utils/fs.js";
import { gitProviderLabel, prTerminology } from "./platform.js";

export interface VSCodeArtifactResult {
  relativePath: string;
  status: "applied" | "skipped-customized";
}

export async function generateVSCodeArtifacts(
  profile: ProjectProfile,
): Promise<VSCodeArtifactResult[]> {
  const results: VSCodeArtifactResult[] = [];
  const vscodeDir = path.join(profile.rootDir, ".vscode");
  const githubDir = path.join(profile.rootDir, ".github");
  await Promise.all([ensureDir(vscodeDir), ensureDir(githubDir)]);

  const settingsPath = path.join(vscodeDir, "settings.json");
  if (await fileExists(settingsPath)) {
    results.push({ relativePath: ".vscode/settings.json", status: "skipped-customized" });
  } else {
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          "editor.formatOnSave": true,
          "editor.codeActionsOnSave": {
            "source.fixAll": "explicit",
          },
          "files.autoSave": "afterDelay",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    results.push({ relativePath: ".vscode/settings.json", status: "applied" });
  }

  const provider = gitProviderLabel(profile);
  const prTerm = prTerminology(profile);

  const copilotPath = path.join(githubDir, "copilot-instructions.md");
  if (await fileExists(copilotPath)) {
    results.push({ relativePath: ".github/copilot-instructions.md", status: "skipped-customized" });
  } else {
    await writeFile(
      copilotPath,
      `# Copilot Instructions

- Keep code changes small and testable.
- Use Conventional Commits (feat:, fix:, docs:, etc.).
- Prefer security-safe defaults.
- Git platform: ${provider}. Always create a ${prTerm} for review.
`,
      "utf8",
    );
    results.push({ relativePath: ".github/copilot-instructions.md", status: "applied" });
  }

  if (profile.ide.plan === "vscode-pro") {
    const securityPath = path.join(vscodeDir, "security-review.agent.md");
    if (await fileExists(securityPath)) {
      results.push({
        relativePath: ".vscode/security-review.agent.md",
        status: "skipped-customized",
      });
    } else {
      await writeFile(
        securityPath,
        "# Security Review Agent\n\nSpecialized mode for security review.\n",
        "utf8",
      );
      results.push({ relativePath: ".vscode/security-review.agent.md", status: "applied" });
    }
  }

  return results;
}
