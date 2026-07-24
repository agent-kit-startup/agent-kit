import path from "node:path";
import type { ScanResult } from "../types.js";
import { listDirectory } from "../utils/fs.js";
import { detectGit, listTrackedFiles } from "./detect-git.js";
import { detectIde } from "./detect-ide.js";
import { detectInfra } from "./detect-infra.js";
import { detectAgentKit, detectContext, detectPurpose, detectSafety } from "./detect-repository.js";
import { detectServices } from "./detect-services.js";
import { detectStack } from "./detect-stack.js";

const GREENFIELD_SAFE_FILES = new Set([
  ".git",
  ".gitignore",
  "LICENSE",
  "README.md",
  ".cursor",
  ".vscode",
]);

function isGreenfieldByEntries(entries: string[]): boolean {
  const meaningful = entries.filter((entry) => !GREENFIELD_SAFE_FILES.has(entry));
  return meaningful.length === 0;
}

export async function runScanner(rootDir: string): Promise<ScanResult> {
  const normalizedRoot = path.resolve(rootDir);
  const entries = await listDirectory(normalizedRoot);
  const stack = await detectStack(normalizedRoot);
  const purpose = await detectPurpose(normalizedRoot, stack);
  const [git, ide, infra, services, context, agentKit, trackedFiles] = await Promise.all([
    detectGit(normalizedRoot),
    detectIde(normalizedRoot),
    detectInfra(normalizedRoot),
    detectServices(normalizedRoot),
    detectContext(normalizedRoot),
    detectAgentKit(normalizedRoot),
    listTrackedFiles(normalizedRoot),
  ]);
  const safety = await detectSafety(normalizedRoot, trackedFiles);

  const isGreenfield = isGreenfieldByEntries(entries) && purpose.value === "unknown";

  return {
    rootDir: normalizedRoot,
    isGreenfield,
    purpose,
    stack,
    git,
    ide,
    infra,
    services,
    context,
    agentKit,
    safety,
    quality: {
      testCommands: stack.testCommands,
      validationCommands: stack.validationCommands,
      ci: infra.ci,
      hasTests: stack.testCommands.length > 0,
    },
  };
}
