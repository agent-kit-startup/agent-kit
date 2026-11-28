import { lstat, readFile, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_RELATIVE_PATH } from "../manifest/types.js";
import { contentHash, type ManagedHashLedger } from "./overlay.js";
import { resolveContained } from "./paths.js";
import { isProtectedPath } from "./protected.js";

/**
 * Kit content that was dropped from the registry (ADR
 * `2026-11-26_third-party-skill-license-vendoring-policy`, point 8): the
 * `cursor-skills-groovy` rule and registry entry had no provable origin.
 * `update` removes an unedited installed copy, keeps and reports an edited one,
 * and drops the skill id from the manifest. Same shape as the legacy
 * `onboard.md` migration in `onboard-migration.ts`.
 */
export interface RetiredManagedFile {
  /** Project-root-relative POSIX path of the file the kit used to install. */
  path: string;
  /** sha256 (contentHash) of every body the kit ever shipped at this path. */
  hashes: ReadonlySet<string>;
}

export const RETIRED_SKILL_IDS: readonly string[] = ["cursor-skills-groovy"];

export const RETIRED_MANAGED_FILES: readonly RetiredManagedFile[] = [
  {
    path: ".cursor/rules/cursor-skills-groovy.mdc",
    hashes: new Set([
      "4bee84cedc08822a3c7ec61804574054031206ab0c66286b1adc81d2fd330f86",
      "87eddaddb927069fd161845d514df56fdb395c3e8b893324c135020e2c0285a4",
    ]),
  },
  {
    path: ".cursor/skills/community/cursor-skills-groovy/SKILL.md",
    hashes: new Set(["ac2f1f7d9e68f9c98fc4fe5ca348b1a90cf484141bbd116db871d63bdcc3c7c3"]),
  },
];

export type RetiredOutcome =
  | "absent"
  | "removed"
  | "preserved-customized"
  | "skipped-protected"
  | "skipped-symlink";

export interface RetiredResult {
  path: string;
  outcome: RetiredOutcome;
}

export function isRetiredSkillId(id: string): boolean {
  return RETIRED_SKILL_IDS.includes(id);
}

/** Skill ids without the retired ones, plus the ones that were dropped. */
export function dropRetiredSkillIds(skills: readonly string[] | undefined): {
  skills: string[] | undefined;
  dropped: string[];
} {
  if (!skills) return { skills: undefined, dropped: [] };
  const dropped = skills.filter(isRetiredSkillId);
  return { skills: skills.filter((id) => !isRetiredSkillId(id)), dropped };
}

/** One line per dropped id, printed by `update`. */
export function formatRetiredSkillDrop(id: string): string {
  return `Skill '${id}' was retired from the registry and removed from "skills" in ${MANIFEST_RELATIVE_PATH} (ADR 2026-11-26 third-party skill license policy).`;
}

/**
 * Remove retired kit files that are still unedited. A file counts as unedited
 * when its body is a known shipped body or matches the managed-hash ledger.
 * Edited, protected and symlinked paths are left alone and reported.
 */
export async function retireManagedFiles(
  projectRoot: string,
  protectedGlobs: readonly string[],
  ledger?: ManagedHashLedger,
  files: readonly RetiredManagedFile[] = RETIRED_MANAGED_FILES,
): Promise<RetiredResult[]> {
  const results: RetiredResult[] = [];
  for (const file of files) {
    const abs = resolveContained(projectRoot, file.path);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(abs);
    } catch {
      results.push({ path: file.path, outcome: "absent" });
      continue;
    }
    if (isProtectedPath(file.path, protectedGlobs)) {
      results.push({ path: file.path, outcome: "skipped-protected" });
      continue;
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      results.push({ path: file.path, outcome: "skipped-symlink" });
      continue;
    }
    const hash = contentHash(await readFile(abs, "utf8"));
    const recorded = ledger?.hashes[file.path];
    if (!file.hashes.has(hash) && hash !== recorded) {
      results.push({ path: file.path, outcome: "preserved-customized" });
      continue;
    }
    await unlink(abs);
    if (ledger) delete ledger.hashes[file.path];
    // Drop the skill directory when the file was its last one.
    try {
      await rmdir(path.dirname(abs));
    } catch {
      // not empty (or not a skill dir): leave it
    }
    results.push({ path: file.path, outcome: "removed" });
  }
  return results;
}
