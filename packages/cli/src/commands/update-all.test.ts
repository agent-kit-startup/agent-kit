import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KIT_VERSION } from "../lifecycle/version.js";
import { detectAgentSession, operatorOnlyRefusal } from "../utils/agent-session.js";
import { updateCommand } from "./update.js";
import {
  forgeCreateArgv,
  type GitRunner,
  parsePorcelainZ,
  parseRemote,
  runUpdateAll,
  type UpdateAllOptions,
} from "./update-all.js";

const KIT_FILE = ".cursor/rules/kit.mdc";

// The registry sync is mocked: it writes one kit file, like a real apply would.
const mockSyncFromManifest = vi.hoisted(() =>
  vi.fn(async (_registryRoot: string, projectRoot: string, _manifest: unknown) => {
    const { writeFile: write } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await write(join(projectRoot, ".cursor", "rules", "kit.mdc"), "kit content vNEXT\n", "utf8");
    return {
      written: [".cursor/rules/kit.mdc"],
      removed: [],
      collisions: [],
      skippedProtected: [],
      missing: [],
      unchanged: [],
      preservedCustomized: [],
      skippedSymlink: [],
    };
  }),
);

vi.mock("../lifecycle/sync.js", () => ({
  syncFromManifest: mockSyncFromManifest,
}));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: gitTestEnv() }).trim();
}

function gitTestEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"])
    delete env[key];
  return env;
}

const OPERATOR_TERMINAL = { env: {}, stdinIsTTY: true, stdoutIsTTY: true };
const BEHIND_VERSION = `${KIT_VERSION.split(".")[0]}.0.0`;

interface Fleet {
  base: string;
  bare: string;
  kit: string;
  installsFile: string;
  repos: { current: string; behind: string; dirty: string };
}

async function makeRepo(fleet: { base: string; bare: string }, name: string, version: string) {
  const bareRepo = path.join(fleet.bare, "acme", `${name}.git`);
  await mkdir(bareRepo, { recursive: true });
  git(bareRepo, "init", "--quiet", "--bare", "-b", "staging");
  const repo = path.join(fleet.base, "repos", name);
  await mkdir(path.join(repo, ".cursor", "rules"), { recursive: true });
  git(repo, "init", "--quiet", "-b", "staging");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "commit.gpgsign", "false");
  // A github.com origin that resolves to the local bare repo: forge detection
  // reads the raw URL, every fetch/push goes to the bare repo.
  git(repo, "config", `url.${fleet.bare}/.insteadOf`, "https://github.com/");
  git(repo, "remote", "add", "origin", `https://github.com/acme/${name}.git`);
  await writeFile(
    path.join(repo, ".cursor", "agent-kit.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        version,
        packs: [],
        skills: [],
        protected: [],
        registry: { url: "https://github.com/agent-kit-startup/agent-kit", ref: "main" },
        installedAt: "2026-11-01T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(path.join(repo, KIT_FILE), "kit content old\n", "utf8");
  await writeFile(path.join(repo, "README.md"), `# ${name}\n`, "utf8");
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "init");
  git(repo, "push", "--quiet", "-u", "origin", "staging");
  git(repo, "remote", "set-head", "origin", "staging");
  return realpath(repo);
}

async function makeFleet(): Promise<Fleet> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ak-update-all-")));
  const bare = path.join(base, "bare");
  const fleet = { base, bare };
  const current = await makeRepo(fleet, "current", KIT_VERSION);
  const behind = await makeRepo(fleet, "behind", BEHIND_VERSION);
  const dirty = await makeRepo(fleet, "dirty", BEHIND_VERSION);
  await writeFile(path.join(dirty, KIT_FILE), "operator edit in progress\n", "utf8");

  const kit = path.join(base, "kit");
  await mkdir(path.join(kit, "registry"), { recursive: true });
  await writeFile(path.join(kit, "registry", "registry.json"), "{}\n", "utf8");
  await mkdir(path.join(kit, "packages", "cli"), { recursive: true });
  await writeFile(
    path.join(kit, "packages", "cli", "package.json"),
    JSON.stringify({ version: KIT_VERSION }),
    "utf8",
  );

  const installsFile = path.join(base, "installs.json");
  const row = (p: string, kitVersion: string) => ({
    path: p,
    remote: null,
    kitVersion,
    cliVersion: KIT_VERSION,
    lastSeen: "2026-11-26T00:00:00.000Z",
    kind: "repo",
  });
  await writeFile(
    installsFile,
    JSON.stringify({
      schemaVersion: 1,
      installs: [
        row(current, KIT_VERSION),
        row(behind, BEHIND_VERSION),
        row(dirty, BEHIND_VERSION),
      ],
    }),
    "utf8",
  );
  return { base, bare, kit, installsFile, repos: { current, behind, dirty } };
}

function fleetOptions(fleet: Fleet, extra: Partial<UpdateAllOptions> = {}): UpdateAllOptions {
  return {
    terminal: OPERATOR_TERMINAL,
    npmLatest: async () => KIT_VERSION,
    confirm: vi.fn(async () => true),
    forge: vi.fn(async () => "https://github.com/acme/behind/pull/1"),
    installsFile: fleet.installsFile,
    // Fixture repos live under the temp dir; classify them as plain repos.
    inspect: { tmpRoots: [], home: path.join(fleet.base, "home") },
    home: path.join(fleet.base, "home"),
    applyOptions: { registry: fleet.kit },
    out: () => undefined,
    ...extra,
  };
}

describe("operator-only refusal", () => {
  it("names the agent marker that is set", () => {
    expect(detectAgentSession({ CLAUDECODE: "1" })?.key).toBe("CLAUDECODE");
    expect(detectAgentSession({ CURSOR_AGENT: "1" })?.label).toBe("Cursor agent session");
    expect(detectAgentSession({ AGENT_KIT_QUEUE_LEASE_SESSION: "abc" })?.label).toBe(
      "Agent Kit plan loop",
    );
    expect(detectAgentSession({ CLAUDECODE: "0", CURSOR_AGENT: "" })).toBeNull();
  });

  it("refuses without a TTY even when no agent env is set", () => {
    expect(operatorOnlyRefusal("x", { env: {}, stdinIsTTY: false, stdoutIsTTY: true })).toMatch(
      /needs an interactive terminal/,
    );
    expect(operatorOnlyRefusal("x", OPERATOR_TERMINAL)).toBeNull();
  });

  it("refuses inside an agent session before any git or network call", async () => {
    const gitSpy = vi.fn<GitRunner>(async () => "");
    const npmLatest = vi.fn(async () => KIT_VERSION);
    const result = await runUpdateAll({
      terminal: { env: { CLAUDECODE: "1" }, stdinIsTTY: true, stdoutIsTTY: true },
      git: gitSpy,
      npmLatest,
      out: () => undefined,
    });
    expect(result.status).toBe("refused");
    expect(result.reason).toMatch(/operator-only.*Claude Code agent session/);
    expect(gitSpy).not.toHaveBeenCalled();
    expect(npmLatest).not.toHaveBeenCalled();
  });

  describe("through the command", () => {
    let originalExitCode: typeof process.exitCode;
    beforeEach(() => {
      originalExitCode = process.exitCode;
    });
    afterEach(() => {
      process.exitCode = originalExitCode;
    });

    it("exits 1 under the test runner (no TTY or agent env), --yes does not lift it", async () => {
      const errors: string[] = [];
      const spy = vi.spyOn(console, "error").mockImplementation((...a) => {
        errors.push(a.join(" "));
      });
      const { logger } = await import("../utils/logger.js");
      const errSpy = vi.spyOn(logger, "error").mockImplementation((m: string) => {
        errors.push(m);
      });
      try {
        await (
          updateCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>
        )({ args: { _: [], all: true, yes: true, "include-worktrees": false, check: false } });
      } finally {
        spy.mockRestore();
        errSpy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(errors.join("\n")).toMatch(/agent-kit update --all is operator-only/);
    });
  });
});

describe("porcelain parsing", () => {
  it("keeps the path when the runner trimmed the first entry's leading space", () => {
    expect(parsePorcelainZ("M .cursor/a.json\0?? .cursor/new file.md\0M  AGENTS.md\0")).toEqual([
      ".cursor/a.json",
      ".cursor/new file.md",
      "AGENTS.md",
    ]);
  });
});

describe("remote parsing", () => {
  it("reads github, gitlab and scp forms", () => {
    expect(parseRemote("https://github.com/acme/app.git")).toMatchObject({
      forge: "github",
      repoPath: "acme/app",
    });
    expect(parseRemote("git@gitlab.example.com:group/sub/app.git")).toMatchObject({
      forge: "gitlab",
      host: "gitlab.example.com",
      repoPath: "group/sub/app",
    });
    expect(parseRemote("ssh://git@git.internal:2222/team/app")).toMatchObject({
      forge: "none",
      repoPath: "team/app",
    });
    expect(parseRemote("/srv/git/app.git")).toBeNull();
  });

  it("builds a glab call with -R host/group/repo and an explicit target branch", () => {
    const remote = parseRemote("git@gitlab.example.com:group/app.git");
    const argv = forgeCreateArgv(remote as NonNullable<typeof remote>, {
      head: "chore/kit-1.2.3",
      base: "staging",
      title: "t",
      body: "b",
    });
    expect(argv?.cmd).toBe("glab");
    expect(argv?.args).toEqual(
      expect.arrayContaining(["-R", "gitlab.example.com/group/app", "--target-branch", "staging"]),
    );
  });
});

describe("update --all over three fixture repos", () => {
  it("stops at the preflight when the CLI is behind npm", async () => {
    const fleet = await makeFleet();
    const options = fleetOptions(fleet, { npmLatest: async () => "999.0.0" });
    const result = await runUpdateAll(options);
    expect(result.status).toBe("preflight-stop");
    expect(result.reason).toMatch(/behind npm latest v999\.0\.0/);
    expect(options.confirm).not.toHaveBeenCalled();
  });

  it("plans once, confirms once, opens one branch + PR for the behind repo and skips the others", async () => {
    const fleet = await makeFleet();
    const lines: string[] = [];
    const options = fleetOptions(fleet, { out: (l) => lines.push(l) });
    const result = await runUpdateAll(options);

    expect(result.status).toBe("done");
    expect(options.confirm).toHaveBeenCalledTimes(1);
    const byPath = new Map(result.results.map((r) => [r.row.path, r]));
    expect(byPath.get(fleet.repos.current)?.row.skip).toMatch(/^current/);
    expect(byPath.get(fleet.repos.dirty)?.row.skip).toMatch(/dirty kit files \(1\)/);
    expect(byPath.get(fleet.repos.behind)?.row.skip).toBeNull();
    expect(byPath.get(fleet.repos.behind)?.outcome).toEqual({
      status: "opened",
      branch: `chore/kit-${KIT_VERSION}`,
      url: "https://github.com/acme/behind/pull/1",
    });

    // One PR, against the pre-prod branch, for the right repository.
    expect(options.forge).toHaveBeenCalledTimes(1);
    const [cmd, args] = (options.forge as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string[],
    ];
    expect(cmd).toBe("gh");
    expect(args).toEqual(
      expect.arrayContaining([
        "--repo",
        "acme/behind",
        "--base",
        "staging",
        "--head",
        `chore/kit-${KIT_VERSION}`,
      ]),
    );

    // The branch reached origin with only the kit paths, and the repo is back on staging.
    const behind = fleet.repos.behind;
    expect(git(behind, "branch", "--show-current")).toBe("staging");
    const bareBehind = path.join(fleet.bare, "acme", "behind.git");
    expect(git(bareBehind, "branch", "--list", `chore/kit-${KIT_VERSION}`)).toContain(
      `chore/kit-${KIT_VERSION}`,
    );
    const files = git(behind, "show", "--name-only", "--format=", `chore/kit-${KIT_VERSION}`)
      .split("\n")
      .sort();
    expect(files).toEqual([".cursor/agent-kit.json", KIT_FILE]);
    const subject = git(behind, "log", "-1", "--format=%s", `chore/kit-${KIT_VERSION}`);
    expect(subject).toBe(`chore(agent-kit): update kit to v${KIT_VERSION}`);
    expect(git(behind, "status", "--porcelain")).toBe("");

    // The other two are untouched: no branch, dirty edit still in place.
    expect(git(fleet.repos.dirty, "branch", "--list", "chore/*")).toBe("");
    expect(await readFile(path.join(fleet.repos.dirty, KIT_FILE), "utf8")).toBe(
      "operator edit in progress\n",
    );
    expect(git(fleet.repos.current, "branch", "--list", "chore/*")).toBe("");

    // The summary table names the PR link.
    expect(lines.join("\n")).toContain("https://github.com/acme/behind/pull/1");

    // A rerun is idempotent: the existing branch is a skip, no second PR, no confirm.
    const again = fleetOptions(fleet);
    const rerun = await runUpdateAll(again);
    expect(rerun.status).toBe("nothing-to-do");
    const behindRow = rerun.rows.find((r) => r.path === behind);
    expect(behindRow?.skip).toMatch(/already exists/);
    expect(again.confirm).not.toHaveBeenCalled();
    expect(again.forge).not.toHaveBeenCalled();
  }, 60_000);

  it("keeps going past a repo whose push fails, cleans it up, and retries it on a rerun", async () => {
    const fleet = await makeFleet();
    const rejecting = await makeRepo(fleet, "rejecting", BEHIND_VERSION);
    const hook = path.join(fleet.bare, "acme", "rejecting.git", "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\necho rejected by fixture >&2\nexit 1\n", { mode: 0o755 });
    // A repo with no remote: branch + commit only, no PR.
    const local = await makeRepo(fleet, "local", BEHIND_VERSION);
    git(local, "remote", "remove", "origin");
    const body = JSON.parse(await readFile(fleet.installsFile, "utf8"));
    for (const p of [rejecting, local]) {
      body.installs.push({
        path: p,
        remote: null,
        kitVersion: BEHIND_VERSION,
        cliVersion: KIT_VERSION,
        lastSeen: "2026-11-26T00:00:00.000Z",
        kind: "repo",
      });
    }
    await writeFile(fleet.installsFile, JSON.stringify(body), "utf8");

    const options = fleetOptions(fleet);
    const result = await runUpdateAll(options);
    const outcome = (p: string) => result.results.find((r) => r.row.path === p)?.outcome;
    expect(outcome(rejecting)).toMatchObject({ status: "error" });
    expect((outcome(rejecting) as { note: string }).note).toMatch(/push failed/);
    expect(outcome(fleet.repos.behind)).toMatchObject({ status: "opened" });
    expect(outcome(local)).toMatchObject({
      status: "committed",
      branch: `chore/kit-${KIT_VERSION}`,
    });
    expect(options.forge).toHaveBeenCalledTimes(1);

    // The failed repo is back on staging, clean, with no kit branch left behind.
    expect(git(rejecting, "branch", "--show-current")).toBe("staging");
    expect(git(rejecting, "status", "--porcelain")).toBe("");
    expect(git(rejecting, "branch", "--list", "chore/*")).toBe("");
    // The no-remote repo keeps its committed branch and is back on staging.
    expect(git(local, "branch", "--show-current")).toBe("staging");
    expect(git(local, "branch", "--list", "chore/*")).toContain(`chore/kit-${KIT_VERSION}`);

    // A rerun retries the failed repo only.
    const again = fleetOptions(fleet);
    const rerun = await runUpdateAll(again);
    expect(rerun.rows.filter((r) => !r.skip).map((r) => r.path)).toEqual([rejecting]);
    expect(again.confirm).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("changes nothing when the operator declines the batch confirm", async () => {
    const fleet = await makeFleet();
    const options = fleetOptions(fleet, { confirm: vi.fn(async () => false) });
    const result = await runUpdateAll(options);
    expect(result.status).toBe("declined");
    expect(git(fleet.repos.behind, "branch", "--list", "chore/*")).toBe("");
    expect(options.forge).not.toHaveBeenCalled();
  }, 60_000);
});
