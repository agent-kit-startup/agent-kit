import path from "node:path";
import type { ScanResult } from "../types.js";
import { listDirectory } from "../utils/fs.js";
import { detectGit } from "./detect-git.js";
import { detectIde } from "./detect-ide.js";
import { detectInfra } from "./detect-infra.js";
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

  const isGreenfield = isGreenfieldByEntries(entries) || !stack.hasProjectFiles;

  return {
    rootDir: normalizedRoot,
    isGreenfield,
    stack,
    git: await detectGit(normalizedRoot),
    ide: await detectIde(normalizedRoot),
    infra: await detectInfra(normalizedRoot),
    services: await detectServices(normalizedRoot),
  };
}
