import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectProfile } from "../types.js";
import { ensureDir } from "../utils/fs.js";
import { gitProviderLabel, prTerminology } from "./platform.js";

export async function generateVSCodeArtifacts(profile: ProjectProfile): Promise<void> {
  const vscodeDir = path.join(profile.rootDir, ".vscode");
  const githubDir = path.join(profile.rootDir, ".github");
  await Promise.all([ensureDir(vscodeDir), ensureDir(githubDir)]);

  await writeFile(
    path.join(vscodeDir, "settings.json"),
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

  const provider = gitProviderLabel(profile);
  const prTerm = prTerminology(profile);

  await writeFile(
    path.join(githubDir, "copilot-instructions.md"),
    `# Copilot Instructions

- Keep code changes small and testable.
- Use Conventional Commits (feat:, fix:, docs:, etc.).
- Prefer security-safe defaults.
- Git platform: ${provider}. Always create a ${prTerm} for review.
`,
    "utf8",
  );

  if (profile.ide.plan === "vscode-pro") {
    await writeFile(
      path.join(vscodeDir, "security-review.agent.md"),
      "# Security Review Agent\n\nSpecialized mode for security review.\n",
      "utf8",
    );
  }
}
