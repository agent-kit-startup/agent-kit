/**
 * Grow-only ledger of what the kit has ever written into `.claude/settings.json`
 * (deny rows and hook entries), stored at `.cursor/agent-kit.claude-settings.json`.
 *
 * Dedicated file on purpose: the managed-hash ledger (lifecycle/overlay.ts) drops
 * sibling keys on save, so it cannot carry this data.
 *
 * Contract: `save` is a sorted union with the stored ledger (never removes);
 * a malformed or unknown-schema file loads as `null` (no ledger) and is never
 * overwritten unless the caller passes `overwriteInvalid` (operator authorization).
 * All IO is contained under the project root; a symlink raises a typed error.
 */
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertRealContained,
  assertRealParentContained,
  resolveContained,
} from "../lifecycle/paths.js";

export const CLAUDE_SETTINGS_LEDGER_REL = ".cursor/agent-kit.claude-settings.json";

export interface ClaudeHookEntryRecord {
  event: string;
  marker: string;
}

export interface ClaudeSettingsLedger {
  schemaVersion: 1;
  denyRowsWritten: string[];
  hookEntriesWritten: ClaudeHookEntryRecord[];
}

export class ClaudeSettingsLedgerSymlinkError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`Refusing to use Claude settings ledger ${path}: ${detail}`);
    this.name = "ClaudeSettingsLedgerSymlinkError";
  }
}

export class ClaudeSettingsLedgerInvalidError extends Error {
  constructor(readonly path: string) {
    super(
      `Claude settings ledger ${path} is malformed or has an unknown schemaVersion; not overwriting without authorization.`,
    );
    this.name = "ClaudeSettingsLedgerInvalidError";
  }
}

type ReadState =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "ok"; ledger: ClaudeSettingsLedger };

function emptyLedger(): ClaudeSettingsLedger {
  return { schemaVersion: 1, denyRowsWritten: [], hookEntriesWritten: [] };
}

function hookKey(r: ClaudeHookEntryRecord): string {
  return `${r.event}\u0000${r.marker}`;
}

function normalize(
  denyRows: readonly string[],
  hooks: readonly ClaudeHookEntryRecord[],
): ClaudeSettingsLedger {
  const seen = new Map<string, ClaudeHookEntryRecord>();
  for (const h of hooks) seen.set(hookKey(h), { event: h.event, marker: h.marker });
  return {
    schemaVersion: 1,
    denyRowsWritten: [...new Set(denyRows)].sort(),
    hookEntriesWritten: [...seen.values()].sort(
      (a, b) => a.event.localeCompare(b.event) || a.marker.localeCompare(b.marker),
    ),
  };
}

function parseLedger(raw: string): ClaudeSettingsLedger | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.schemaVersion !== 1) return null;
  if (!Array.isArray(o.denyRowsWritten) || !o.denyRowsWritten.every((r) => typeof r === "string")) {
    return null;
  }
  if (!Array.isArray(o.hookEntriesWritten)) return null;
  const hooks: ClaudeHookEntryRecord[] = [];
  for (const h of o.hookEntriesWritten) {
    if (
      typeof h !== "object" ||
      h === null ||
      typeof (h as ClaudeHookEntryRecord).event !== "string" ||
      typeof (h as ClaudeHookEntryRecord).marker !== "string"
    ) {
      return null;
    }
    hooks.push({
      event: (h as ClaudeHookEntryRecord).event,
      marker: (h as ClaudeHookEntryRecord).marker,
    });
  }
  return normalize(o.denyRowsWritten as string[], hooks);
}

async function readState(root: string): Promise<{ abs: string; state: ReadState }> {
  const abs = resolveContained(root, CLAUDE_SETTINGS_LEDGER_REL);
  let exists = true;
  try {
    await lstat(abs);
  } catch {
    exists = false;
  }
  try {
    if (exists) await assertRealContained(root, abs);
    else await assertRealParentContained(root, abs);
  } catch (err) {
    throw new ClaudeSettingsLedgerSymlinkError(
      abs,
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!exists) return { abs, state: { kind: "missing" } };
  const ledger = parseLedger(await readFile(abs, "utf8"));
  return { abs, state: ledger ? { kind: "ok", ledger } : { kind: "invalid" } };
}

/** Stored ledger, or `null` when absent, malformed, or of an unknown schemaVersion. */
export async function loadClaudeSettingsLedger(root: string): Promise<ClaudeSettingsLedger | null> {
  const { state } = await readState(root);
  return state.kind === "ok" ? state.ledger : null;
}

/**
 * Union `additions` into the stored ledger and write it (sorted, deduped).
 * Returns the ledger as written. Throws `ClaudeSettingsLedgerInvalidError` when
 * a malformed file exists, unless `overwriteInvalid` is set.
 */
export async function saveClaudeSettingsLedger(
  root: string,
  additions: {
    denyRowsWritten?: readonly string[];
    hookEntriesWritten?: readonly ClaudeHookEntryRecord[];
  },
  opts: { overwriteInvalid?: boolean } = {},
): Promise<ClaudeSettingsLedger> {
  const { abs, state } = await readState(root);
  if (state.kind === "invalid" && !opts.overwriteInvalid) {
    throw new ClaudeSettingsLedgerInvalidError(abs);
  }
  const base = state.kind === "ok" ? state.ledger : emptyLedger();
  const merged = normalize(
    [...base.denyRowsWritten, ...(additions.denyRowsWritten ?? [])],
    [...base.hookEntriesWritten, ...(additions.hookEntriesWritten ?? [])],
  );
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}
