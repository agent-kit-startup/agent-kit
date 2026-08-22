/**
 * Terminal environment detection helpers.
 * Used by install and init commands to handle non-interactive terminals
 * (piped stdin, CI, VS Code output panels without TTY).
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { fileExists } from "./fs.js";

/** True when stdin is not a TTY or CI env vars are set. */
export function isNonInteractive(): boolean {
  if (process.env.CI === "true" || process.env.CI === "1") return true;
  if (process.env.AGENT_KIT_YES === "1") return true;
  return !process.stdin.isTTY;
}

export interface ConfirmProjectRootOptions {
  nonInteractive: boolean;
  command: "install" | "update";
  /** Bypass the ambiguous-root guard. */
  forceRoot?: boolean;
}

/**
 * How many immediate child repositories make a `.git` directory look like a
 * parent-of-repos instead of a project root. One nested repo is a normal
 * vendored/submodule case, so the threshold is two.
 */
export const NESTED_REPO_AMBIGUITY_THRESHOLD = 2;

/** Upper bound on immediate children inspected, so a huge folder stays cheap. */
const NESTED_REPO_SCAN_LIMIT = 200;

/**
 * Names of immediate child directories that contain their own `.git`.
 * One level deep only, never recursive, and stops as soon as the ambiguity
 * threshold is reached. Dot-directories and `node_modules` are skipped.
 */
export async function findNestedRepoChildren(resolved: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(resolved, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested: string[] = [];
  let scanned = 0;
  for (const entry of entries) {
    if (nested.length >= NESTED_REPO_AMBIGUITY_THRESHOLD) break;
    if (scanned >= NESTED_REPO_SCAN_LIMIT) break;
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    scanned += 1;
    if (await fileExists(path.join(resolved, entry.name, ".git"))) {
      nested.push(entry.name);
    }
  }
  return nested;
}

export type ProjectRootValidation =
  | { ok: true }
  /**
   * `reason` is short enough to prefix the interactive "Proceed anyway?"
   * prompt. `recovery` is the multi-line block printed on a hard refusal, so
   * a non-interactive operator is never left with a dead end.
   */
  | { ok: false; reason: string; recovery: string };

/** Validate that a resolved path looks like a project root, not a global directory. */
export async function validateProjectRoot(resolved: string): Promise<ProjectRootValidation> {
  const home = path.resolve(homedir());
  if (resolved === "/" || resolved === home) {
    return {
      ok: false,
      reason: `Refused to use ${resolved} as a project root.`,
      recovery: "Change into a project directory and re-run. Agent Kit installs per project.",
    };
  }
  const hasGit = await fileExists(path.join(resolved, ".git"));
  const hasManifest = await fileExists(path.join(resolved, ".cursor", "agent-kit.json"));
  if (!hasGit && !hasManifest) {
    return {
      ok: false,
      reason: `Refused ${resolved}: no .git and no .cursor/agent-kit.json.`,
      recovery: [
        "Starting from an empty folder? Pick one of these:",
        "  1. git init          - then re-run. Recommended: readiness and the",
        "                         staging -> prod flow both want Git.",
        "  2. --force-root      - install without Git. /agent-kit-onboard will",
        "                         still offer to initialize it later.",
        "  3. Answer yes to the 'Proceed anyway?' prompt in an interactive terminal.",
        "Or re-run from the project directory you actually meant.",
      ].join("\n"),
    };
  }
  // A manifest means the kit was already installed at this exact root, so the
  // operator has confirmed the grain before. Only sniff for a parent-of-repos
  // shape when `.git` alone is what let the directory through.
  if (hasGit && !hasManifest) {
    const nested = await findNestedRepoChildren(resolved);
    if (nested.length >= NESTED_REPO_AMBIGUITY_THRESHOLD) {
      return {
        ok: false,
        reason: `Refused ${resolved}: it has .git but also contains child repositories (${nested.join(", ")}). This looks like a parent-of-repos folder, not a project root.`,
        recovery: [
          "L0 belongs in one project, not in the folder that holds several.",
          "  1. cd into the project you meant, then re-run.",
          "  2. --force-root - only if this parent folder really is the project root.",
        ].join("\n"),
      };
    }
  }
  return { ok: true };
}

/**
 * Confirm the project root before any L0 writes.
 * In interactive mode: prompt the user to confirm the absolute path.
 * In non-interactive mode (--yes / CI): validate the path and refuse ambiguous roots.
 * Returns the resolved absolute path, or throws RootRefusedError if the user refuses.
 */
export async function confirmProjectRoot(
  cwd: string,
  opts: ConfirmProjectRootOptions,
): Promise<string> {
  const resolved = path.resolve(cwd);
  if (opts.forceRoot) {
    return resolved;
  }

  const validation = await validateProjectRoot(resolved);
  if (!validation.ok) {
    if (opts.nonInteractive) {
      throw new RootRefusedError(resolved, validation.reason, validation.recovery);
    }
    // Interactive mode still confirms, but warns and defaults to refusing.
    const ok = await confirm({
      message: `${validation.reason} Proceed anyway?`,
      initialValue: false,
    });
    if (isCancel(ok) || !ok) {
      throw new RootRefusedError(resolved, validation.reason, validation.recovery);
    }
    return resolved;
  }

  if (opts.nonInteractive) {
    return resolved;
  }

  const ok = await confirm({
    message: `${opts.command === "install" ? "Install" : "Update"} Agent Kit in: ${resolved}`,
    initialValue: true,
  });
  if (isCancel(ok) || !ok) {
    throw new RootRefusedError(resolved);
  }
  return resolved;
}

export class RootRefusedError extends Error {
  constructor(
    public readonly root: string,
    reason?: string,
    /** Multi-line "what to do instead" block, printed by the callers. */
    public readonly recovery?: string,
  ) {
    super(reason ?? `Refused to write into ${root}. Re-run from the correct project directory.`);
    this.name = "RootRefusedError";
  }
}

export interface InstallErrorHint {
  kind: "npm-global-eacces" | "eperm" | "registry-auth" | "network" | "unknown";
  message: string;
  recovery: string;
}

/**
 * Matches the classic root-owned npm global prefix failure, e.g.:
 *   EACCES: permission denied, mkdir '/usr/local/lib/node_modules/@dadado'
 *   EACCES: permission denied, access '/usr/local/lib/node_modules'
 *   EACCES: permission denied, mkdir '/usr/lib/node_modules/@dadado' (some Linux distros)
 *   EACCES: permission denied, open '/usr/local/lib/node_modules/.package-lock.json'
 * and a best-effort Windows shape (Program Files\nodejs\node_modules).
 */
const NPM_GLOBAL_PREFIX_PATH_RE = /\/lib\/node_modules|Program Files\\nodejs\\node_modules/;
/** Low-false-positive fallback: EACCES/EPERM plus a bare "node_modules" mention. */
const NPM_GLOBAL_NODE_MODULES_RE = /node_modules/;

function isNpmGlobalPrefixError(msg: string, code: string | undefined): boolean {
  const isPermissionError = code === "EPERM" || code === "EACCES" || /EPERM|EACCES/.test(msg);
  if (!isPermissionError) return false;
  return NPM_GLOBAL_PREFIX_PATH_RE.test(msg) || NPM_GLOBAL_NODE_MODULES_RE.test(msg);
}

export function classifyInstallError(err: unknown): InstallErrorHint {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as NodeJS.ErrnoException)?.code;

  if (isNpmGlobalPrefixError(msg, code)) {
    return {
      kind: "npm-global-eacces",
      message: `Permission error (root-owned npm prefix): ${msg}`,
      recovery: [
        "npm's global install prefix (e.g. /usr/local/lib/node_modules) is owned by root, so global installs fail.",
        "Recovery options:",
        "  1. Run: npx @dadado/agent-kit-cli setup-global (relocates npm's prefix to a folder you own, fixes PATH, reinstalls)",
        '  2. Manual fix: mkdir -p ~/.npm-global && npm config set prefix "~/.npm-global" && export PATH="~/.npm-global/bin:$PATH" (add to your shell profile) && npm i -g @dadado/agent-kit-cli',
        "  3. Use Port B fallback: drag install.md into the Cursor chat",
      ].join("\n"),
    };
  }

  if (code === "EPERM" || code === "EACCES" || /EPERM|EACCES/.test(msg)) {
    return {
      kind: "eperm",
      message: `Permission error: ${msg}`,
      recovery: [
        "The npm cache may have ownership drift (root-written files in a user dir).",
        "Recovery options:",
        "  1. npx --cache .npm-cache @dadado/agent-kit-cli install",
        "  2. npm cache clean --force && npx @dadado/agent-kit-cli install",
        "  3. Use Port B fallback: drag install.md into the Cursor chat",
      ].join("\n"),
    };
  }

  if (/403|Forbidden|unauthorized|E401|ENEEDAUTH/.test(msg)) {
    return {
      kind: "registry-auth",
      message: `Registry access denied: ${msg}`,
      recovery: [
        "The npm registry returned 403/401 for the scoped package.",
        "Recovery options:",
        "  1. Check npm auth: npm whoami (login if needed: npm login)",
        "  2. If using a private registry, verify .npmrc scope config",
        "  3. Use Port B fallback: drag install.md into the Cursor chat",
      ].join("\n"),
    };
  }

  if (
    /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed/.test(msg) ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT"
  ) {
    return {
      kind: "network",
      message: `Network error: ${msg}`,
      recovery: [
        "Could not reach the registry or git remote.",
        "Recovery options:",
        "  1. Check network/proxy/VPN settings",
        "  2. Retry: npx @dadado/agent-kit-cli install",
        "  3. Use --registry <local-path> if you have a local checkout",
      ].join("\n"),
    };
  }

  return {
    kind: "unknown",
    message: msg,
    recovery: "Unexpected error. Check the message above and retry, or use Port B fallback.",
  };
}
