import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { acquireDirLock, refreshLockOwner, releaseDirLock } from "../utils/dir-lock.js";
import { fileExists } from "../utils/fs.js";
import { REGISTRY_INDEX_REL } from "./paths.js";

const execFileAsync = promisify(execFile);

/** Registry cache lock (`${cacheDir}.lock`); the pattern lives in utils/dir-lock.ts. */
function acquireCacheLock(cacheDir: string): Promise<() => Promise<void>> {
  return acquireDirLock(cacheDir, {
    vanishedMessage: (target) =>
      `Timed out acquiring cache lock on ${target}: the lock parent directory kept vanishing (concurrent cache clear?).`,
    timeoutMessage: (target) =>
      `Timed out waiting for cache lock on ${target}. Another install may be stuck.`,
  });
}

const releaseCacheLock = releaseDirLock;

// refreshLockOwner is exported for tests only (like releaseCacheLock); none of
// these are re-exported from a package entry point.
export { acquireCacheLock, refreshLockOwner, releaseCacheLock };

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
  /** Release the cache lock when the caller is done reading/writing from {@link root}. */
  unlock?: () => Promise<void>;
}

function cacheKey(url: string, ref: string): string {
  return createHash("sha256").update(`${url}@${ref}`).digest("hex").slice(0, 16);
}

async function hasRegistryIndex(root: string): Promise<boolean> {
  return fileExists(path.join(root, REGISTRY_INDEX_REL));
}

async function cloneRegistry(url: string, ref: string, dest: string): Promise<void> {
  const { mkdir, rm } = await import("node:fs/promises");
  await mkdir(path.dirname(dest), { recursive: true });
  // A killed or failed clone leaves a partial dest that makes every later clone fail
  // with "already exists". The caller holds `${dest}.lock`, so clearing dest is safe.
  const clearPartial = () => rm(dest, { recursive: true, force: true });
  await clearPartial();
  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--branch", ref, "--", url, dest], {
      env: gitEnv(),
    });
  } catch (firstErr) {
    try {
      await clearPartial();
      await execFileAsync("git", ["clone", "--depth", "1", "--", url, dest], { env: gitEnv() });
      await execFileAsync("git", ["checkout", ref, "--"], { cwd: dest, env: gitEnv() });
    } catch (secondErr) {
      const msg = secondErr instanceof Error ? secondErr.message : String(secondErr);
      if (/403|Authentication|could not read Username/i.test(msg)) {
        throw new Error(
          `Registry clone failed (auth/access): ${url}@${ref}. Check git credentials or use --registry <local-path> for a local checkout.`,
        );
      }
      if (/Could not resolve host|Network is unreachable|Connection refused/i.test(msg)) {
        throw new Error(
          `Registry clone failed (network): ${url}@${ref}. Check network/proxy settings or use --registry <local-path>.`,
        );
      }
      throw new Error(
        `Registry clone failed: ${url}@${ref}. ${msg}. Use --registry <local-path> if you have a local checkout.`,
      );
    }
  }
}

async function refreshCache(cacheDir: string, ref: string): Promise<void> {
  try {
    // Fetch the pinned ref explicitly: a bare fetch follows the clone's default-branch
    // refspec, and the reset below would silently move a pinned cache to that tip.
    await execFileAsync("git", ["fetch", "--depth", "1", "origin", ref], {
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
      throw new Error(`No ${REGISTRY_INDEX_REL} under --registry ${root}`);
    }
    return { root, source: "flag" };
  }

  const envPath = process.env.AGENT_KIT_REGISTRY;
  if (envPath) {
    const root = path.resolve(envPath);
    if (!(await hasRegistryIndex(root))) {
      throw new Error(`No ${REGISTRY_INDEX_REL} under AGENT_KIT_REGISTRY=${root}`);
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

  const unlock = await acquireCacheLock(dest);
  let ownershipTransferred = false;
  try {
    if (await hasRegistryIndex(dest)) {
      await refreshCache(dest, ref);
    } else {
      await cloneRegistry(url, ref, dest);
      if (!(await hasRegistryIndex(dest))) {
        throw new Error(`Cloned ${url}@${ref} but ${REGISTRY_INDEX_REL} is missing`);
      }
    }
    ownershipTransferred = true;
    return { root: dest, source: "remote-cache", url, ref, unlock };
  } finally {
    if (!ownershipTransferred) {
      await unlock();
    }
  }
}
