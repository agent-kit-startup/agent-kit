/**
 * Claude Code command adapters: `.claude/commands/<name>.md` thin pointer
 * files, one per installed `.cursor/commands/<name>.md`, so Claude Code's
 * slash catalog mirrors whatever the consumer actually installed. Opt-in
 * (flag or pack) — see `applyPersonalization`'s `claudeAdapters` input
 * (wired to `install --claude`); this module has no gate of its own.
 *
 * Thin adapters, single SoT (ADR 2026-08-13_claude-cli-kit-load-bootstrap.md,
 * amended 2026-08-21): each generated file is frontmatter + a one-line
 * "read the SoT and follow it" body — no copied command prose. Never
 * generated for the reserved `agent-kit` name: that file is the kit-load
 * `/agent-kit` refresh command (write-once, `claude-kit-load.ts`), a
 * different artifact with no `.cursor/commands/agent-kit.md` counterpart.
 *
 * Overlay semantics: `.claude/commands/` is a `CONSUMER_OVERLAY_PREFIXES`
 * entry (`lifecycle/overlay.ts`). A missing target is written. An existing
 * target whose content already matches the freshly rendered body is left
 * alone. A target that differs is refreshed when it matches the last managed
 * hash (or a known shipped body, ledger-absent) and preserved as customized
 * otherwise — the consumer's hand edits are never silently clobbered.
 *
 * Known limitation (not implemented here, tracked as a follow-up in the ADR
 * amendment): a `.cursor/commands/<name>.md` that is later removed does not
 * cause this pass to delete the corresponding `.claude/commands/<name>.md`.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  contentHash,
  loadManagedHashLedger,
  saveManagedHashLedger,
  shouldPreserveCustomizedOverlay,
} from "../lifecycle/overlay.js";
import { ensureDir, fileExists } from "../utils/fs.js";

export const CURSOR_COMMANDS_DIR_REL = ".cursor/commands";
export const CLAUDE_COMMANDS_DIR_REL = ".claude/commands";

/** The kit-load `/agent-kit` refresh command; never fought by generation. */
export const RESERVED_ADAPTER_NAMES = new Set(["agent-kit"]);

export interface SourceCommand {
  name: string;
  description: string;
}

export type ClaudeCommandAdapterStatus =
  | "applied"
  | "unchanged"
  | "refreshed"
  | "preserved-customized";

export interface ClaudeCommandAdapterResult {
  relativePath: string;
  status: ClaudeCommandAdapterStatus;
}

/** Minimal frontmatter reader for `---\nname: x\ndescription: y\n---` bodies. */
export function parseCommandFrontmatter(name: string, raw: string): SourceCommand | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return null;
  const body = match[1] ?? "";
  const descMatch = /^description:\s*(.+)$/m.exec(body);
  if (!descMatch) return null;
  const description = (descMatch[1] ?? "").trim();
  if (!description) return null;
  return { name, description };
}

export function renderClaudeCommandAdapter(command: SourceCommand): string {
  return `---
description: ${command.description}
---

Read \`.cursor/commands/${command.name}.md\` now and follow that contract exactly — it is the source of truth for /${command.name}; this file is only a thin adapter for Claude Code.

Adapter rules (Claude Code CLI):
- Cursor "Ask questions" is unavailable here: use AskUserQuestion when possible, else present the same labels as one numbered list per message and WAIT for the answer.
- Skip or cancel means stop.
- Never \`/git-prod\` without an explicit operator yes.
- Do not clone Cursor hooks or invent behavior beyond the SoT file.
`;
}

/**
 * Discover installed `.cursor/commands/*.md` and their name + description.
 * An unreadable directory (not installed) yields an empty list, not a throw.
 * Sources missing a parseable `description:` are skipped rather than
 * generating a broken adapter.
 */
export async function discoverInstalledCommands(rootDir: string): Promise<SourceCommand[]> {
  const dir = path.join(rootDir, CURSOR_COMMANDS_DIR_REL);
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const commands: SourceCommand[] = [];
  for (const file of entries.sort()) {
    const name = file.slice(0, -3);
    if (RESERVED_ADAPTER_NAMES.has(name)) continue;
    try {
      const raw = await readFile(path.join(dir, file), "utf8");
      const parsed = parseCommandFrontmatter(name, raw);
      if (parsed) commands.push(parsed);
    } catch {
      // Unreadable source file: skip it, do not fail the whole pass.
    }
  }
  return commands;
}

/**
 * Generate/refresh `.claude/commands/<name>.md` pointer adapters for every
 * installed `.cursor/commands/*.md`. No adapter is written for a command the
 * consumer did not install. Caller decides whether to invoke this at all
 * (opt-in gate lives in `applyPersonalization` / `install`, not here).
 */
export async function generateClaudeCommandAdapters(
  rootDir: string,
): Promise<ClaudeCommandAdapterResult[]> {
  const commands = await discoverInstalledCommands(rootDir);
  if (commands.length === 0) return [];

  const ledger = await loadManagedHashLedger(rootDir);
  const results: ClaudeCommandAdapterResult[] = [];
  let ledgerDirty = false;

  for (const command of commands) {
    const relPath = path.posix.join(CLAUDE_COMMANDS_DIR_REL, `${command.name}.md`);
    const rendered = renderClaudeCommandAdapter(command);
    const abs = path.join(rootDir, relPath);

    if (!(await fileExists(abs))) {
      await ensureDir(path.dirname(abs));
      await writeFile(abs, rendered, "utf8");
      ledger.hashes[relPath] = contentHash(rendered);
      ledgerDirty = true;
      results.push({ relativePath: relPath, status: "applied" });
      continue;
    }

    const localContent = await readFile(abs, "utf8");
    if (localContent === rendered) {
      if (ledger.hashes[relPath] !== contentHash(rendered)) {
        ledger.hashes[relPath] = contentHash(rendered);
        ledgerDirty = true;
      }
      results.push({ relativePath: relPath, status: "unchanged" });
      continue;
    }

    if (shouldPreserveCustomizedOverlay(localContent, ledger.hashes[relPath])) {
      results.push({ relativePath: relPath, status: "preserved-customized" });
      continue;
    }

    await writeFile(abs, rendered, "utf8");
    ledger.hashes[relPath] = contentHash(rendered);
    ledgerDirty = true;
    results.push({ relativePath: relPath, status: "refreshed" });
  }

  if (ledgerDirty) await saveManagedHashLedger(rootDir, ledger);
  return results;
}
