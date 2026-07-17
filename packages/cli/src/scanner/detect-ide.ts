import path from "node:path";
import type { IdeDetection } from "../types.js";
import { fileExists } from "../utils/fs.js";

export async function detectIde(rootDir: string): Promise<IdeDetection> {
  const hasCursor = await fileExists(path.join(rootDir, ".cursor"));
  const hasVSCode = await fileExists(path.join(rootDir, ".vscode"));
  const hasWindsurf = await fileExists(path.join(rootDir, ".windsurfrules"));

  if (hasCursor) return { ide: "cursor", plan: "cursor-pro" };
  if (hasVSCode) return { ide: "vscode", plan: "vscode-pro" };
  if (hasWindsurf) return { ide: "windsurf", plan: "windsurf" };
  return { ide: "unknown", plan: "default" };
}
