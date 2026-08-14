import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileExists } from "../utils/fs.js";

const execFileAsync = promisify(execFile);

const LOCK_TIMEOUT_MS = 60_000;
const LOCK_RETRY_MS = 200;
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_REFRESH_MS = 10_000;

interface LockOwner {
  pid: number;
  uuid: string;
  updatedAt: number;
}

function lockOwnerPath(lockDir: string): string {
  return path.join(lockDir, "owner.json");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLockOwner(lockDir: string): Promise<LockOwner | null> {
  try {
    const raw = await readFile(lockOwnerPath(lockDir), "utf8");
    const parsed = JSON.parse(raw) as LockOwner;
    if (typeof parsed.pid === "number" && typeof parsed.uuid === "string") {
      return parsed;
    }
  } catch {}
  return null;
}

async function writeLockOwner(lockDir: string, owner: LockOwner): Promise<void> {
  // Atomic publish: never leave an observable lock dir without a complete owner file.
  // Per-write nonce: the uuid alone is constant for the holder's lifetime, so an
  // overlapping refresh write to the same tmp path could interleave and publish
  // corrupt bytes. Stray tmp files are swept by the recursive rm on release.
  const finalPath = lockOwnerPath(lockDir);
  const tmpPath = path.join(lockDir, `owner.${owner.uuid}.${randomUUID()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(owner), "utf8");
  await rename(tmpPath, finalPath);
}

async function refreshLockOwner(lockDir: string, uuid: string): Promise<void> {
  const owner = await readLockOwner(lockDir);
  // Another holder's lock: never touch it.
  if (owner && owner.uuid !== uuid) return;
  // owner === null while we hold the lock means our owner.json is missing or
  // corrupt. Without healing, the fail-closed release could never remove the
  // lock and peers would stall until stale reclaim (up to LOCK_STALE_MS).
  await writeLockOwner(lockDir, { pid: process.pid, uuid, updatedAt: Date.now() });
}

async function releaseCacheLock(lockDir: string, uuid: string): Promise<void> {
  const claimPath = path.join(lockDir, `releasing.${uuid}`);
  try {
    // Atomically claim the owner file (rename) instead of check-then-`rm -rf`:
    // a bare read → rm window let a stale-reclaim + successor republish land in
    // between, deleting the successor's fresh lock. The rename also bumps the
    // lock dir mtime, which keeps tryReclaimStaleLock away for LOCK_STALE_MS
    // while we verify and remove.
    await rename(lockOwnerPath(lockDir), claimPath);
  } catch {
    // No owner file (or dir gone): fail closed, nothing of ours to release.
    return;
  }
  let claimed: LockOwner | null = null;
  try {
    const raw = await readFile(claimPath, "utf8");
    const parsed = JSON.parse(raw) as LockOwner;
    if (typeof parsed.pid === "number" && typeof parsed.uuid === "string") {
      claimed = parsed;
    }
  } catch {}
  if (!claimed || claimed.uuid !== uuid) {
    // We grabbed a successor's (or corrupt) owner file — put it back and abort.
    try {
      await rename(claimPath, lockOwnerPath(lockDir));
    } catch {}
    return;
  }
  try {
    await rm(lockDir, { recursive: true, force: true });
  } catch {}
}

/**
 * Stale-reclaim mtime semantics (intentional, pinned by test): every owner
 * refresh publishes via tmp + rename inside the lock dir, which bumps the lock
 * dir's mtime. The `mtimeMs > LOCK_STALE_MS` gate below therefore measures
 * time since the last heartbeat (liveness), not time since acquisition — a
 * dead owner becomes reclaimable LOCK_STALE_MS after its last refresh, while a
 * long-running live install stays protected by refreshes (and by the
 * isProcessAlive + ownerFresh short-circuit).
 */
async function tryReclaimStaleLock(lockDir: string): Promise<boolean> {
  let owner: LockOwner | null;
  let lockStat: Awaited<ReturnType<typeof stat>>;
  try {
    lockStat = await stat(lockDir);
    owner = await readLockOwner(lockDir);
  } catch {
    return false;
  }

  const now = Date.now();
  if (owner) {
    const ownerFresh = now - owner.updatedAt < LOCK_STALE_MS;
    if (isProcessAlive(owner.pid) && ownerFresh) {
      // Owner is still alive and refreshing; do not reclaim.
      return false;
    }
  }

  if (now - lockStat.mtimeMs > LOCK_STALE_MS) {
    try {
      await rm(lockDir, { recursive: true, force: true });
      return true;
    } catch {}
  }
  return false;
}

async function acquireCacheLock(cacheDir: string): Promise<() => Promise<void>> {
  const lockDir = `${cacheDir}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const uuid = randomUUID();
  const owner: LockOwner = { pid: process.pid, uuid, updatedAt: Date.now() };

  await mkdir(path.dirname(lockDir), { recursive: true });

  let lastErrorCode: string | undefined;
  while (Date.now() < deadline) {
    try {
      await mkdir(lockDir, { recursive: false });
      await writeLockOwner(lockDir, owner);
      // Serialize refreshes: a slow write outliving the interval must not
      // overlap the next one (paired with the per-write tmp nonce).
      let refreshing = false;
      const refreshInterval = setInterval(() => {
        if (refreshing) return;
        refreshing = true;
        refreshLockOwner(lockDir, uuid)
          .catch(() => {})
          .finally(() => {
            refreshing = false;
          });
      }, LOCK_REFRESH_MS);
      return async () => {
        clearInterval(refreshInterval);
        await releaseCacheLock(lockDir, uuid);
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      lastErrorCode = code;
      if (code === "EEXIST") {
        if (await tryReclaimStaleLock(lockDir)) {
          continue;
        }
        await new Promise((r) => setTimeout(r, LOCK_RETRY_MS + Math.random() * 100));
        continue;
      }
      // Lock dir (or its parent) vanished between mkdir and owner publish —
      // peer fail-closed race or concurrent cache clear. Self-heal the parent
      // and back off like EEXIST: a persistent ENOENT must not hot-loop
      // (~3.4k syscalls/sec measured without the delay).
      if (code === "ENOENT") {
        await mkdir(path.dirname(lockDir), { recursive: true });
        await new Promise((r) => setTimeout(r, LOCK_RETRY_MS + Math.random() * 100));
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    lastErrorCode === "ENOENT"
      ? `Timed out acquiring cache lock on ${cacheDir}: the lock parent directory kept vanishing (concurrent cache clear?).`
      : `Timed out waiting for cache lock on ${cacheDir}. Another install may be stuck.`,
  );
}

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
  return fileExists(path.join(root, "registry", "registry.json"));
}

async function cloneRegistry(url: string, ref: string, dest: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--branch", ref, "--", url, dest], {
      env: gitEnv(),
    });
  } catch (firstErr) {
    try {
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

  const unlock = await acquireCacheLock(dest);
  let ownershipTransferred = false;
  try {
    if (await hasRegistryIndex(dest)) {
      await refreshCache(dest);
    } else {
      await cloneRegistry(url, ref, dest);
      if (!(await hasRegistryIndex(dest))) {
        throw new Error(`Cloned ${url}@${ref} but registry/registry.json is missing`);
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
