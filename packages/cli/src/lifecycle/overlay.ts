/**
 * Consumer overlay for agents / skills / commands.
 *
 * User-added basenames (never targeted by L0/pack/skill apply) already survive
 * update. Kit-owned paths under these trees use a managed-content hash ledger:
 * local hash matching the last install refreshes; divergence preserves the
 * local file (preserved-customized) instead of silent clobber.
 *
 * Do not blanket-protect `.cursor/agents/**` (or skills/commands): that blocks
 * pack / `agent-kit add` installs.
 */
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { KNOWN_SHIPPED_OVERLAY_HASHES } from "./overlay-known-hashes.js";
import { resolveContained } from "./paths.js";

export const MANAGED_HASHES_REL = ".cursor/agent-kit.managed-hashes.json";

export const CONSUMER_OVERLAY_PREFIXES = [
  ".cursor/agents/",
  ".cursor/skills/",
  ".cursor/commands/",
  ".claude/commands/",
] as const;

export type ManagedHashLedger = {
  schemaVersion: 1;
  hashes: Record<string, string>;
};

export function isConsumerOverlayPath(relPath: string): boolean {
  const norm = relPath.split(path.sep).join("/");
  return CONSUMER_OVERLAY_PREFIXES.some((p) => norm.startsWith(p));
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function loadManagedHashLedger(projectRoot: string): Promise<ManagedHashLedger> {
  const abs = resolveContained(projectRoot, MANAGED_HASHES_REL);
  try {
    const raw = await readFile(abs, "utf8");
    const parsed = JSON.parse(raw) as Partial<ManagedHashLedger>;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.hashes &&
      typeof parsed.hashes === "object"
    ) {
      return { schemaVersion: 1, hashes: { ...parsed.hashes } };
    }
  } catch {
    // absent or unreadable → empty ledger
  }
  return { schemaVersion: 1, hashes: {} };
}

export async function saveManagedHashLedger(
  projectRoot: string,
  ledger: ManagedHashLedger,
): Promise<void> {
  const abs = resolveContained(projectRoot, MANAGED_HASHES_REL);
  await mkdir(path.dirname(abs), { recursive: true });
  const payload: ManagedHashLedger = {
    schemaVersion: 1,
    hashes: { ...ledger.hashes },
  };
  await writeFile(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Decide whether an overlay path with local≠registry content should refresh
 * (unedited vs last managed hash) or be preserved as customized.
 *
 * Ledger-absent (upgrade into overlay / clone without the state file): compare
 * local content to known shipped kit hashes (Option A, same idea as
 * `MANAGED_LEGACY_HASHES` in onboard-migration). Known kit body → allow
 * refresh; anything else → preserve. When a ledger entry exists, divergence
 * from that managed hash preserves as before.
 */
export function shouldPreserveCustomizedOverlay(
  localContent: string,
  recordedHash: string | undefined,
  knownShippedHashes: ReadonlySet<string> = KNOWN_SHIPPED_OVERLAY_HASHES,
): boolean {
  const localHash = contentHash(localContent);
  if (!recordedHash) {
    return !knownShippedHashes.has(localHash);
  }
  return localHash !== recordedHash;
}

/**
 * Seed the managed-hash ledger from the current local overlay files.
 * Use this in factory/dogfood checkouts on first update so the local files
 * become the baseline for subsequent refresh-vs-preserve decisions.
 * Does not overwrite existing ledger entries.
 *
 * Note: this walks every file under the overlay prefixes, including user-added
 * non-kit basenames. That is harmless today because those basenames are never in
 * the L0/pack/skill apply set; it only widens what the ledger claims to describe
 * if the ledger later gains semantics beyond refresh-vs-preserve.
 */
export async function seedManagedHashLedger(projectRoot: string): Promise<ManagedHashLedger> {
  const ledger = await loadManagedHashLedger(projectRoot);
  for (const prefix of CONSUMER_OVERLAY_PREFIXES) {
    const prefixPath = resolveContained(projectRoot, prefix);
    let entries: Dirent[];
    try {
      entries = await readdir(prefixPath, { withFileTypes: true, recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parentPath = String(entry.parentPath);
      const name = String(entry.name);
      const rel = path.relative(projectRoot, path.join(parentPath, name));
      const norm = rel.split(path.sep).join("/");
      if (ledger.hashes[norm]) continue;
      try {
        const content = await readFile(path.join(parentPath, name), "utf8");
        ledger.hashes[norm] = contentHash(content);
      } catch {
        // ignore unreadable files
      }
    }
  }
  await saveManagedHashLedger(projectRoot, ledger);
  return ledger;
}
