/**
 * Append-only refresher for `KNOWN_SHIPPED_OVERLAY_HASHES`
 * (`overlay-known-hashes.ts`).
 *
 * Enumerates exactly the same sources as the coverage tests in
 * `overlay.test.ts` ("KNOWN_SHIPPED_OVERLAY_HASHES coverage"):
 *   1. L0 artifacts whose target is a consumer overlay path
 *      (`.cursor/agents|skills|commands`), body read from the kit root.
 *   2. Every `registry/registry.json` skill (core + community) `<path>/SKILL.md`.
 *
 * Missing hashes are APPENDED before the closing `]);` — existing entries are
 * never removed or reordered, and inline comments are preserved. Idempotent:
 * a second run is a no-op.
 *
 * Usage (from packages/cli):
 *   npm run overlay:hashes          # append missing hashes
 *   npm run overlay:hashes:check    # list missing hashes, exit 1, no writes
 * Or from the repo root: `pnpm overlay:hashes` / `pnpm overlay:hashes:check`.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { L0_ARTIFACTS } from "./l0.js";
import { contentHash, isConsumerOverlayPath } from "./overlay.js";

/** Kit-root-relative path of the file this helper maintains. */
export const KNOWN_HASHES_REL = "packages/cli/src/lifecycle/overlay-known-hashes.ts";

export interface ExpectedHash {
  /** Kit-root-relative source path the hash was computed from. */
  source: string;
  /** sha256 hex of the utf8 body (contentHash). */
  hash: string;
}

/**
 * Enumerate every body the coverage tests check and compute its contentHash.
 * Mirrors overlay.test.ts "KNOWN_SHIPPED_OVERLAY_HASHES coverage" exactly.
 */
export async function collectExpectedHashes(kitRoot: string): Promise<ExpectedHash[]> {
  const out: ExpectedHash[] = [];
  for (const artifact of L0_ARTIFACTS.filter((a) => isConsumerOverlayPath(a.target))) {
    const body = await readFile(path.join(kitRoot, artifact.source), "utf8");
    out.push({ source: artifact.source, hash: contentHash(body) });
  }
  const reg = JSON.parse(await readFile(path.join(kitRoot, "registry/registry.json"), "utf8")) as {
    skills?: {
      core?: Array<{ path: string }>;
      community?: Array<{ path: string }>;
    };
  };
  for (const skill of [...(reg.skills?.core || []), ...(reg.skills?.community || [])]) {
    const source = `${skill.path}/SKILL.md`;
    const body = await readFile(path.join(kitRoot, source), "utf8");
    out.push({ source, hash: contentHash(body) });
  }
  return out;
}

const HASH_ENTRY_RE = /"([0-9a-f]{64})"/g;

/** Extract the set of 64-hex hashes currently listed in the file body. */
export function parseKnownHashes(fileContent: string): Set<string> {
  const found = new Set<string>();
  for (const match of fileContent.matchAll(HASH_ENTRY_RE)) {
    const hash = match[1];
    if (hash) {
      found.add(hash);
    }
  }
  return found;
}

/**
 * Return the file content with `hashes` appended (sorted among themselves)
 * immediately before the closing `]);`. Purely additive by construction:
 * everything before and after the insertion point is byte-identical.
 */
export function appendHashes(fileContent: string, hashes: readonly string[]): string {
  const marker = fileContent.lastIndexOf("]);");
  if (marker === -1) {
    throw new Error(`closing \`]);\` not found in ${KNOWN_HASHES_REL}; refusing to edit`);
  }
  const lines = [...hashes]
    .sort()
    .map((h) => `  "${h}",\n`)
    .join("");
  return fileContent.slice(0, marker) + lines + fileContent.slice(marker);
}

export interface RefreshResult {
  /** Expected entries whose hash was not in the file (empty = up to date). */
  missing: ExpectedHash[];
  /** True when the file was rewritten (never in check mode). */
  wrote: boolean;
}

export async function refreshKnownHashes(opts: {
  kitRoot: string;
  /** Override target file (tests); defaults to KNOWN_HASHES_REL under kitRoot. */
  knownHashesPath?: string;
  /** No-write mode: report missing hashes only. */
  check?: boolean;
  /** Override enumeration (tests); defaults to collectExpectedHashes(kitRoot). */
  expected?: ExpectedHash[];
}): Promise<RefreshResult> {
  const filePath = opts.knownHashesPath ?? path.join(opts.kitRoot, KNOWN_HASHES_REL);
  const expected = opts.expected ?? (await collectExpectedHashes(opts.kitRoot));
  const original = await readFile(filePath, "utf8");
  const known = parseKnownHashes(original);
  const missing = expected.filter((e) => !known.has(e.hash));
  if (missing.length === 0 || opts.check) {
    return { missing, wrote: false };
  }
  const uniqueNewHashes = [...new Set(missing.map((m) => m.hash))];
  const next = appendHashes(original, uniqueNewHashes);
  // Append-only invariant: every previously known hash must survive.
  const nextKnown = parseKnownHashes(next);
  for (const h of known) {
    if (!nextKnown.has(h)) {
      throw new Error(`append-only invariant violated: hash ${h} would be lost; aborting`);
    }
  }
  await writeFile(filePath, next, "utf8");
  return { missing, wrote: true };
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const result = await refreshKnownHashes({ kitRoot, check });
  if (result.missing.length === 0) {
    console.log("overlay known-hashes: up to date (no missing hashes)");
    return;
  }
  for (const m of result.missing) {
    console.log(`missing ${m.hash}  ${m.source}`);
  }
  if (check) {
    console.error(
      `overlay known-hashes: ${result.missing.length} missing hash(es); run \`npm run overlay:hashes\` (packages/cli) or \`pnpm overlay:hashes\` (root) to append.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `overlay known-hashes: appended ${new Set(result.missing.map((m) => m.hash)).size} hash(es) to ${KNOWN_HASHES_REL}`,
  );
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
