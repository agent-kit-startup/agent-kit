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
 * The one case merge cannot handle safely — existing `.claude/settings.json`
 * that is not valid JSON — degrades to `print-instructions` (`unavailable`
 * status): never guess at repairing a file we cannot parse, but never go
 * silent either.
 *
 * Command line: resolution reuses the existing L0-installed
 * `.cursor/hooks/agent/resolve-agent-kit.sh` (env override -> PATH ->
 * `node_modules/.bin/agent-kit` -> factory `packages/cli/dist` fallback),
 * addressed via Claude Code's `${CLAUDE_PROJECT_DIR}` placeholder so the
 * command resolves correctly regardless of session cwd or worktree (live
 * docs: "${CLAUDE_PROJECT_DIR}: the project root where the session
 * started... stays put" even inside a worktree). No new `.claude/hooks/`
 * script is generated — the ADR amendment sanctions "a thin shell-out from
 * settings.json", not a new script surface, and this reuses a script that
 * already ships as part of unconditional L0.
 *
 * Fail-open: `exec` replaces the shell process on success, so the trailing
 * `printf` degraded-mode diagnostic only runs when resolution or exec
 * itself fails; either way the command's own exit status is 0.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../utils/fs.js";

export const CLAUDE_SETTINGS_REL = ".claude/settings.json";
export const RESOLVE_AGENT_KIT_REL = ".cursor/hooks/agent/resolve-agent-kit.sh";

/** Present in every kit-generated SessionStart command; identifies the kit-owned entry for merge/idempotency/removal. */
export const SESSION_START_HOOK_MARKER = "hook session-start --format claude";

export const SESSION_START_DEGRADED_TEXT =
  "Agent Kit hooks are running in degraded fail-open mode: the agent-kit CLI could not be resolved (checked AGENT_KIT_HOOK_BIN, PATH, node_modules/.bin/agent-kit). Slash command adapters still work; session-context injection is inactive. Fix: install the CLI (npm i -D @dadado/agent-kit-cli) or set AGENT_KIT_HOOK_BIN.";

export function buildSessionStartHookCommand(): string {
  return (
    `. "\${CLAUDE_PROJECT_DIR}/${RESOLVE_AGENT_KIT_REL}" 2>/dev/null && resolve_agent_kit && exec $AGENT_KIT_RESOLVED hook session-start --format claude; ` +
    `printf '%s' ${shellSingleQuote(SESSION_START_DEGRADED_TEXT)}`
  );
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
function groupHasMarker(group: unknown): boolean {
  if (!isPlainObject(group) || !Array.isArray(group.hooks)) return false;
  return group.hooks.some(
    (h) =>
      isPlainObject(h) &&
      typeof h.command === "string" &&
      h.command.includes(SESSION_START_HOOK_MARKER),
  );
}

export type SessionStartHookStatus = "applied" | "unchanged" | "refreshed" | "unavailable";

export interface SessionStartHookMergeResult {
  content: string | null;
  status: SessionStartHookStatus;
  /** Only set on "unavailable": what to tell the operator to paste by hand. */
  instructions?: string;
}

/**
 * Pure merge: given the existing `.claude/settings.json` text (or null when
 * the file does not exist yet), return the next file content. Never touches
 * any key other than `hooks.SessionStart`; never touches other SessionStart
 * hook groups the user already has.
 */
export function mergeSessionStartHookIntoSettings(
  existingRaw: string | null,
): SessionStartHookMergeResult {
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

  const hooks = isPlainObject(root.hooks) ? { ...root.hooks } : {};
  const sessionStart = Array.isArray(hooks.SessionStart) ? [...hooks.SessionStart] : [];

  const existingIndex = sessionStart.findIndex((g) => groupHasMarker(g));
  let status: SessionStartHookStatus;
  if (existingIndex === -1) {
    sessionStart.push(newGroup);
    status = "applied";
  } else {
    const current = sessionStart[existingIndex];
    if (JSON.stringify(current) === JSON.stringify(newGroup)) {
      status = "unchanged";
    } else {
      sessionStart[existingIndex] = newGroup;
      status = "refreshed";
    }
  }

  hooks.SessionStart = sessionStart;
  root.hooks = hooks;

  return { content: `${JSON.stringify(root, null, 2)}\n`, status };
}

function instructionsBlock(entry: ClaudeSessionStartHookEntry): string {
  return [
    `Could not parse the existing ${CLAUDE_SETTINGS_REL} as JSON, so Agent Kit did not touch it.`,
    "Add this hook by hand under hooks.SessionStart (create the arrays if they do not exist):",
    "",
    JSON.stringify(entry, null, 2),
  ].join("\n");
}

export interface WriteSessionStartHookResult {
  relativePath: string;
  status: SessionStartHookStatus;
  instructions?: string;
}

export async function writeClaudeSessionStartHook(
  rootDir: string,
): Promise<WriteSessionStartHookResult> {
  const abs = path.join(rootDir, CLAUDE_SETTINGS_REL);
  let existing: string | null = null;
  try {
    existing = await readFile(abs, "utf8");
  } catch {
    existing = null;
  }

  const merged = mergeSessionStartHookIntoSettings(existing);
  if (merged.status === "unavailable" || merged.content === null) {
    return {
      relativePath: CLAUDE_SETTINGS_REL,
      status: "unavailable",
      instructions: merged.instructions,
    };
  }
  if (merged.status === "unchanged") {
    return { relativePath: CLAUDE_SETTINGS_REL, status: "unchanged" };
  }

  await ensureDir(path.dirname(abs));
  await writeFile(abs, merged.content, "utf8");
  return { relativePath: CLAUDE_SETTINGS_REL, status: merged.status };
}
