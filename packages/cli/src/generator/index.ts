import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectProfile } from "../types.js";
import { ensureDir } from "../utils/fs.js";
import { generateAgentsMd } from "./agents-md.js";
import { generateCursorArtifacts } from "./cursor.js";
import { generateGitHooks } from "./git-hooks.js";
import { generateVSCodeArtifacts } from "./vscode.js";
import { generateWindsurfArtifacts } from "./windsurf.js";

export async function generateFromProfile(profile: ProjectProfile): Promise<void> {
  await generateAgentsMd(profile);
  await generateGitHooks(profile);

  if (profile.ide.ide === "cursor" || profile.ide.plan.startsWith("cursor")) {
    await generateCursorArtifacts(profile);
  }
  if (profile.ide.ide === "vscode" || profile.ide.plan.startsWith("vscode")) {
    await generateVSCodeArtifacts(profile);
  }
  if (profile.ide.ide === "windsurf" || profile.ide.plan === "windsurf") {
    await generateWindsurfArtifacts(profile);
  }
  if (profile.ide.plan === "default") {
    await Promise.all([
      generateCursorArtifacts(profile),
      generateVSCodeArtifacts(profile),
      generateWindsurfArtifacts(profile),
    ]);
  }

  const pluginDir = path.join(profile.rootDir, ".cursor-plugin");
  await ensureDir(pluginDir);
  await writeFile(
    path.join(pluginDir, "plugin.json"),
    `${JSON.stringify(
      {
        name: "agent-kit",
        displayName: "Agent Kit",
        author: "agent-kit-startup",
        description: "Bootstrap de ambiente dev com IA (Cursor, VS Code, Windsurf)",
        keywords: ["agents", "context", "automation", "multi-ide"],
        license: "MIT",
        version: "3.0.0",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
