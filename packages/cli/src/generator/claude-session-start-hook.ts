/**
 * Claude Code SessionStart hook delivery: idempotent JSON merge into
 * `.claude/settings.json`. Opt-in (see `install --claude`); this module has
 * no gate of its own.
 *
 * Decision (ADR 2026-08-13_claude-cli-kit-load-bootstrap.md, amended
 * 2026-08-21; Phase 3 of claude-code-consumer-adapters.plan.md): merge with
 * a marker, not skip-if-exists. Two live-docs facts ruled the other two
 * options out:
 *
 *   - `.claude/settings.local.json` is routinely auto-created by Claude Code
 *     itself the first time a user approves a permission prompt ("Claude
 *     Code also saves permanent 'don't ask again' permission approvals...
 *     to this file", code.claude.com/docs/en/settings). A skip-if-exists
 *     write there would silently no-op for most real users, the same
 *     footgun ruled out for the shared file by this plan's own constraint.
 *     It is also conventionally gitignored, so it would not ship as a team
 *     default the way the rest of consumer L0 does.
 *   - Claude Code hooks *merge* across settings files rather than shadow
 *     ("Hook entries merge across settings levels rather than replacing
 *     each other" / "If you define the same handler in more than one
 *     settings file, it runs once", same docs page). Writing into the
 *     shared, version-controlled `.claude/settings.json` cannot silently
 *     lose a user's other hooks: the merge here touches only
 *     `hooks.SessionStart`, appends alongside whatever is already there,
 *     and a marker substring in the generated `command` (not a hash ledger:
 *     this is one generated JSON object, not markdown a consumer is
 *     expected to hand-tune) makes re-runs idempotent and the entry
 *     removable.
 *
 * Same merge also unions INTERACTIVE_DENY_RULES (claude-permissions.ts) into
 * `permissions.deny`: kit rows are added once, user rows are never removed or
 * reordered, and the headless-only rows (`ALLOW_MAIN_PUSH=`, promote skills)
 * never land here so attended /git-prod keeps working.
 *
 * The one case merge cannot handle safely — existing `.claude/settings.json`
 * that is not valid JSON — degrades to `print-instructions` (`unavailable`
 * status): never guess at repairing a file we cannot parse, but never go
 * silent either.
 *
 * Command line: resolution reuses the existing L0-installed
 * `.cursor/hooks/agent/resolve-agent-kit.sh` (`AGENT_KIT_HOOK_BIN` ->
 * `node_modules/.bin/agent-kit` -> factory `packages/cli/dist` -> PATH),
 * addressed via Claude Code's `${CLAUDE_PROJECT_DIR}` placeholder so the
 * command resolves correctly regardless of session cwd or worktree (live
 * docs: "${CLAUDE_PROJECT_DIR}: the project root where the session
 * started... stays put" even inside a worktree). No new `.claude/hooks/`
 * script is generated — the ADR amendment sanctions "a thin shell-out from
 * settings.json", not a new script surface, and this reuses a script that
 * already ships as part of unconditional L0. The hook-private
 * `_AGENT_KIT_HOOK_ROOT` is set first because under `sh -c` the resolver's
 * `$0` is the shell, not the script (a user's exported `AGENT_KIT_ROOT` is
 * not read, so it cannot redirect the Cursor adapters).
 *
 * Fail-open: `exec` replaces the shell process on success, so the trailing
 * `printf` degraded-mode diagnostic only runs when resolution fails or
 * `run_agent_kit` returns non-zero (e.g. node missing for a dist-only CLI);
 * either way the command's own exit status is 0.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isRealWriteTargetContained, resolveContained } from "../lifecycle/paths.js";
import { ensureDir } from "../utils/fs.js";
import { INTERACTIVE_DENY_RULES } from "./claude-permissions.js";
import {
  CLAUDE_SETTINGS_LEDGER_REL,
  type ClaudeHookEntryRecord,
  type ClaudeSettingsLedger,
  ClaudeSettingsLedgerSymlinkError,
  loadClaudeSettingsLedger,
  saveClaudeSettingsLedger,
} from "./claude-settings-ledger.js";

export const CLAUDE_SETTINGS_REL = ".claude/settings.json";
export const RESOLVE_AGENT_KIT_REL = ".cursor/hooks/agent/resolve-agent-kit.sh";

/** Present in every kit-generated SessionStart command; identifies the kit-owned entry for merge/idempotency/removal. */
export const SESSION_START_HOOK_MARKER = "hook session-start --format claude";

export const SESSION_START_DEGRADED_TEXT =
  "Agent Kit hooks are running in degraded fail-open mode: the agent-kit CLI could not be resolved (checked AGENT_KIT_HOOK_BIN, node_modules/.bin/agent-kit, PATH), or it resolved to a node script and node is not on PATH. Slash command adapters still work; session-context injection is inactive. Fix: install the CLI (npm i -D @dadado/agent-kit-cli), put node on PATH, or set AGENT_KIT_HOOK_BIN.";

export function buildSessionStartHookCommand(): string {
  // run_agent_kit quotes args (repo paths with spaces); an older resolver lacks it.
  const run = `{ if command -v run_agent_kit >/dev/null 2>&1; then run_agent_kit ${SESSION_START_HOOK_MARKER}; else exec $AGENT_KIT_RESOLVED ${SESSION_START_HOOK_MARKER}; fi; }`;
  return `_AGENT_KIT_HOOK_ROOT="\${CLAUDE_PROJECT_DIR}"; . "\${CLAUDE_PROJECT_DIR}/${RESOLVE_AGENT_KIT_REL}" 2>/dev/null && resolve_agent_kit && ${run}; printf '%s' ${shellSingleQuote(SESSION_START_DEGRADED_TEXT)}`;
}

/** Present in every kit-generated PreToolUse(Bash) command; identifies the kit-owned group for merge/idempotency. */
export const GUARD_SHELL_HOOK_MARKER = "guard shell --format claude";

/**
 * PreToolUse command: same resolver chain as SessionStart, but NO trailing
 * degraded-text `printf`: PreToolUse stdout must be at most one JSON object,
 * so fail-open here means empty stdout and exit 0. `exec` replaces the shell on
 * success, so the trailing `:` only runs when resolution fails or `run_agent_kit`
 * returns non-zero, and forces exit 0 there.
 */
export function buildGuardShellHookCommand(): string {
  const run = `{ if command -v run_agent_kit >/dev/null 2>&1; then run_agent_kit ${GUARD_SHELL_HOOK_MARKER}; else exec $AGENT_KIT_RESOLVED ${GUARD_SHELL_HOOK_MARKER}; fi; }`;
  return `_AGENT_KIT_HOOK_ROOT="\${CLAUDE_PROJECT_DIR}"; . "\${CLAUDE_PROJECT_DIR}/${RESOLVE_AGENT_KIT_REL}" 2>/dev/null && resolve_agent_kit && ${run}; :`;
}

export interface ClaudeGuardShellHookEntry {
  type: "command";
  command: string;
  timeout: number;
}

export function buildGuardShellHookEntry(): ClaudeGuardShellHookEntry {
  return { type: "command", command: buildGuardShellHookCommand(), timeout: 10 };
}

function shellSingleQuote(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

export interface ClaudeSessionStartHookEntry {
  type: "command";
  command: string;
  timeout: number;
  statusMessage: string;
}

export function buildSessionStartHookEntry(): ClaudeSessionStartHookEntry {
  return {
    type: "command",
    command: buildSessionStartHookCommand(),
    timeout: 15,
    statusMessage: "Loading Agent Kit session context",
  };
}

interface HookGroup {
  hooks?: unknown;
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a hook-group's `hooks[]` contains an entry whose command carries the kit marker. */
export function groupHasMarker(group: unknown, marker: string): boolean {
  if (!isPlainObject(group) || !Array.isArray(group.hooks)) return false;
  return group.hooks.some(
    (h) => isPlainObject(h) && typeof h.command === "string" && h.command.includes(marker),
  );
}

export type UpsertGroupStatus = "applied" | "unchanged" | "refreshed";

/**
 * Upsert `group` into `arr` in place: append when no group carries `marker`,
 * replace the marked group when it drifted, leave it alone when identical.
 */
export function upsertMarkedGroup(
  arr: unknown[],
  group: HookGroup,
  marker: string,
): UpsertGroupStatus {
  const existingIndex = arr.findIndex((g) => groupHasMarker(g, marker));
  if (existingIndex === -1) {
    arr.push(group);
    return "applied";
  }
  if (JSON.stringify(arr[existingIndex]) === JSON.stringify(group)) return "unchanged";
  arr[existingIndex] = group;
  return "refreshed";
}

export type SessionStartHookStatus = "applied" | "unchanged" | "refreshed" | "unavailable";

export interface SessionStartHookMergeResult {
  content: string | null;
  status: SessionStartHookStatus;
  /** Only set on "unavailable": what to tell the operator to paste by hand. */
  instructions?: string;
  /** Kit rows/entries missing with no ledger to say whether the operator deleted them; not added (unauthorized). */
  pending?: ClaudeSettingsPending;
  /** What the ledger must absorb after a successful write (grow-only union). */
  ledgerAdditions?: ClaudeLedgerAdditions;
}

export interface ClaudeSettingsPending {
  denyRows: string[];
  hookEntries: ClaudeHookEntryRecord[];
}

export interface ClaudeLedgerAdditions {
  denyRowsWritten: string[];
  hookEntriesWritten: ClaudeHookEntryRecord[];
}

export interface SettingsMergeOptions {
  /** Stored ledger, or null when absent/malformed. Default: null. */
  ledger?: ClaudeSettingsLedger | null;
  /** install --claude authority: ambiguous (no-ledger) missing rows/entries are added. Default: true. */
  authorized?: boolean;
}

const SESSION_START_EVENT = "SessionStart";
const PRE_TOOL_USE_EVENT = "PreToolUse";

/**
 * Pure merge: given the existing `.claude/settings.json` text (or null when
 * the file does not exist yet), return the next file content. Touches only
 * `hooks.SessionStart`, the kit `hooks.PreToolUse` Bash group and
 * `permissions.deny` (union); never touches other
 * SessionStart hook groups or deny entries the user already has.
 */
export function mergeSessionStartHookIntoSettings(
  existingRaw: string | null,
  opts: SettingsMergeOptions = {},
): SessionStartHookMergeResult {
  const ledger = opts.ledger ?? null;
  const authorized = opts.authorized ?? true;
  const entry = buildSessionStartHookEntry();
  const newGroup: HookGroup = { hooks: [entry] };

  let root: Record<string, unknown> = {};
  if (existingRaw !== null && existingRaw.trim() !== "") {
    try {
      const parsed = JSON.parse(existingRaw);
      if (!isPlainObject(parsed)) throw new Error("root is not an object");
      root = parsed;
    } catch {
      return {
        content: null,
        status: "unavailable",
        instructions: instructionsBlock(entry),
      };
    }
  }

  const pending: ClaudeSettingsPending = { denyRows: [], hookEntries: [] };
  const additions: ClaudeLedgerAdditions = { denyRowsWritten: [], hookEntriesWritten: [] };

  const hooks = isPlainObject(root.hooks) ? { ...root.hooks } : {};
  const sessionStart = Array.isArray(hooks.SessionStart) ? [...hooks.SessionStart] : [];
  const preToolUse = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];

  const upserts: UpsertGroupStatus[] = [
    upsertLedgerAwareGroup({
      arr: sessionStart,
      group: newGroup,
      event: SESSION_START_EVENT,
      marker: SESSION_START_HOOK_MARKER,
    }),
    upsertLedgerAwareGroup({
      arr: preToolUse,
      group: { matcher: "Bash", hooks: [buildGuardShellHookEntry()] },
      event: PRE_TOOL_USE_EVENT,
      marker: GUARD_SHELL_HOOK_MARKER,
    }),
  ];
  hooks.SessionStart = sessionStart;
  hooks.PreToolUse = preToolUse;
  root.hooks = hooks;

  function upsertLedgerAwareGroup(g: {
    arr: unknown[];
    group: HookGroup;
    event: string;
    marker: string;
  }): UpsertGroupStatus {
    const record = { event: g.event, marker: g.marker };
    if (g.arr.some((x) => groupHasMarker(x, g.marker))) {
      additions.hookEntriesWritten.push(record);
      return upsertMarkedGroup(g.arr, g.group, g.marker);
    }
    // Marker absent: the operator deleted it (ledger says the kit wrote it), or it was never written.
    if (ledger?.hookEntriesWritten.some((h) => h.event === g.event && h.marker === g.marker)) {
      return "unchanged";
    }
    if (ledger === null && !authorized) {
      pending.hookEntries.push(record);
      return "unchanged";
    }
    additions.hookEntriesWritten.push(record);
    return upsertMarkedGroup(g.arr, g.group, g.marker);
  }

  const status = upserts.reduce<UpsertGroupStatus>(
    (acc, next, i) => (i === 0 ? next : combineStatus(acc, next)),
    "unchanged",
  );
  const denyAdded = mergeKitDenyRules(root, { ledger, authorized }, pending, additions);
  const finalStatus: UpsertGroupStatus = denyAdded && status === "unchanged" ? "refreshed" : status;

  return {
    content: `${JSON.stringify(root, null, 2)}\n`,
    status: finalStatus,
    pending,
    ledgerAdditions: additions,
  };
}

/** SessionStart status leads; a changed guard group on an otherwise unchanged file is a refresh. */
function combineStatus(a: UpsertGroupStatus, b: UpsertGroupStatus): UpsertGroupStatus {
  return a === "unchanged" && b !== "unchanged" ? "refreshed" : a;
}

/**
 * Ledger-aware union of INTERACTIVE_DENY_RULES into `root.permissions.deny` in
 * place. toAdd = kit rows - present - ledger.denyRowsWritten (appended; user
 * rows never reordered or removed). Without a ledger a missing row is
 * ambiguous: added only when authorized, else recorded in `pending`. Present
 * kit rows are seeded into the ledger additions. Returns true when a rule was
 * added. A non-object `permissions` or non-array `deny` is left alone (never
 * guess at repairing user settings).
 */
function mergeKitDenyRules(
  root: Record<string, unknown>,
  ctx: { ledger: ClaudeSettingsLedger | null; authorized: boolean },
  pending: ClaudeSettingsPending,
  additions: ClaudeLedgerAdditions,
): boolean {
  if (root.permissions !== undefined && !isPlainObject(root.permissions)) return false;
  const permissions = isPlainObject(root.permissions) ? { ...root.permissions } : {};
  if (permissions.deny !== undefined && !Array.isArray(permissions.deny)) return false;
  const deny: unknown[] = Array.isArray(permissions.deny) ? [...permissions.deny] : [];
  const written = new Set(ctx.ledger?.denyRowsWritten ?? []);
  for (const rule of INTERACTIVE_DENY_RULES) {
    if (deny.includes(rule)) additions.denyRowsWritten.push(rule);
  }
  const missing = INTERACTIVE_DENY_RULES.filter(
    (rule) => !deny.includes(rule) && !written.has(rule),
  );
  const toAdd = ctx.ledger === null && !ctx.authorized ? [] : missing;
  if (ctx.ledger === null && !ctx.authorized) pending.denyRows.push(...missing);
  if (toAdd.length === 0) return false;
  additions.denyRowsWritten.push(...toAdd);
  permissions.deny = [...deny, ...toAdd];
  root.permissions = permissions;
  return true;
}

function instructionsBlock(entry: ClaudeSessionStartHookEntry): string {
  return [
    `Could not parse the existing ${CLAUDE_SETTINGS_REL} as JSON, so Agent Kit did not touch it.`,
    "Add these hooks by hand (create the arrays if they do not exist).",
    "Under hooks.SessionStart:",
    "",
    JSON.stringify(entry, null, 2),
    "",
    'Under hooks.PreToolUse, in a group with "matcher": "Bash":',
    "",
    JSON.stringify(buildGuardShellHookEntry(), null, 2),
  ].join("\n");
}

export interface WriteSessionStartHookResult {
  relativePath: string;
  /** "skipped-symlink": settings.json, .claude/ or the ledger resolves outside the project; nothing written. */
  status: SessionStartHookStatus | "skipped-symlink";
  instructions?: string;
  /** Kit rows/entries not written because no ledger says whether the operator deleted them. */
  pending?: ClaudeSettingsPending;
  /** Ledger path, set when this call created or grew the ledger file. */
  ledgerPath?: string;
}

export async function writeClaudeSessionStartHook(
  rootDir: string,
  opts: { authorized?: boolean } = {},
): Promise<WriteSessionStartHookResult> {
  const authorized = opts.authorized ?? true;
  const abs = resolveContained(rootDir, CLAUDE_SETTINGS_REL);
  // Lexical containment does not stop a symlinked settings.json or .claude/ dir.
  if (!(await isRealWriteTargetContained(rootDir, abs))) {
    return { relativePath: CLAUDE_SETTINGS_REL, status: "skipped-symlink" };
  }
  let ledger: ClaudeSettingsLedger | null;
  try {
    ledger = await loadClaudeSettingsLedger(rootDir);
  } catch (err) {
    if (err instanceof ClaudeSettingsLedgerSymlinkError) {
      return { relativePath: CLAUDE_SETTINGS_REL, status: "skipped-symlink" };
    }
    throw err;
  }
  let existing: string | null = null;
  try {
    existing = await readFile(abs, "utf8");
  } catch {
    existing = null;
  }

  const merged = mergeSessionStartHookIntoSettings(existing, { ledger, authorized });
  if (merged.status === "unavailable" || merged.content === null) {
    return {
      relativePath: CLAUDE_SETTINGS_REL,
      status: "unavailable",
      instructions: merged.instructions,
    };
  }

  if (merged.status !== "unchanged") {
    await ensureDir(path.dirname(abs));
    await writeFile(abs, merged.content, "utf8");
  }

  const result: WriteSessionStartHookResult = {
    relativePath: CLAUDE_SETTINGS_REL,
    status: merged.status,
  };
  if (merged.pending && (merged.pending.denyRows.length || merged.pending.hookEntries.length)) {
    result.pending = merged.pending;
  }
  if (authorized && merged.ledgerAdditions && ledgerGrows(ledger, merged.ledgerAdditions)) {
    // Authorized run: a malformed ledger is replaced (operator authority).
    await saveClaudeSettingsLedger(rootDir, merged.ledgerAdditions, { overwriteInvalid: true });
    result.ledgerPath = CLAUDE_SETTINGS_LEDGER_REL;
  }
  return result;
}

function ledgerGrows(ledger: ClaudeSettingsLedger | null, add: ClaudeLedgerAdditions): boolean {
  if (ledger === null) return true;
  const rows = new Set(ledger.denyRowsWritten);
  const hooks = new Set(ledger.hookEntriesWritten.map((h) => `${h.event}\0${h.marker}`));
  return (
    add.denyRowsWritten.some((r) => !rows.has(r)) ||
    add.hookEntriesWritten.some((h) => !hooks.has(`${h.event}\0${h.marker}`))
  );
}

export interface ClaudeSettingsDriftReport {
  /** Kit deny rows the merge would add (ledger present, operator never had them). */
  denyRows: string[];
  /** Kit rows with no ledger to say whether the operator deleted them. */
  ambiguousDenyRows: string[];
  /** Kit hook entries absent from the file (missing or ambiguous). */
  hookEntries: ClaudeHookEntryRecord[];
}

/**
 * Read-only drift check for `update`: never writes the settings file or the
 * ledger. Returns null when there is nothing to report (no settings file, no
 * kit marker, unparseable file, unsafe symlink, or fully current).
 */
export async function planClaudeSettingsDrift(
  rootDir: string,
): Promise<ClaudeSettingsDriftReport | null> {
  const abs = resolveContained(rootDir, CLAUDE_SETTINGS_REL);
  if (!(await isRealWriteTargetContained(rootDir, abs))) return null;
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch {
    return null;
  }
  let existing: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    existing = parsed;
  } catch {
    return null;
  }
  const hooks = isPlainObject(existing.hooks) ? existing.hooks : {};
  const groupsOf = (event: string): unknown[] =>
    Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
  const kitEntries: ClaudeHookEntryRecord[] = [
    { event: SESSION_START_EVENT, marker: SESSION_START_HOOK_MARKER },
    { event: PRE_TOOL_USE_EVENT, marker: GUARD_SHELL_HOOK_MARKER },
  ];
  const present = kitEntries.filter((e) =>
    groupsOf(e.event).some((g) => groupHasMarker(g, e.marker)),
  );
  if (present.length === 0) return null;

  let ledger: ClaudeSettingsLedger | null;
  try {
    ledger = await loadClaudeSettingsLedger(rootDir);
  } catch (err) {
    if (err instanceof ClaudeSettingsLedgerSymlinkError) return null;
    throw err;
  }
  const merged = mergeSessionStartHookIntoSettings(raw, { ledger, authorized: false });
  if (merged.content === null) return null;
  const next = JSON.parse(merged.content) as Record<string, unknown>;
  const deny = (r: Record<string, unknown>): string[] =>
    isPlainObject(r.permissions) && Array.isArray(r.permissions.deny)
      ? r.permissions.deny.filter((x): x is string => typeof x === "string")
      : [];
  const had = new Set(deny(existing));
  const denyRows = deny(next).filter((r) => !had.has(r));
  const ambiguousDenyRows = merged.pending?.denyRows ?? [];
  const missingEntries = kitEntries.filter((e) => !present.includes(e));
  const ledgerHas = (e: ClaudeHookEntryRecord): boolean =>
    Boolean(ledger?.hookEntriesWritten.some((h) => h.event === e.event && h.marker === e.marker));
  // A ledger-recorded deletion is the operator's choice: not drift.
  const hookEntries = missingEntries.filter((e) => !ledgerHas(e));
  if (denyRows.length === 0 && ambiguousDenyRows.length === 0 && hookEntries.length === 0) {
    return null;
  }
  return { denyRows, ambiguousDenyRows, hookEntries };
}

export function formatClaudeSettingsDrift(
  report: ClaudeSettingsDriftReport,
  opts: { protectedPath: boolean },
): string[] {
  const rows = [...report.denyRows, ...report.ambiguousDenyRows];
  const lines = [
    `Claude settings drift in ${CLAUDE_SETTINGS_REL}${opts.protectedPath ? " (protected (skipped))" : ""}: update did not write it.`,
  ];
  if (rows.length > 0) {
    lines.push("Add to permissions.deny:", JSON.stringify(rows, null, 2));
    if (report.ambiguousDenyRows.length > 0) {
      lines.push(
        `(${report.ambiguousDenyRows.length} row(s) ambiguous: no ${CLAUDE_SETTINGS_LEDGER_REL} ledger, so a deliberate deletion cannot be told apart.)`,
      );
    }
  }
  if (report.hookEntries.length > 0) {
    lines.push("Missing hook entries (add by hand or use the command below):");
    for (const e of report.hookEntries) lines.push(`  ${e.event}: ${e.marker}`);
  }
  lines.push("Apply with: agent-kit update --claude");
  return lines;
}
