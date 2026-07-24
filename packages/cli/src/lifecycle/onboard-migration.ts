import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../utils/fs.js";

const LEGACY_ONBOARD_PATH = ".cursor/commands/onboard.md";
const NAMESPACED_ONBOARD_PATH = ".cursor/commands/agent-kit-onboard.md";
const MANAGED_LEGACY_HASHES = new Set([
  "b274a68941813f19b185893cb7c5561dff027f53270890029992f208e24992fe",
]);

export type LegacyOnboardMigration = "absent" | "removed-managed" | "preserved-customized";

export async function migrateLegacyOnboardCommand(
  projectRoot: string,
  managedHashes: ReadonlySet<string> = MANAGED_LEGACY_HASHES,
): Promise<LegacyOnboardMigration> {
  const legacyPath = path.join(projectRoot, LEGACY_ONBOARD_PATH);
  if (!(await fileExists(legacyPath))) return "absent";

  const namespacedPath = path.join(projectRoot, NAMESPACED_ONBOARD_PATH);
  if (!(await fileExists(namespacedPath))) return "preserved-customized";

  const content = await readFile(legacyPath);
  const hash = createHash("sha256").update(content).digest("hex");
  if (!managedHashes.has(hash)) return "preserved-customized";

  await unlink(legacyPath);
  return "removed-managed";
}
