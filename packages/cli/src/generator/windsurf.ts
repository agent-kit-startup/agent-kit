import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectProfile } from "../types.js";
import { gitProviderLabel, prTerminology } from "./platform.js";

export async function generateWindsurfArtifacts(profile: ProjectProfile): Promise<void> {
  const provider = gitProviderLabel(profile);
  const prTerm = prTerminology(profile);

  const content = `# Windsurf Rules
- Keep instructions concise and objective.
- Prefer small diffs and explicit validation.
- Apply security review before merge.
- Use Conventional Commits (feat:, fix:, docs:, etc.).
- Git: ${provider}. Create a ${prTerm} for every change.
`;
  await writeFile(path.join(profile.rootDir, ".windsurfrules"), content, "utf8");
}
