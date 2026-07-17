import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectProfile } from "../types.js";
import { ensureDir } from "../utils/fs.js";

export async function generateGitHooks(profile: ProjectProfile): Promise<void> {
  if (!profile.installHooks) return;

  const hooksDir = path.join(profile.rootDir, ".git", "hooks");
  await ensureDir(hooksDir);

  const preCommitPath = path.join(hooksDir, "pre-commit");
  const preCommit = `#!/usr/bin/env bash
set -euo pipefail

if command -v rg >/dev/null 2>&1; then
  rg -n --hidden --glob '!node_modules/**' '(AKIA|BEGIN PRIVATE KEY|xoxb-)' . && {
    echo "Potential secret detected. Commit blocked."
    exit 1
  } || true
fi
`;
  await writeFile(preCommitPath, preCommit, "utf8");
  await chmod(preCommitPath, 0o755);
}
