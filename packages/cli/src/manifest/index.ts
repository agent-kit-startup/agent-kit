import path from "node:path";
import { readJson } from "../utils/fs.js";
import { parseAgentKitManifest } from "./parse.js";
import type { AgentKitManifest } from "./types.js";
import { MANIFEST_RELATIVE_PATH } from "./types.js";

export async function loadAgentKitManifest(cwd: string): Promise<AgentKitManifest | null> {
  const target = path.join(cwd, MANIFEST_RELATIVE_PATH);
  const raw = await readJson<unknown>(target);
  if (raw === null) return null;
  return parseAgentKitManifest(raw);
}

export { parseAgentKitManifest, ManifestValidationError } from "./parse.js";
export type {
  AgentKitManifest,
  AgentKitManifestOverride,
  AgentKitManifestRegistry,
} from "./types.js";
export {
  DEFAULT_PROTECTED_PATHS,
  DOMAIN_PACK_IDS,
  MANIFEST_FILENAME,
  MANIFEST_RELATIVE_PATH,
  MANIFEST_SCHEMA_VERSION,
} from "./types.js";
