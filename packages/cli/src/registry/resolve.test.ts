import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REGISTRY_REF,
  DEFAULT_REGISTRY_URL,
  acquireCacheLock,
  assertSafeRegistrySource,
  releaseCacheLock,
  resolveRegistryRoot,
} from "./resolve.js";

const homedirMock = vi.hoisted(() => vi.fn(() => tmpdir()));
const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:os", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:os")>();
  return { ...mod, homedir: () => homedirMock() };
});

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;

function execCallback(args: unknown[]): ExecCb | undefined {
  const last = args[args.length - 1];
  return typeof last === "function" ? (last as ExecCb) : undefined;
}

function gitArgs(args: unknown[]): string[] {
  return Array.isArray(args[1]) ? (args[1] as string[]) : [];
}

describe("assertSafeRegistrySource", () => {
  it("accepts the default public registry", () => {
    expect(() =>
      assertSafeRegistrySource(DEFAULT_REGISTRY_URL, DEFAULT_REGISTRY_REF),
    ).not.toThrow();
  });

  it("accepts https urls with branch/tag refs", () => {
    expect(() =>
      assertSafeRegistrySource("https://github.com/org/repo", "release/v3.1.0"),
    ).not.toThrow();
    expect(() =>
      assertSafeRegistrySource("https://gitlab.com/org/repo.git", "v3.1.0"),
    ).not.toThrow();
  });

  it("rejects command-executing git transports (ext::, ssh, file)", () => {
    expect(() => assertSafeRegistrySource("ext::sh -c 'id>/tmp/pwned'", "main")).toThrow(/https/);
    expect(() => assertSafeRegistrySource("file:///etc", "main")).toThrow(/https/);
    expect(() => assertSafeRegistrySource("ssh://host/repo", "main")).toThrow(/https/);
    expect(() => assertSafeRegistrySource("git@github.com:org/repo.git", "main")).toThrow(/https/);
  });

  it("rejects argument injection via leading dash", () => {
    expect(() => assertSafeRegistrySource("--upload-pack=touch /tmp/x", "main")).toThrow(/https/);
    expect(() => assertSafeRegistrySource("https://github.com/org/repo", "--force")).toThrow(
      /invalid/,
    );
  });

  it("rejects refs with shell metacharacters", () => {
    expect(() => assertSafeRegistrySource("https://github.com/org/repo", "main; rm -rf")).toThrow(
      /invalid/,
    );
  });
});

describe("resolveRegistryRoot remote-cache", () => {
  let cacheHome: string;
  let projectCwd: string;

  beforeEach(async () => {
    cacheHome = await mkdtemp(path.join(tmpdir(), "agent-kit-cache-home-"));
    projectCwd = await mkdtemp(path.join(tmpdir(), "agent-kit-project-"));
    homedirMock.mockReturnValue(cacheHome);
    execFileMock.mockReset();
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = execCallback(args);
      queueMicrotask(() => cb?.(null, "", ""));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function seedRemoteCache(contents = '{"stale":true}\n'): Promise<string> {
    // Mirror cacheKey(url, ref) layout under mocked homedir.
    const { createHash } = await import("node:crypto");
    const key = createHash("sha256")
      .update(`${DEFAULT_REGISTRY_URL}@${DEFAULT_REGISTRY_REF}`)
      .digest("hex")
      .slice(0, 16);
    const dest = path.join(cacheHome, ".cache", "agent-kit", "registry", key);
    await mkdir(path.join(dest, "registry"), { recursive: true });
    await writeFile(path.join(dest, "registry", "registry.json"), contents, "utf8");
    return dest;
  }

  it("refreshes an existing remote-cache even without refresh:true", async () => {
    const dest = await seedRemoteCache();

    const resolved = await resolveRegistryRoot({ cwd: projectCwd });

    expect(resolved.source).toBe("remote-cache");
    expect(resolved.root).toBe(dest);
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["fetch", "--depth", "1", "origin"],
      expect.objectContaining({ cwd: dest }),
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["reset", "--hard", "FETCH_HEAD"],
      expect.objectContaining({ cwd: dest }),
      expect.any(Function),
    );
  });

  it("keeps the existing cache when refresh fetch fails", async () => {
    const stale = '{"stale":true,"keep":1}\n';
    const dest = await seedRemoteCache(stale);

    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = execCallback(args);
      const argv = gitArgs(args);
      if (argv[0] === "fetch") {
        queueMicrotask(() => cb?.(new Error("offline"), "", ""));
        return;
      }
      queueMicrotask(() => cb?.(null, "", ""));
    });

    const resolved = await resolveRegistryRoot({ cwd: projectCwd, refresh: true });

    expect(resolved.root).toBe(dest);
    expect(await readFile(path.join(dest, "registry", "registry.json"), "utf8")).toBe(stale);
  });

  it("clones when remote-cache is missing (no fetch)", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = execCallback(args);
      const argv = gitArgs(args);
      queueMicrotask(async () => {
        if (argv[0] === "clone") {
          const dest = argv[argv.length - 1] as string;
          await mkdir(path.join(dest, "registry"), { recursive: true });
          await writeFile(path.join(dest, "registry", "registry.json"), '{"fresh":true}\n', "utf8");
        }
        cb?.(null, "", "");
      });
    });

    const resolved = await resolveRegistryRoot({ cwd: projectCwd });

    expect(resolved.source).toBe("remote-cache");
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone", "--depth", "1"]),
      expect.any(Object),
      expect.any(Function),
    );
    const fetchCalls = execFileMock.mock.calls.filter((call) => gitArgs(call)[0] === "fetch");
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns an unlock function for remote-cache (caller releases after copy)", async () => {
    const dest = await seedRemoteCache();
    const resolved = await resolveRegistryRoot({ cwd: projectCwd });

    expect(resolved.source).toBe("remote-cache");
    expect(resolved.root).toBe(dest);
    expect(typeof resolved.unlock).toBe("function");

    const lockDir = `${dest}.lock`;
    const locked = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(locked).toBe(true);

    await resolved.unlock?.();
    const unlocked = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(unlocked).toBe(false);
  });
});

describe("acquireCacheLock", () => {
  it("acquires and releases a lock directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-lock-"));
    const target = path.join(dir, "cache-target");
    const unlock = await acquireCacheLock(target);
    const lockDir = `${target}.lock`;
    const lockExists = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(lockExists).toBe(true);
    await unlock();
    const afterRelease = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(afterRelease).toBe(false);
  });

  it("writes a PID/UUID owner marker and removes it on release", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-lock-"));
    const target = path.join(dir, "cache-target");
    const unlock = await acquireCacheLock(target);
    const lockDir = `${target}.lock`;
    const ownerRaw = await readFile(path.join(lockDir, "owner.json"), "utf8");
    const owner = JSON.parse(ownerRaw) as { pid: number; uuid: string };
    expect(owner.pid).toBe(process.pid);
    expect(owner.uuid).toMatch(/^[0-9a-f-]{36}$/);
    await unlock();
    const afterRelease = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(afterRelease).toBe(false);
  });

  it("second caller waits until first releases", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-lock-"));
    const target = path.join(dir, "cache-target");
    const unlock1 = await acquireCacheLock(target);
    const events: string[] = [];
    const p2 = acquireCacheLock(target).then((unlock) => {
      events.push("acquired");
      return unlock;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(events).not.toContain("acquired");
    await unlock1();
    const unlock2 = await p2;
    expect(events).toContain("acquired");
    await unlock2();
  });

  it("reclaims a stale lock owned by a dead process", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-lock-"));
    const target = path.join(dir, "cache-target");
    const lockDir = `${target}.lock`;
    await mkdir(lockDir, { recursive: true });
    const deadPid = 999_999_999;
    const staleUpdatedAt = Date.now() - 6 * 60_000;
    await writeFile(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: deadPid, uuid: "dead-uuid", updatedAt: staleUpdatedAt }),
      "utf8",
    );
    const oldDate = new Date(staleUpdatedAt);
    await utimes(lockDir, oldDate, oldDate);

    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid: number) => {
      if (pid === deadPid) throw new Error("ESRCH");
      return true;
    });
    try {
      const unlock = await acquireCacheLock(target);
      const ownerRaw = await readFile(path.join(lockDir, "owner.json"), "utf8");
      const owner = JSON.parse(ownerRaw) as { pid: number; uuid: string };
      expect(owner.pid).toBe(process.pid);
      expect(owner.uuid).not.toBe("dead-uuid");
      await unlock();
    } finally {
      killSpy.mockRestore();
    }
  });

  it("does not reclaim a fresh lock owned by a living process", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-lock-"));
    const target = path.join(dir, "cache-target");
    const unlock1 = await acquireCacheLock(target);
    const events: string[] = [];
    const p2 = acquireCacheLock(target).then((unlock) => {
      events.push("acquired");
      return unlock;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(events).not.toContain("acquired");
    await unlock1();
    const unlock2 = await p2;
    expect(events).toContain("acquired");
    await unlock2();
  });

  it("releaseCacheLock fail-closes when owner metadata is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-lock-"));
    const target = path.join(dir, "cache-target");
    const unlock = await acquireCacheLock(target);
    const lockDir = `${target}.lock`;
    await rm(path.join(lockDir, "owner.json"));
    // Ownerless successor publish window: releasing uuid must not delete the lock.
    await releaseCacheLock(lockDir, "former-owner-uuid");
    const stillThere = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(stillThere).toBe(true);
    // Cleanup: restore a matching owner so unlock can release, then leave dir clean.
    await writeFile(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, uuid: "cleanup", updatedAt: Date.now() }),
      "utf8",
    );
    await releaseCacheLock(lockDir, "cleanup");
    await unlock().catch(() => {});
  });

  it("releaseCacheLock fail-closes on malformed owner metadata", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-lock-"));
    const lockDir = path.join(dir, "cache-target.lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), "{not-json", "utf8");
    await releaseCacheLock(lockDir, "any-uuid");
    const stillThere = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(stillThere).toBe(true);
    await rm(lockDir, { recursive: true, force: true });
  });

  it("does not delete a successor lock when prior unlock races owner-less window", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-lock-"));
    const target = path.join(dir, "cache-target");
    const lockDir = `${target}.lock`;
    // Simulate successor: mkdir succeeded, owner.json not published yet.
    await mkdir(lockDir, { recursive: false });
    await releaseCacheLock(lockDir, "prior-holder-uuid");
    const successorStillHolds = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(successorStillHolds).toBe(true);
    // Successor can still publish and release normally.
    await writeFile(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, uuid: "successor", updatedAt: Date.now() }),
      "utf8",
    );
    await releaseCacheLock(lockDir, "successor");
    const gone = await stat(lockDir)
      .then(() => true)
      .catch(() => false);
    expect(gone).toBe(false);
  });
});
