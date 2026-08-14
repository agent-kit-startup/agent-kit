import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { acquireCacheLock } from "./resolve.js";

// Separate file: the node:fs/promises mock below is module-wide and must not
// leak into the ordinary resolve tests.
const mkdirControl = vi.hoisted(() => ({
  failFor: "",
  failuresLeft: 0,
  calls: [] as Array<{ target: string; recursive: boolean }>,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async (target: string, options?: { recursive?: boolean }) => {
      mkdirControl.calls.push({ target, recursive: options?.recursive === true });
      if (target === mkdirControl.failFor && mkdirControl.failuresLeft > 0) {
        mkdirControl.failuresLeft -= 1;
        const err = new Error(
          `ENOENT: no such file or directory, mkdir '${target}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return actual.mkdir(target, options);
    },
  };
});

describe("acquireCacheLock ENOENT compensator", () => {
  it("backs off, re-creates the parent, and still acquires after transient ENOENT", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-lock-enoent-"));
    const target = path.join(dir, "cache-target");
    const lockDir = `${target}.lock`;

    mkdirControl.failFor = lockDir;
    mkdirControl.failuresLeft = 2;
    mkdirControl.calls = [];

    const started = Date.now();
    const unlock = await acquireCacheLock(target);
    const elapsed = Date.now() - started;

    // Both injected ENOENTs were consumed and acquisition still succeeded.
    expect(mkdirControl.failuresLeft).toBe(0);
    const lockExists = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(lockExists).toBe(true);

    // No hot loop: each ENOENT retry waits the jittered LOCK_RETRY_MS (200ms) backoff.
    expect(elapsed).toBeGreaterThanOrEqual(380);

    // Parent self-heal: initial recursive mkdir plus one per ENOENT compensation.
    const parentHeals = mkdirControl.calls.filter(
      (call) => call.target === path.dirname(lockDir) && call.recursive,
    );
    expect(parentHeals.length).toBeGreaterThanOrEqual(3);

    // Bounded attempts: 2 failures + 1 success on the lock dir, not a spin.
    const lockAttempts = mkdirControl.calls.filter((call) => call.target === lockDir);
    expect(lockAttempts.length).toBe(3);

    await unlock();
    const released = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(released).toBe(false);
  });
});
