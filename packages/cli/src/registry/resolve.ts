import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileExists } from "../utils/fs.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_REGISTRY_URL = "https://github.com/agent-kit-startup/agent-kit";
export const DEFAULT_REGISTRY_REF = "main";

// url/ref can come from a project's committed .cursor/agent-kit.json — treat as
// untrusted input. Restrict to https and block git argument injection (leading -)
// and exotic transports (ext::, file://, ssh aliases) that can execute commands.
const SAFE_URL = /^https:\/\/[^\s]+$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function assertSafeRegistrySource(url: string, ref: string): void {
  if (!SAFE_URL.test(url)) {
    throw new Error(
      `Refusing registry url "${url}": only https:// URLs are allowed. Use --registry <local-path> for local checkouts.`,
    );
  }
  if (!SAFE_REF.test(ref)) {
    throw new Error(`Refusing registry ref "${ref}": invalid characters or leading "-".`);
  }
}

/** Env for git subprocesses: refuse non-https transports even if url slips through. */
function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_ALLOW_PROTOCOL: "https" };
}

export type RegistrySource = "cwd" | "flag" | "env" | "remote-cache";

export interface ResolvedRegistry {
  root: string;
  source: RegistrySource;
  url?: string;
  ref?: string;
}

function cacheKey(url: string, ref: string): string {
  return createHash("sha256").update(`${url}@${ref}`).digest("hex").slice(0, 16);
}

async function hasRegistryIndex(root: string): Promise<boolean> {
  return fileExists(path.join(root, "registry", "registry.json"));
}

async function cloneRegistry(url: string, ref: string, dest: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--branch", ref, "--", url, dest], {
      env: gitEnv(),
    });
  } catch {
    // Some refs are tags or default branch only — retry without --branch then checkout.
    await execFileAsync("git", ["clone", "--depth", "1", "--", url, dest], { env: gitEnv() });
    await execFileAsync("git", ["checkout", ref, "--"], { cwd: dest, env: gitEnv() });
  }
}

async function refreshCache(cacheDir: string): Promise<void> {
  try {
    await execFileAsync("git", ["fetch", "--depth", "1", "origin"], {
      cwd: cacheDir,
      env: gitEnv(),
    });
    await execFileAsync("git", ["reset", "--hard", "FETCH_HEAD"], {
      cwd: cacheDir,
      env: gitEnv(),
    });
  } catch {
    // Offline / shallow quirks — keep existing cache.
  }
}

/**
 * Resolve where registry files live.
 * Order: --registry flag → AGENT_KIT_REGISTRY → cwd (if has registry/) → remote cache.
 */
export async function resolveRegistryRoot(options: {
  cwd: string;
  registryPath?: string;
  registryUrl?: string;
  registryRef?: string;
  refresh?: boolean;
}): Promise<ResolvedRegistry> {
  if (options.registryPath) {
    const root = path.resolve(options.registryPath);
    if (!(await hasRegistryIndex(root))) {
      throw new Error(`No registry/registry.json under --registry ${root}`);
    }
    return { root, source: "flag" };
  }

  const envPath = process.env.AGENT_KIT_REGISTRY;
  if (envPath) {
    const root = path.resolve(envPath);
    if (!(await hasRegistryIndex(root))) {
      throw new Error(`No registry/registry.json under AGENT_KIT_REGISTRY=${root}`);
    }
    return { root, source: "env", url: options.registryUrl, ref: options.registryRef };
  }

  if (await hasRegistryIndex(options.cwd)) {
    return {
      root: path.resolve(options.cwd),
      source: "cwd",
      url: options.registryUrl,
      ref: options.registryRef,
    };
  }

  const url = options.registryUrl ?? DEFAULT_REGISTRY_URL;
  const ref = options.registryRef ?? DEFAULT_REGISTRY_REF;
  assertSafeRegistrySource(url, ref);
  const dest = path.join(homedir(), ".cache", "agent-kit", "registry", cacheKey(url, ref));

  if (await hasRegistryIndex(dest)) {
    // Always refresh so L0 artifacts added after the first clone are visible.
    // options.refresh / --refresh remains accepted for CLI/docs compatibility (same path).
    await refreshCache(dest);
    return { root: dest, source: "remote-cache", url, ref };
  }

  await cloneRegistry(url, ref, dest);
  if (!(await hasRegistryIndex(dest))) {
    throw new Error(`Cloned ${url}@${ref} but registry/registry.json is missing`);
  }
  return { root: dest, source: "remote-cache", url, ref };
}
