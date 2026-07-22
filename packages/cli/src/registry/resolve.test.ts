import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REGISTRY_REF,
  DEFAULT_REGISTRY_URL,
  assertSafeRegistrySource,
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
});
