import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectRepeatedFlag, installsCommand } from "../commands/installs.js";
import {
  classifyInstall,
  feedInstallsRegistry,
  type InstallFacts,
  InstallsRegistryError,
  inspectInstall,
  listInstalls,
  pruneMissingInstalls,
  readInstalls,
  recordInstalls,
  resolveInstallsFile,
  sanitizeRemote,
  scanForInstalls,
  upsertInstalls,
} from "./index.js";

const execFileAsync = promisify(execFile);

let scratch: string;
let file: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  return stdout.trim();
}

async function writeManifest(dir: string, version = "6.23.0"): Promise<void> {
  await mkdir(path.join(dir, ".cursor"), { recursive: true });
  await writeFile(
    path.join(dir, ".cursor", "agent-kit.json"),
    JSON.stringify({ schemaVersion: 1, version }),
  );
}

async function initRepo(dir: string, origin?: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await git(dir, "init", "-q", "-b", "main");
  if (origin) await git(dir, "remote", "add", "origin", origin);
  await writeManifest(dir);
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "init");
}

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(path.join(tmpdir(), "ak-installs-")));
  file = path.join(scratch, "config", "agent-kit", "installs.json");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("resolveInstallsFile", () => {
  it("prefers the env override, then an absolute XDG_CONFIG_HOME, then ~/.config", () => {
    expect(resolveInstallsFile({ AGENT_KIT_INSTALLS_FILE: "/x/i.json" }, "/home/u")).toBe(
      "/x/i.json",
    );
    expect(resolveInstallsFile({ XDG_CONFIG_HOME: "/xdg" }, "/home/u")).toBe(
      "/xdg/agent-kit/installs.json",
    );
    expect(resolveInstallsFile({ XDG_CONFIG_HOME: "relative" }, "/home/u")).toBe(
      "/home/u/.config/agent-kit/installs.json",
    );
    expect(resolveInstallsFile({}, "/home/u")).toBe("/home/u/.config/agent-kit/installs.json");
  });

  it("is isolated by the vitest setup (never the operator's real file)", () => {
    expect(process.env.AGENT_KIT_INSTALLS_FILE).toBeTruthy();
    expect(resolveInstallsFile()).toBe(process.env.AGENT_KIT_INSTALLS_FILE);
  });
});

describe("store", () => {
  const row = (p: string) => ({
    path: p,
    remote: null,
    kitVersion: "6.23.0",
    cliVersion: "6.23.0",
    kind: "repo" as const,
  });

  it("reads a missing file as empty and creates nothing", async () => {
    expect(await listInstalls({ file })).toEqual([]);
    expect(existsSync(path.dirname(file))).toBe(false);
  });

  it("upserts by path, sorts, and leaves no temp or lock files", async () => {
    await upsertInstalls([row("/b"), row("/a")], { file });
    await upsertInstalls([{ ...row("/a"), kitVersion: "6.24.0" }], { file });
    const body = JSON.parse(await readFile(file, "utf8"));
    expect(body.schemaVersion).toBe(1);
    expect(body.installs.map((e: { path: string }) => e.path)).toEqual(["/a", "/b"]);
    expect(body.installs[0].kitVersion).toBe("6.24.0");
    expect(body.installs[0].lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await readdir(path.dirname(file))).toEqual(["installs.json"]);
  });

  it("never loses a row under concurrent writers", async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/repo-${String(i).padStart(2, "0")}`);
    await Promise.all(paths.map((p) => upsertInstalls([row(p)], { file })));
    expect((await listInstalls({ file })).map((e) => e.path)).toEqual(paths);
  });

  it("never loses a row under concurrent writer processes", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = path.join(scratch, "writer.mts");
    await writeFile(
      script,
      `import { upsertInstalls } from ${JSON.stringify(path.join(here, "store.ts"))};
const [file, p] = process.argv.slice(2);
await upsertInstalls([{ path: p, remote: null, kitVersion: "1.0.0", cliVersion: "1.0.0", kind: "repo" }], { file });
`,
    );
    const paths = ["/p1", "/p2", "/p3", "/p4"];
    await Promise.all(
      paths.map((p) =>
        execFileAsync(process.execPath, ["--import", "tsx", script, file, p], {
          cwd: path.join(here, "..", ".."),
        }),
      ),
    );
    expect((await listInstalls({ file })).map((e) => e.path)).toEqual(paths);
  }, 30_000);

  it("refuses to rewrite a corrupt or newer-schema file", async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "{not json");
    await expect(upsertInstalls([row("/a")], { file })).rejects.toBeInstanceOf(
      InstallsRegistryError,
    );
    expect(await readFile(file, "utf8")).toBe("{not json");

    const newer = JSON.stringify({ schemaVersion: 2, installs: [] });
    await writeFile(file, newer);
    await expect(readInstalls({ file })).rejects.toThrow(/schemaVersion 2/);
    await expect(upsertInstalls([row("/a")], { file })).rejects.toThrow(/Left untouched/);
    expect(await readFile(file, "utf8")).toBe(newer);
  });

  it("keeps rows it cannot read through a write", async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const future = { path: "/z", kind: "cloud", lastSeen: "x" };
    await writeFile(file, JSON.stringify({ schemaVersion: 1, installs: [future] }));
    await upsertInstalls([row("/a")], { file });
    expect((await listInstalls({ file })).map((e) => e.path)).toEqual(["/a"]);
    expect(JSON.parse(await readFile(file, "utf8")).installs).toContainEqual(future);
    // A recognized row for the same path replaces it.
    await upsertInstalls([row("/z")], { file });
    expect(JSON.parse(await readFile(file, "utf8")).installs).not.toContainEqual(future);
  });

  it("prunes rows whose install is gone and never resurrects them", async () => {
    const live = path.join(scratch, "live");
    const gone = path.join(scratch, "gone");
    await writeManifest(live);
    await writeManifest(gone);
    await recordInstalls([live, gone], { file, tmpRoots: [] });
    await rm(gone, { recursive: true, force: true });

    const removed = await pruneMissingInstalls({ file });
    expect(removed.map((e) => e.path)).toEqual([gone]);
    expect((await listInstalls({ file })).map((e) => e.path)).toEqual([live]);

    // A writer holding a stale view of `gone` re-checks under the lock.
    await upsertInstalls([row(gone)], { file, stillInstalled: async () => existsSync(gone) });
    expect((await listInstalls({ file })).map((e) => e.path)).toEqual([live]);
  });
});

describe("classifyInstall", () => {
  const ownGit = {
    toplevel: "/home/u/code/app",
    gitDir: "/home/u/code/app/.git",
    commonDir: "/home/u/code/app/.git",
  };
  const base: InstallFacts = {
    path: "/home/u/code/app",
    home: "/home/u",
    tmpRoots: ["/tmp"],
    git: {
      toplevel: "/home/u/code/app",
      gitDir: "/home/u/code/app/.git",
      commonDir: "/home/u/code/app/.git",
    },
    origin: "git@github.com:acme/app.git",
    cliPackageName: null,
  };
  const wt = {
    toplevel: base.path,
    gitDir: "/home/u/code/main/.git/worktrees/app",
    commonDir: "/home/u/code/main/.git",
  };

  it("classifies home, fixture, worktree and repo", () => {
    expect(classifyInstall(base)).toBe("repo");
    expect(classifyInstall({ ...base, path: "/home/u" })).toBe("home");
    expect(classifyInstall({ ...base, path: "/tmp/x", git: null })).toBe("fixture");
    expect(classifyInstall({ ...base, path: "/home/u/code/kit/test/fixtures/consumer" })).toBe(
      "fixture",
    );
    expect(classifyInstall({ ...base, git: { ...ownGit, toplevel: "/home/u/code" } })).toBe(
      "fixture",
    );
    expect(classifyInstall({ ...base, git: wt })).toBe("worktree");
    expect(classifyInstall({ ...base, git: null, origin: null })).toBe("repo");
  });

  it("treats a nested install as a fixture when $HOME itself is a git repo", () => {
    const homeRepo = { toplevel: "/home/u", gitDir: "/home/u/.git", commonDir: "/home/u/.git" };
    expect(classifyInstall({ ...base, path: "/home/u", git: homeRepo })).toBe("home");
    expect(classifyInstall({ ...base, git: homeRepo })).toBe("fixture");
  });

  it("marks the factory, and factory wins over worktree", () => {
    const factory = { ...base, origin: "https://github.com/agent-kit-startup/agent-kit-dev.git" };
    expect(classifyInstall(factory)).toBe("factory");
    expect(classifyInstall({ ...factory, git: wt })).toBe("factory");
    expect(
      classifyInstall({ ...base, origin: null, cliPackageName: "@dadado/agent-kit-cli", git: wt }),
    ).toBe("factory");
    expect(classifyInstall({ ...base, cliPackageName: "@missionkit/cli" })).toBe("factory");
  });
});

describe("sanitizeRemote", () => {
  it("strips credentials and keeps scp-style remotes", () => {
    expect(sanitizeRemote("https://oauth2:tok@gitlab.example.com/g/r.git")).toBe(
      "https://gitlab.example.com/g/r.git",
    );
    expect(sanitizeRemote("git@github.com:acme/app.git")).toBe("git@github.com:acme/app.git");
    expect(sanitizeRemote(null)).toBeNull();
  });
});

describe("inspectInstall (real git)", () => {
  it("reads the manifest version, origin and worktree from git", async () => {
    const repo = path.join(scratch, "repo");
    await initRepo(repo, "https://user:secret@example.com/acme/app.git");
    const record = await inspectInstall(repo, { home: scratch, tmpRoots: [] });
    expect(record).toMatchObject({
      path: repo,
      remote: "https://example.com/acme/app.git",
      kitVersion: "6.23.0",
      kind: "repo",
    });

    const linked = path.join(scratch, "linked");
    await git(repo, "worktree", "add", "-q", linked);
    expect((await inspectInstall(linked, { home: scratch, tmpRoots: [] }))?.kind).toBe("worktree");

    const nested = path.join(repo, "examples", "consumer");
    await writeManifest(nested);
    expect(await inspectInstall(nested, { home: scratch, tmpRoots: [] })).toMatchObject({
      kind: "fixture",
      remote: null,
    });

    expect(await inspectInstall(path.join(scratch, "nothing"), { tmpRoots: [] })).toBeNull();
  });

  it("classifies a temp-dir install as a fixture by default", async () => {
    const repo = path.join(scratch, "tmp-repo");
    await initRepo(repo);
    expect((await inspectInstall(repo))?.kind).toBe("fixture");
  });

  it("marks a kit checkout without the factory remote by its CLI package", async () => {
    const repo = path.join(scratch, "kit");
    await initRepo(repo, "https://github.com/someone/fork.git");
    await mkdir(path.join(repo, "packages", "cli"), { recursive: true });
    await writeFile(
      path.join(repo, "packages", "cli", "package.json"),
      JSON.stringify({ name: "@dadado/agent-kit-cli" }),
    );
    expect((await inspectInstall(repo, { home: scratch, tmpRoots: [] }))?.kind).toBe("factory");
  });
});

describe("scanForInstalls", () => {
  it("finds installs within bounds and skips node_modules, hidden dirs and symlinks", async () => {
    const root = path.join(scratch, "home");
    await writeManifest(root); // home-level ~/.cursor install
    await writeManifest(path.join(root, "code", "app"));
    await writeManifest(path.join(root, "code", "app", "node_modules", "pkg"));
    await writeManifest(path.join(root, ".cache", "thing"));
    await writeManifest(path.join(root, "code", "app", ".worktrees", "feat"));
    await writeManifest(path.join(root, "code", "app", ".claude", "worktrees", "agent-1"));
    await writeManifest(path.join(root, "a", "b", "c", "d", "e", "f", "deep"));
    await mkdir(path.join(root, "links"), { recursive: true });
    await symlink(path.join(root, "code"), path.join(root, "links", "code-link"));

    const result = await scanForInstalls([root]);
    expect(result.found).toEqual(
      [
        root,
        path.join(root, "code", "app"),
        path.join(root, "code", "app", ".claude", "worktrees", "agent-1"),
        path.join(root, "code", "app", ".worktrees", "feat"),
      ].sort(),
    );
    expect(result.truncated).toBe(false);

    const deep = await scanForInstalls([root], { maxDepth: 7 });
    expect(deep.found).toContain(path.join(root, "a", "b", "c", "d", "e", "f", "deep"));

    const capped = await scanForInstalls([root], { maxDirs: 2 });
    expect(capped.truncated).toBe(true);
    expect(capped.visited).toBe(2);
  });
});

describe("feedInstallsRegistry", () => {
  it("records an install into the configured file and skips folders without a manifest", async () => {
    const previous = process.env.AGENT_KIT_INSTALLS_FILE;
    process.env.AGENT_KIT_INSTALLS_FILE = file;
    try {
      const repo = path.join(scratch, "repo");
      await writeManifest(repo, "6.20.0");
      await feedInstallsRegistry(repo);
      await feedInstallsRegistry(path.join(scratch, "not-installed"));
      const rows = await listInstalls({ file });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ path: repo, kitVersion: "6.20.0" });
    } finally {
      process.env.AGENT_KIT_INSTALLS_FILE = previous;
    }
  });

  it("fails open on a corrupt registry file", async () => {
    const previous = process.env.AGENT_KIT_INSTALLS_FILE;
    process.env.AGENT_KIT_INSTALLS_FILE = file;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "garbage");
      const repo = path.join(scratch, "repo");
      await writeManifest(repo);
      await expect(feedInstallsRegistry(repo)).resolves.toBeUndefined();
      expect(await readFile(file, "utf8")).toBe("garbage");
    } finally {
      process.env.AGENT_KIT_INSTALLS_FILE = previous;
    }
  });
});

describe("agent-kit installs", () => {
  it("collects every repeated --root", () => {
    expect(collectRepeatedFlag(["scan", "--root", "a", "--root=b", "--json"], "root")).toEqual([
      "a",
      "b",
    ]);
  });

  it("scans several roots, then lists and prunes", async () => {
    const previous = process.env.AGENT_KIT_INSTALLS_FILE;
    process.env.AGENT_KIT_INSTALLS_FILE = file;
    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const a = path.join(scratch, "r1", "app");
      const b = path.join(scratch, "r2", "svc");
      await writeManifest(a);
      await writeManifest(b);
      const scanArgs = [
        "scan",
        "--root",
        path.join(scratch, "r1"),
        "--root",
        path.join(scratch, "r2"),
        "--json",
      ];
      await runCommand(installsCommand, { rawArgs: scanArgs });
      const scanned = JSON.parse(out.join(""));
      expect(scanned.recorded.map((e: { path: string }) => e.path)).toEqual([a, b]);

      out.length = 0;
      await runCommand(installsCommand, { rawArgs: ["list", "--json"] });
      const listed = JSON.parse(out.join(""));
      expect(listed.file).toBe(file);
      expect(listed.installs.map((e: { kind: string }) => e.kind)).toEqual(["fixture", "fixture"]);

      await rm(b, { recursive: true, force: true });
      out.length = 0;
      await runCommand(installsCommand, { rawArgs: ["prune", "--json"] });
      expect(JSON.parse(out.join("")).removed.map((e: { path: string }) => e.path)).toEqual([b]);
    } finally {
      process.stdout.write = write;
      process.env.AGENT_KIT_INSTALLS_FILE = previous;
    }
  });
});
