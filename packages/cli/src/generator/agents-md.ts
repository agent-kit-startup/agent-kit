import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectProfile } from "../types.js";
import { fileExists } from "../utils/fs.js";

export async function generateAgentsMd(profile: ProjectProfile): Promise<void> {
  const target = path.join(profile.rootDir, "AGENTS.md");
  if (await fileExists(target)) return;

  const content = `# AGENTS.md

## Guidelines
1. Prefer small, verifiable changes.
2. Preserve project-owned guidance and existing repository conventions.
3. Use verified repository context and request confirmation for uncertain integrations.
`;
  await writeFile(target, content, "utf8");
}
