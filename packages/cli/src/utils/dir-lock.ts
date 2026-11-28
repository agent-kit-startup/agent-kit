import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Cross-process directory lock: `${target}.lock/` holds an `owner.json`
 * ({pid, uuid, updatedAt}) published by temp-file + rename and refreshed while
 * held. A dead or silent owner is reclaimed after {@link LOCK_STALE_MS}.
 *
 * Extracted from `registry/resolve.ts` (registry cache lock) so the machine
 * install registry (`installs/store.ts`) uses the exact same pattern
 * (ADR 2026-08-02 amend 2026-11-26).
 */

const DEFAULT_LOCK_TIMEOUT_MS = 60_000;
const LOCK_RETRY_MS = 200;
export const LOCK_STALE_MS = 5 * 60_000;
const LOCK_REFRESH_MS = 10_000;

interface LockOwner {
  pid: number;
  uuid: string;
  updatedAt: number;
}

export interface DirLockOptions {
  /** Give up after this many ms (default 60 s). */
  timeoutMs?: number;
  /** Error text when the lock parent kept vanishing (ENOENT loop). */
  vanishedMessage?: (target: string) => string;
  /** Error text when another holder kept the lock past the timeout. */
  timeoutMessage?: (target: string) => string;
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

export async function refreshLockOwner(lockDir: string, uuid: string): Promise<void> {
  const owner = await readLockOwner(lockDir);
  // Another holder's lock: never touch it.
  if (owner && owner.uuid !== uuid) return;
  // owner === null while we hold the lock means our owner.json is missing or
  // corrupt. Without healing, the fail-closed release could never remove the
  // lock and peers would stall until stale reclaim (up to LOCK_STALE_MS).
  await writeLockOwner(lockDir, { pid: process.pid, uuid, updatedAt: Date.now() });
}

export async function releaseDirLock(lockDir: string, uuid: string): Promise<void> {
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
 * long-running live holder stays protected by refreshes (and by the
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

/**
 * Acquire `${target}.lock`. Resolves to the release function; call it in a
 * `finally` (the refresh interval keeps the process alive until released).
 */
export async function acquireDirLock(
  target: string,
  options: DirLockOptions = {},
): Promise<() => Promise<void>> {
  const lockDir = `${target}.lock`;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
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
        await releaseDirLock(lockDir, uuid);
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
      ? (options.vanishedMessage?.(target) ??
          `Timed out acquiring lock on ${target}: the lock parent directory kept vanishing.`)
      : (options.timeoutMessage?.(target) ?? `Timed out waiting for lock on ${target}.`),
  );
}
