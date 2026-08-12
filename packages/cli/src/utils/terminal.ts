/**
 * Terminal environment detection helpers.
 * Used by install and init commands to handle non-interactive terminals
 * (piped stdin, CI, VS Code output panels without TTY).
 */

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

/** Validate that a resolved path looks like a project root, not a global directory. */
export async function validateProjectRoot(
  resolved: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const home = path.resolve(homedir());
  if (resolved === "/" || resolved === home) {
    return { ok: false, reason: `Refused to use ${resolved} as a project root.` };
  }
  const hasGit = await fileExists(path.join(resolved, ".git"));
  const hasManifest = await fileExists(path.join(resolved, ".cursor", "agent-kit.json"));
  if (!hasGit && !hasManifest) {
    return {
      ok: false,
      reason: `Refused ${resolved}: no .git and no .cursor/agent-kit.json. Run from a project directory or use --force-root.`,
    };
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
      throw new RootRefusedError(resolved, validation.reason);
    }
    // Interactive mode still confirms, but warns and defaults to refusing.
    const ok = await confirm({
      message: `${validation.reason} Proceed anyway?`,
      initialValue: false,
    });
    if (isCancel(ok) || !ok) {
      throw new RootRefusedError(resolved, validation.reason);
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
  ) {
    super(reason ?? `Refused to write into ${root}. Re-run from the correct project directory.`);
    this.name = "RootRefusedError";
  }
}

export interface InstallErrorHint {
  kind: "eperm" | "registry-auth" | "network" | "unknown";
  message: string;
  recovery: string;
}

export function classifyInstallError(err: unknown): InstallErrorHint {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as NodeJS.ErrnoException)?.code;

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
