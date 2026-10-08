import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_RELATIVE_PATH } from "../manifest/index.js";
import { fileExists } from "../utils/fs.js";

/** Direct children inspected at most; a huge workspace folder must not stall doctor/status. */
const MAX_CHILDREN_INSPECTED = 200;
/** Kit projects named in the advisory / `--json`; the rest are dropped. */
const MAX_KIT_PROJECTS_REPORTED = 10;

export interface WorkspaceParentDetection {
  /** Direct child directories that have `.cursor/agent-kit.json`, sorted, capped. */
  kitProjects: string[];
}

/**
 * A workspace parent is a directory that is not a kit project itself (no
 * `.cursor/agent-kit.json`) but directly contains one or more kit projects.
 * Running doctor/status there should say "no kit here, run from a child"
 * rather than recommend installing the kit into a non-project folder.
 * One level only; dot-directories, `node_modules` and symlinks are skipped.
 * Never throws: an unreadable directory is simply "not a workspace parent".
 */
export async function detectWorkspaceParent(
  rootDir: string,
): Promise<WorkspaceParentDetection | null> {
  try {
    if (await fileExists(path.join(rootDir, MANIFEST_RELATIVE_PATH))) return null;
    const entries: Dirent[] = await readdir(rootDir, { withFileTypes: true });
    // Dirent.isDirectory() is false for symlinks, so linked dirs are skipped here.
    const children = entries
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
      )
      .map((entry) => entry.name)
      .sort()
      .slice(0, MAX_CHILDREN_INSPECTED);
    const hits = await Promise.all(
      children.map(async (name) =>
        (await fileExists(path.join(rootDir, name, MANIFEST_RELATIVE_PATH))) ? name : null,
      ),
    );
    const kitProjects = hits
      .filter((name): name is string => name !== null)
      .slice(0, MAX_KIT_PROJECTS_REPORTED);
    return kitProjects.length > 0 ? { kitProjects } : null;
  } catch {
    return null;
  }
}

function shellArg(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

/** The `cd <child> && agent-kit <command>` line used as the advisory's Next step. */
export function workspaceParentNextStep(
  detection: WorkspaceParentDetection,
  command: string,
): string {
  return `cd ${shellArg(detection.kitProjects[0] ?? "<project>")} && agent-kit ${command}`;
}

/** Advisory lines shared by `doctor` and `status` (no readiness counts, no install hint). */
export function workspaceParentAdvisoryLines(
  rootDir: string,
  detection: WorkspaceParentDetection,
  command: string,
): string[] {
  return [
    `No Agent Kit here: ${rootDir} is a workspace folder, not a kit project.`,
    "Kit projects in its direct subfolders:",
    ...detection.kitProjects.map((name) => `  - ${name}`),
    `Run \`agent-kit ${command}\` from inside one of them.`,
    `Next: ${workspaceParentNextStep(detection, command)}`,
  ];
}
