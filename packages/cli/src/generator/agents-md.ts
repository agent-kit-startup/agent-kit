import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectProfile } from "../types.js";
import { devopsFlowSummary, prTerminology } from "./platform.js";

export async function generateAgentsMd(profile: ProjectProfile): Promise<void> {
  const target = path.join(profile.rootDir, "AGENTS.md");
  const flow = devopsFlowSummary(profile);
  const prTerm = prTerminology(profile);

  const content = `# AGENTS.md

Project configured with Agent Kit v3.

## Detected context
- Stack: ${profile.stack.language}${profile.stack.framework ? ` (${profile.stack.framework})` : ""}
- IDE: ${profile.ide.ide} (${profile.ide.plan})
- ${flow}

## Guidelines
1. Prefer small, verifiable changes.
2. Adapt response depth to user's IDE plan/model.
3. Use /worktree for experiments, /best-of-n for critical decisions (Cursor 3.0).
4. Security review before merge.
5. Always create a ${prTerm} — never push directly to main.
`;
  await writeFile(target, content, "utf8");
}
