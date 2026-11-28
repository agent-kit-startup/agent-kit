/**
 * Facts and classification for one install of the machine registry.
 * Read-only: runs `git rev-parse` and `git remote get-url` only (never a
 * command that may rewrite the index) and never writes inside the repo.
 */

import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { KIT_VERSION } from "../lifecycle/version.js";
import { MANIFEST_RELATIVE_PATH } from "../manifest/types.js";
import { fileExists } from "../utils/fs.js";
import type { InstallKind, InstallRecord } from "./store.js";

const execFileAsync = promisify(execFile);

/** Origin URL markers of the kit's own repository (factory, ADR 2026-07-31). */
const FACTORY_REMOTE_MARKERS = ["agent-kit-dev"];
/** CLI package names whose presence under `packages/cli` marks a kit checkout. */
const FACTORY_CLI_PACKAGES = new Set(["@dadado/agent-kit-cli", "@missionkit/cli"]);
/** Path segments that mark a test fixture rather than a repository. */
const FIXTURE_SEGMENTS = new Set([
  "fixtures",
  "__fixtures__",
  "test-fixtures",
  "testdata",
  "__tests__",
]);

export interface GitFacts {
  /** Absolute `--show-toplevel`. */
  toplevel: string;
  /** Absolute `--git-dir`. */
  gitDir: string;
  /** Absolute `--git-common-dir`. */
  commonDir: string;
}

export interface InstallFacts {
  /** Real absolute path of the install directory. */
  path: string;
  /** Real home directory. */
  home: string;
  /** Real temp roots: a manifest below one is a fixture. */
  tmpRoots: readonly string[];
  /** Null when the directory is not inside a git work tree. */
  git: GitFacts | null;
  /** Raw origin URL (credentials still present), or null. */
  origin: string | null;
  /** `name` of `packages/cli/package.json`, or null. */
  cliPackageName: string | null;
}

/** Strip userinfo (`https://token@host/…`) so no credential lands in the registry. */
export function sanitizeRemote(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    }
    return trimmed;
  } catch {
    // scp-style `git@host:group/repo.git` is not a URL and carries no secret.
    return trimmed;
  }
}

function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function isFactoryInstall(facts: Pick<InstallFacts, "origin" | "cliPackageName">): boolean {
  const origin = facts.origin?.toLowerCase() ?? "";
  if (FACTORY_REMOTE_MARKERS.some((m) => origin.includes(m))) return true;
  return facts.cliPackageName !== null && FACTORY_CLI_PACKAGES.has(facts.cliPackageName);
}

/**
 * One kind per row, first match wins:
 *   home     the install directory is the home directory (`~/.cursor`)
 *   fixture  not its own repository: below a temp root, under a fixtures
 *            segment, or inside another repo's work tree (git toplevel differs)
 *   factory  the kit's own repo by origin or CLI package, worktrees included
 *            (wins over worktree so `update --all --include-worktrees` never
 *            picks a factory worktree)
 *   worktree a linked worktree: git-dir differs from git-common-dir
 *   repo     anything else, including a directory with no git at all
 */
export function classifyInstall(facts: InstallFacts): InstallKind {
  if (facts.path === facts.home) return "home";
  if (facts.tmpRoots.some((root) => isUnder(facts.path, root))) return "fixture";
  const rel = path.relative(facts.home, facts.path);
  const segments = (isUnder(facts.path, facts.home) ? rel : facts.path).split(path.sep);
  if (segments.some((s) => FIXTURE_SEGMENTS.has(s))) return "fixture";
  if (facts.git && facts.git.toplevel !== facts.path) return "fixture";
  if (isFactoryInstall(facts)) return "factory";
  if (facts.git && facts.git.gitDir !== facts.git.commonDir) return "worktree";
  return "repo";
}

/** Child env for read-only git calls: never inherit a caller's repo override. */
function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CEILING_DIRECTORIES",
  ]) {
    delete env[key];
  }
  return env;
}

async function safeRealpath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return path.resolve(p);
  }
}

async function readGitFacts(dir: string): Promise<GitFacts | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
      { cwd: dir, env: gitEnv(), encoding: "utf8", timeout: 5_000 },
    );
    const [toplevel, gitDir, commonDir] = stdout.trim().split("\n");
    if (!toplevel || !gitDir || !commonDir) return null;
    return {
      toplevel: await safeRealpath(toplevel),
      gitDir: await safeRealpath(gitDir),
      commonDir: await safeRealpath(commonDir),
    };
  } catch {
    return null;
  }
}

async function readOrigin(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: dir,
      env: gitEnv(),
      encoding: "utf8",
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readCliPackageName(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dir, "packages", "cli", "package.json"), "utf8");
    const name = (JSON.parse(raw) as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

async function readManifestVersion(dir: string): Promise<string | null | undefined> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, MANIFEST_RELATIVE_PATH), "utf8");
  } catch {
    return undefined;
  }
  try {
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" && version.trim() ? version.trim() : null;
  } catch {
    return null;
  }
}

/** True while `<dir>/.cursor/agent-kit.json` exists (the registry's liveness rule). */
export function hasInstallManifest(dir: string): Promise<boolean> {
  return fileExists(path.join(dir, MANIFEST_RELATIVE_PATH));
}

export interface InspectOptions {
  home?: string;
  tmpRoots?: readonly string[];
  cliVersion?: string;
}

async function defaultTmpRoots(): Promise<string[]> {
  const roots = new Set<string>([await safeRealpath(tmpdir())]);
  if (process.platform !== "win32") roots.add(await safeRealpath("/tmp"));
  return [...roots];
}

/**
 * Build the registry row for `dir`, or null when it holds no kit manifest.
 * The kit version comes from the manifest on disk (the manifest wins).
 */
export async function inspectInstall(
  dir: string,
  options: InspectOptions = {},
): Promise<InstallRecord | null> {
  const installPath = await safeRealpath(dir);
  const kitVersion = await readManifestVersion(installPath);
  if (kitVersion === undefined) return null;
  const home = await safeRealpath(options.home ?? homedir());
  const tmpRoots = options.tmpRoots
    ? await Promise.all(options.tmpRoots.map(safeRealpath))
    : await defaultTmpRoots();
  const git = await readGitFacts(installPath);
  // A fixture inside another repo would report that repo's origin: only a
  // directory that is its own git toplevel has a remote of its own.
  const origin = git && git.toplevel === installPath ? await readOrigin(installPath) : null;
  const facts: InstallFacts = {
    path: installPath,
    home,
    tmpRoots,
    git,
    origin,
    cliPackageName: await readCliPackageName(installPath),
  };
  return {
    path: installPath,
    remote: sanitizeRemote(origin),
    kitVersion,
    cliVersion: options.cliVersion ?? KIT_VERSION,
    kind: classifyInstall(facts),
  };
}
