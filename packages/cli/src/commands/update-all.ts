/**
 * `agent-kit update --all`: operator-typed only, one branch and one PR/MR per
 * repository (ADR 2026-11-26_update-all-operator-only-branch-mr-per-repo).
 *
 * Flow: operator-only refusal (no TTY, agent session) -> CLI-vs-npm preflight
 * -> one plan table from the machine install registry -> one batch confirm ->
 * per repo, sequentially: fast-forward the pre-prod branch, fresh branch
 * `chore/kit-X.Y.Z`, update apply (kit files win by being written), commit
 * only the kit paths by name, push, open the PR/MR -> summary table.
 *
 * Never merges, never rebases, never force-pushes, never `git restore` /
 * `checkout --theirs`. One repo failing does not stop the others; a rerun is
 * idempotent (an existing `chore/kit-X.Y.Z` branch is a skip, not a retry).
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { confirm, isCancel } from "@clack/prompts";
import {
  type InspectOptions,
  type InstallKind,
  InstallsRegistryError,
  inspectInstall,
  listInstalls,
} from "../installs/index.js";
import { checkRunningCliVsNpmLatest, compareSemver } from "../lifecycle/check-updates.js";
import { MANAGED_HASHES_REL } from "../lifecycle/overlay.js";
import { isProtectedPath, resolveProtectedGlobs } from "../lifecycle/protected.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { loadAgentKitManifest } from "../manifest/index.js";
import { MANIFEST_RELATIVE_PATH } from "../manifest/types.js";
import { inspectQueueLease } from "../plan-loop/queue-lease.js";
import { detectProvider } from "../scanner/detect-git.js";
import { type OperatorTerminalProbe, operatorOnlyRefusal } from "../utils/agent-session.js";
import { logger } from "../utils/logger.js";
import { type ApplyUpdateOptions, type ApplyUpdateResult, applyUpdateAtRoot } from "./update.js";

const execFileAsync = promisify(execFile);

/** Top-level paths the kit writes (L0 targets, packs, skills, adapters); dirt is looked for here. */
export const KIT_PATHSPECS = [
  ".cursor",
  ".claude",
  "autogit",
  "git-hooks",
  "AGENTS.md",
  "CLAUDE.md",
] as const;

export const UPDATE_ALL_COMMAND = "agent-kit update --all";

export type ForgeKind = "github" | "gitlab" | "none";

export interface RemoteInfo {
  /** Raw `remote.origin.url` (never printed: may carry credentials). */
  url: string;
  host: string;
  /** `group/sub/repo`, without `.git`. */
  repoPath: string;
  forge: ForgeKind;
}

/** Parse `https://host/group/repo(.git)`, `ssh://git@host:22/group/repo`, `git@host:group/repo`. */
export function parseRemote(url: string): RemoteInfo | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let host: string;
  let repoPath: string;
  const scp = /^[^/@\s]+@([^:/\s]+):(.+)$/.exec(trimmed);
  if (scp && !trimmed.includes("://")) {
    host = scp[1] as string;
    repoPath = scp[2] as string;
  } else {
    try {
      const parsed = new URL(trimmed);
      if (!parsed.hostname) return null;
      host = parsed.hostname;
      repoPath = parsed.pathname;
    } catch {
      return null;
    }
  }
  repoPath = repoPath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  if (!repoPath.includes("/")) return null;
  const lower = host.toLowerCase();
  const forge: ForgeKind =
    lower === "github.com" ? "github" : lower.includes("gitlab") ? "gitlab" : "none";
  return { url: trimmed, host, repoPath, forge };
}

/** Argv of the PR/MR create call, or null when the forge is not one we drive. */
export function forgeCreateArgv(
  remote: RemoteInfo,
  opts: { head: string; base: string; title: string; body: string },
): { cmd: string; args: string[] } | null {
  if (remote.forge === "github") {
    return {
      cmd: "gh",
      args: [
        "pr",
        "create",
        "--repo",
        remote.repoPath,
        "--base",
        opts.base,
        "--head",
        opts.head,
        "--title",
        opts.title,
        "--body",
        opts.body,
      ],
    };
  }
  if (remote.forge === "gitlab") {
    return {
      cmd: "glab",
      args: [
        "mr",
        "create",
        "-R",
        `${remote.host}/${remote.repoPath}`,
        "--source-branch",
        opts.head,
        "--target-branch",
        opts.base,
        "--title",
        opts.title,
        "--description",
        opts.body,
        "--yes",
      ],
    };
  }
  return null;
}

export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>;
export type ForgeRunner = (cmd: string, args: readonly string[], cwd: string) => Promise<string>;

/** Child env for git: never inherit a caller's repo override. */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) {
    delete env[key];
  }
  return env;
}

function execError(err: unknown): Error {
  const e = err as { stderr?: string; message?: string };
  const detail = (e.stderr ?? "").trim().split("\n").filter(Boolean).pop();
  return new Error(detail || e.message || String(err));
}

export const defaultGit: GitRunner = async (args, cwd) => {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      env: cleanGitEnv(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    return stdout.trim();
  } catch (err) {
    throw execError(err);
  }
};

export const defaultForge: ForgeRunner = async (cmd, args, cwd) => {
  try {
    const { stdout } = await execFileAsync(cmd, [...args], {
      cwd,
      encoding: "utf8",
      timeout: 120_000,
    });
    return stdout.trim();
  } catch (err) {
    throw execError(err);
  }
};

async function gitOk(git: GitRunner, args: readonly string[], cwd: string): Promise<string | null> {
  try {
    return await git(args, cwd);
  } catch {
    return null;
  }
}

export interface PlanRow {
  path: string;
  kind: InstallKind | "missing";
  currentVersion: string | null;
  targetVersion: string;
  /** Pre-prod branch: `staging` when it exists, else the default branch. */
  preProd: string | null;
  /** Commits the local pre-prod branch is behind origin (null when unknown or absent). */
  behind: number | null;
  /** Modified or untracked non-protected paths under the kit pathspecs. */
  dirtyKitFiles: string[];
  /** Queue-lease holder line, or null when free/stale/own. */
  leaseHolder: string | null;
  remote: RemoteInfo | null;
  /** Local pre-prod branch exists (fast-forwarded before branching). */
  hasLocalPreProd: boolean;
  /** Null when the row is updated; else why it is skipped. */
  skip: string | null;
  /** Only meaningful for `skip === null`. */
  branch: string;
}

export interface PlanOptions {
  targetVersion?: string;
  includeWorktrees?: boolean;
  inspect?: InspectOptions;
  git?: GitRunner;
  /** Network reads (fetch, ls-remote). Off only in unit tests of the classifier. */
  fetch?: boolean;
}

function kitBranchName(version: string): string {
  return `chore/kit-${version}`;
}

function majorOf(version: string): number | null {
  const m = /^(\d+)\./.exec(version.trim());
  return m ? Number(m[1]) : null;
}

/**
 * NUL-separated `git status --porcelain -z` paths (renames disabled). The
 * runner trims its output, which eats the leading space of a ` M path` first
 * entry, so the status column is matched instead of sliced.
 */
export function parsePorcelainZ(out: string): string[] {
  return out
    .split("\0")
    .filter(Boolean)
    .map((entry) => /^[ MTADRCU?!]{1,2} (.+)$/s.exec(entry)?.[1] ?? entry);
}

async function kitStatusPaths(git: GitRunner, root: string): Promise<string[]> {
  const out = await git(
    [
      "status",
      "--porcelain",
      "-z",
      "--no-renames",
      "--untracked-files=all",
      "--",
      ...KIT_PATHSPECS,
    ],
    root,
  );
  return parsePorcelainZ(out);
}

async function resolvePreProd(
  git: GitRunner,
  root: string,
  hasRemote: boolean,
): Promise<{ preProd: string | null; hasLocal: boolean }> {
  const localStaging = await gitOk(
    git,
    ["rev-parse", "--verify", "--quiet", "refs/heads/staging"],
    root,
  );
  if (hasRemote) {
    const remoteStaging = await gitOk(
      git,
      ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/staging"],
      root,
    );
    let preProd: string | null = remoteStaging ? "staging" : null;
    if (!preProd) {
      const head = await gitOk(git, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root);
      preProd = head ? head.replace(/^origin\//, "") : null;
    }
    if (!preProd) {
      for (const candidate of ["main", "master"]) {
        if (
          await gitOk(
            git,
            ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${candidate}`],
            root,
          )
        ) {
          preProd = candidate;
          break;
        }
      }
    }
    if (!preProd) return { preProd: null, hasLocal: false };
    const local = await gitOk(
      git,
      ["rev-parse", "--verify", "--quiet", `refs/heads/${preProd}`],
      root,
    );
    return { preProd, hasLocal: Boolean(local) };
  }
  if (localStaging) return { preProd: "staging", hasLocal: true };
  for (const candidate of ["main", "master"]) {
    if (await gitOk(git, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`], root)) {
      return { preProd: candidate, hasLocal: true };
    }
  }
  return { preProd: null, hasLocal: false };
}

/** Build one plan row. Read-only apart from `git fetch` of the pre-prod branch. */
export async function planRow(installPath: string, options: PlanOptions = {}): Promise<PlanRow> {
  const git = options.git ?? defaultGit;
  const target = options.targetVersion ?? KIT_VERSION;
  const branch = kitBranchName(target);
  const row: PlanRow = {
    path: installPath,
    kind: "missing",
    currentVersion: null,
    targetVersion: target,
    preProd: null,
    behind: null,
    dirtyKitFiles: [],
    leaseHolder: null,
    remote: null,
    hasLocalPreProd: false,
    skip: null,
    branch,
  };
  const record = await inspectInstall(installPath, options.inspect);
  if (!record) {
    row.skip = "no kit manifest any more (run agent-kit installs prune)";
    return row;
  }
  row.kind = record.kind;
  row.currentVersion = record.kitVersion;
  const kindSkip: Partial<Record<InstallKind, string>> = {
    home: "home-level install (run agent-kit update in ~ by hand)",
    fixture: "fixture (not its own repository)",
    factory: "factory (the kit's own repository)",
  };
  if (kindSkip[record.kind]) {
    row.skip = kindSkip[record.kind] as string;
    return row;
  }
  if (record.kind === "worktree" && !options.includeWorktrees) {
    row.skip = "worktree (--include-worktrees to update it)";
    return row;
  }
  if (!record.kitVersion) {
    row.skip = "manifest has no version (run agent-kit update in it by hand)";
    return row;
  }
  let cmp: number;
  try {
    cmp = compareSemver(record.kitVersion, target);
  } catch {
    row.skip = `unreadable version ${record.kitVersion} (run agent-kit update in it by hand)`;
    return row;
  }
  if (cmp === 0) {
    row.skip = `current (v${target})`;
    return row;
  }
  if (cmp > 0) {
    row.skip = `ahead of this CLI (v${record.kitVersion})`;
    return row;
  }
  const fromMajor = majorOf(record.kitVersion);
  const toMajor = majorOf(target);
  if (fromMajor !== null && toMajor !== null && fromMajor < toMajor) {
    row.skip = `major jump v${record.kitVersion} → v${target} (run a single-repo agent-kit update)`;
    return row;
  }

  const inside = await gitOk(git, ["rev-parse", "--is-inside-work-tree"], installPath);
  if (inside !== "true") {
    row.skip = "not a git repository";
    return row;
  }

  const lease = inspectQueueLease(installPath);
  if (lease.kind === "held") {
    row.leaseHolder = `session ${lease.lease.session} (pid ${lease.lease.dispatcher.pid})`;
  }

  const rawUrl = await gitOk(git, ["config", "--get", "remote.origin.url"], installPath);
  row.remote = rawUrl ? parseRemote(rawUrl) : null;
  if (rawUrl && !row.remote) {
    row.skip = "origin URL not understood (update this repo by hand)";
    return row;
  }
  if (row.remote && row.remote.forge === "none") {
    // Self-hosted GitLab under another hostname: same rule as the scanner
    // (repository profile `git.provider`, else `.gitlab-ci.yml`).
    const detected = await detectProvider(installPath, row.remote.url);
    if (detected.provider === "gitlab") row.remote = { ...row.remote, forge: "gitlab" };
    else if (detected.provider === "github") row.remote = { ...row.remote, forge: "github" };
  }

  if (row.remote && options.fetch !== false) {
    // Probe the pre-prod branch names on origin, then fetch the one we use.
    await gitOk(git, ["fetch", "--quiet", "origin"], installPath);
  }
  const pre = await resolvePreProd(git, installPath, Boolean(row.remote));
  row.preProd = pre.preProd;
  row.hasLocalPreProd = pre.hasLocal;
  if (!row.preProd) {
    row.skip = "no pre-prod branch found (staging, main or master)";
    return row;
  }

  if (row.remote && row.hasLocalPreProd) {
    const counts = await gitOk(
      git,
      [
        "rev-list",
        "--left-right",
        "--count",
        `refs/heads/${row.preProd}...refs/remotes/origin/${row.preProd}`,
      ],
      installPath,
    );
    const [ahead, behind] = (counts ?? "").split(/\s+/).map(Number);
    if (Number.isFinite(behind)) row.behind = behind as number;
    if (Number.isFinite(ahead) && (ahead as number) > 0) {
      row.skip = `diverged (local ${row.preProd} has ${ahead} commit(s) not on origin)`;
      return row;
    }
  }

  const manifest = await loadAgentKitManifest(installPath);
  const protectedGlobs = resolveProtectedGlobs(manifest);
  row.dirtyKitFiles = (await kitStatusPaths(git, installPath)).filter(
    (p) => !isProtectedPath(p, protectedGlobs),
  );

  if (row.leaseHolder) {
    row.skip = `live writer holds the queue lease (${row.leaseHolder})`;
    return row;
  }
  if (row.dirtyKitFiles.length > 0) {
    row.skip = `dirty kit files (${row.dirtyKitFiles.length}): commit or stash them first`;
    return row;
  }
  const localBranch = await gitOk(
    git,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    installPath,
  );
  const remoteBranch = row.remote
    ? await gitOk(
        git,
        ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`],
        installPath,
      )
    : null;
  if (localBranch || remoteBranch) {
    row.skip = `branch ${branch} already exists (merge or close its PR/MR, then delete it)`;
    return row;
  }
  return row;
}

function displayPath(p: string, home: string): string {
  return p === home ? "~" : p.startsWith(`${home}${path.sep}`) ? `~${p.slice(home.length)}` : p;
}

function renderTable(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const fmt = (r: string[]) =>
    r
      .map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return [fmt(header), ...rows.map(fmt)].join("\n");
}

export function renderPlanTable(rows: readonly PlanRow[], home = homedir()): string {
  return renderTable(
    ["REPO", "KIT", "PRE-PROD", "DIRTY", "LEASE", "ACTION"],
    rows.map((r) => [
      displayPath(r.path, home),
      `${r.currentVersion ?? "?"} → ${r.targetVersion}`,
      r.preProd ? `${r.preProd}${r.behind ? ` (behind ${r.behind})` : ""}` : "-",
      String(r.dirtyKitFiles.length),
      r.leaseHolder ? "held" : "free",
      r.skip ? `skip: ${r.skip}` : `update on ${r.branch}`,
    ]),
  );
}

export type RowOutcome =
  | { status: "opened"; branch: string; url: string }
  | { status: "pushed"; branch: string; note: string }
  | { status: "committed"; branch: string; note: string }
  | { status: "current"; note: string }
  | { status: "skipped"; note: string }
  | { status: "error"; note: string };

export interface ExecuteOptions {
  git?: GitRunner;
  forge?: ForgeRunner;
  apply?: (root: string) => Promise<ApplyUpdateResult>;
}

async function currentRef(
  git: GitRunner,
  root: string,
): Promise<{ branch: string | null; sha: string }> {
  const branch = (await gitOk(git, ["branch", "--show-current"], root)) || null;
  const sha = await git(["rev-parse", "HEAD"], root);
  return { branch, sha };
}

async function switchBack(
  git: GitRunner,
  root: string,
  start: { branch: string | null; sha: string },
) {
  if (start.branch) await git(["switch", start.branch], root);
  else await git(["switch", "--detach", start.sha], root);
}

/** Whole-tree status paths (untracked included), for before/after comparison. */
async function treeStatusPaths(git: GitRunner, root: string): Promise<string[]> {
  return parsePorcelainZ(
    await git(["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all"], root),
  );
}

/**
 * Update one planned repository. It returns to the starting branch and drops
 * the local kit branch whenever the tree holds nothing of its own, so an
 * existing `chore/kit-X.Y.Z` always means "reached origin" (or a no-remote
 * commit) and a rerun retries every other failure. It stays on the kit branch
 * only when its own writes are left uncommitted, so nothing is carried onto
 * the operator's branch and nothing is restored or discarded.
 */
export async function executeRow(row: PlanRow, options: ExecuteOptions = {}): Promise<RowOutcome> {
  if (row.skip) return { status: "skipped", note: row.skip };
  const git = options.git ?? defaultGit;
  const forge = options.forge ?? defaultForge;
  const apply = options.apply ?? ((root: string) => applyUpdateAtRoot(root, {}));
  const root = row.path;
  const preProd = row.preProd as string;
  const branch = row.branch;
  let start: { branch: string | null; sha: string };
  let before: Set<string>;
  try {
    start = await currentRef(git, root);
    before = new Set(await treeStatusPaths(git, root));
  } catch (err) {
    return { status: "error", note: `cannot read the repository state: ${(err as Error).message}` };
  }
  const newDirt = async () => (await treeStatusPaths(git, root)).filter((p) => !before.has(p));

  let onKitBranch = false;
  /** Leave the kit branch: back to the start, local branch dropped unless kept. */
  const leave = async (keepBranch: boolean) => {
    await switchBack(git, root, start);
    onKitBranch = false;
    if (!keepBranch) await gitOk(git, ["branch", "-D", branch], root);
  };

  try {
    let base = preProd;
    if (row.remote) {
      await git(["fetch", "--quiet", "origin", preProd], root);
      if (row.hasLocalPreProd) {
        await git(["switch", preProd], root);
        try {
          await git(["merge", "--ff-only", `refs/remotes/origin/${preProd}`], root);
        } catch (err) {
          await switchBack(git, root, start);
          return {
            status: "error",
            note: `${preProd} cannot fast-forward from origin (diverged): ${(err as Error).message}`,
          };
        }
      } else {
        base = `refs/remotes/origin/${preProd}`;
      }
    }
    await git(["switch", "--no-track", "-c", branch, base], root);
    onKitBranch = true;

    const result = await apply(root);
    if (result.status !== "applied") {
      const reason =
        result.status === "no-manifest" ? "no kit manifest on the pre-prod branch" : result.reason;
      const leftover = await newDirt();
      if (leftover.length === 0) {
        await leave(false);
        return { status: "error", note: `update refused: ${reason}` };
      }
      return {
        status: "error",
        note: `update failed: ${reason}; left on ${branch} with ${leftover.length} uncommitted path(s) to inspect`,
      };
    }

    const candidates = new Set([
      ...result.stats.written,
      ...result.stats.removed,
      MANIFEST_RELATIVE_PATH,
      MANAGED_HASHES_REL,
    ]);
    const changed = (await newDirt()).filter((p) => candidates.has(p));
    if (changed.length === 0) {
      const stray = await newDirt();
      if (stray.length > 0) {
        return {
          status: "error",
          note: `the apply changed ${stray.length} path(s) it did not report; left on ${branch} to inspect`,
        };
      }
      await leave(false);
      return { status: "current", note: `${preProd} already carries v${result.toVersion}` };
    }

    const message = `chore(agent-kit): update kit to v${result.toVersion}`;
    await git(["add", "--", ...changed], root);
    await git(["commit", "--quiet", "--only", "-m", message, "--", ...changed], root);
    const stray = await newDirt();
    if (stray.length > 0) {
      return {
        status: "error",
        note: `committed on ${branch}, but ${stray.length} other new path(s) appeared (${stray.slice(0, 3).join(", ")}); left on ${branch}, not pushed`,
      };
    }

    if (!row.remote) {
      await leave(true);
      return { status: "committed", branch, note: "no remote: branch + commit only" };
    }

    try {
      await git(["push", "--quiet", "-u", "origin", branch], root);
    } catch (err) {
      await leave(false);
      return { status: "error", note: `push failed: ${(err as Error).message}` };
    }
    await leave(true);

    const body = [
      `Agent Kit v${result.fromVersion} → v${result.toVersion}, opened by \`${UPDATE_ALL_COMMAND}\`.`,
      "",
      `Only kit-managed paths are committed (${changed.length} file(s)); L3 protected paths are untouched.`,
      "Review and merge it yourself; nothing was merged.",
    ].join("\n");
    const argv = forgeCreateArgv(row.remote, { head: branch, base: preProd, title: message, body });
    if (!argv) {
      return {
        status: "pushed",
        branch,
        note: `pushed; open the PR/MR on ${row.remote.host} by hand`,
      };
    }
    try {
      const out = await forge(argv.cmd, argv.args, root);
      const url =
        out
          .split("\n")
          .find((l) => /^https?:\/\//.test(l.trim()))
          ?.trim() ?? out.trim();
      return { status: "opened", branch, url };
    } catch (err) {
      return {
        status: "pushed",
        branch,
        note: `pushed, but ${argv.cmd} failed: ${(err as Error).message}; open the PR/MR by hand`,
      };
    }
  } catch (err) {
    const message = (err as Error).message;
    if (!onKitBranch) {
      await switchBack(git, root, start).catch(() => undefined);
      return { status: "error", note: message };
    }
    const leftover = await newDirt().catch(() => ["(status unreadable)"]);
    if (leftover.length === 0) {
      await leave(false).catch(() => undefined);
      return { status: "error", note: message };
    }
    return { status: "error", note: `${message} (left on ${branch} with uncommitted changes)` };
  }
}

export function renderSummaryTable(
  results: readonly { row: PlanRow; outcome: RowOutcome }[],
  home = homedir(),
): string {
  return renderTable(
    ["REPO", "RESULT", "DETAIL"],
    results.map(({ row, outcome }) => [
      displayPath(row.path, home),
      outcome.status,
      outcome.status === "opened" ? outcome.url : outcome.note,
    ]),
  );
}

export interface UpdateAllOptions extends ExecuteOptions {
  includeWorktrees?: boolean;
  /** Registry flags forwarded to each apply (`--registry`, `--url`, `--ref`, `--refresh`). */
  applyOptions?: ApplyUpdateOptions;
  /** TTY and env probe for the operator-only refusal. */
  terminal?: OperatorTerminalProbe;
  /** npm latest for the preflight (tests); fetched when undefined. */
  npmLatest?: () => Promise<string | null>;
  confirm?: (message: string) => Promise<boolean>;
  targetVersion?: string;
  inspect?: InspectOptions;
  installsFile?: string;
  home?: string;
  out?: (line: string) => void;
}

export interface UpdateAllResult {
  status: "refused" | "preflight-stop" | "nothing-to-do" | "declined" | "done";
  reason?: string;
  rows: PlanRow[];
  results: { row: PlanRow; outcome: RowOutcome }[];
}

async function defaultConfirm(message: string): Promise<boolean> {
  const ok = await confirm({ message, initialValue: false });
  return !isCancel(ok) && ok === true;
}

/** The whole `update --all` run. Returns the outcome; the command maps it to an exit code. */
export async function runUpdateAll(options: UpdateAllOptions = {}): Promise<UpdateAllResult> {
  const out = options.out ?? ((line: string) => console.log(line));
  const home = options.home ?? homedir();
  const empty = { rows: [], results: [] };

  // 1. Operator-only: checked before any registry read, network or git call.
  const refusal = operatorOnlyRefusal(UPDATE_ALL_COMMAND, options.terminal);
  if (refusal) {
    logger.error(refusal);
    return { status: "refused", reason: refusal, ...empty };
  }

  // 2. Preflight: the apply stamps this CLI's version, so a CLI behind npm
  //    would stamp an old version across the fleet. Prefs and env opt-outs do
  //    not lift this stop: it is a safety check, not a notice.
  const cli = await checkRunningCliVsNpmLatest(process.cwd(), {
    respectPrefs: false,
    fetchLatest: options.npmLatest,
  });
  if (cli.status !== "up-to-date") {
    const reason =
      cli.status === "behind"
        ? `${cli.message} Update the CLI first, then run ${UPDATE_ALL_COMMAND} again.`
        : cli.status === "ahead"
          ? `${cli.message} ${UPDATE_ALL_COMMAND} only stamps released versions; install the npm release first.`
          : `Cannot confirm this CLI matches npm latest (${cli.message}); ${UPDATE_ALL_COMMAND} stops rather than guess.`;
    logger.error(reason);
    return { status: "preflight-stop", reason, ...empty };
  }

  // 3. Plan table from the machine install registry.
  let entries: Awaited<ReturnType<typeof listInstalls>>;
  try {
    entries = await listInstalls(options.installsFile ? { file: options.installsFile } : {});
  } catch (err) {
    const reason = err instanceof InstallsRegistryError ? err.message : String(err);
    logger.error(reason);
    return { status: "preflight-stop", reason, ...empty };
  }
  if (entries.length === 0) {
    const reason = "No installs recorded. Run `agent-kit installs scan` first.";
    logger.warn(reason);
    return { status: "nothing-to-do", reason, ...empty };
  }
  const rows: PlanRow[] = [];
  for (const entry of entries) {
    rows.push(
      await planRow(entry.path, {
        targetVersion: options.targetVersion,
        includeWorktrees: options.includeWorktrees,
        inspect: options.inspect,
        git: options.git,
      }),
    );
  }
  out(renderPlanTable(rows, home));
  const todo = rows.filter((r) => !r.skip);
  if (todo.length === 0) {
    out("Nothing to update.");
    return { status: "nothing-to-do", rows, results: [] };
  }

  // 4. One batch confirm (never lifted by --yes).
  const ask = options.confirm ?? defaultConfirm;
  const ok = await ask(
    `Update ${todo.length} repositor${todo.length === 1 ? "y" : "ies"}: one branch ${todo[0]?.branch} and one PR/MR each (nothing is merged)?`,
  );
  if (!ok) {
    out("Cancelled; nothing was changed.");
    return { status: "declined", rows, results: [] };
  }

  // 5. Sequential per repo; one failure does not stop the others.
  const apply =
    options.apply ?? ((root: string) => applyUpdateAtRoot(root, { ...options.applyOptions }));
  const results: { row: PlanRow; outcome: RowOutcome }[] = [];
  for (const row of rows) {
    if (!row.skip) out(`\n▸ ${displayPath(row.path, home)}`);
    const outcome = await executeRow(row, { git: options.git, forge: options.forge, apply });
    results.push({ row, outcome });
  }
  out("");
  out(renderSummaryTable(results, home));
  return { status: "done", rows, results };
}
