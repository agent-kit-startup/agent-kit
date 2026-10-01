import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PUBLIC_INBOUND_REPO, detectFactoryCheckout } from "./public-inbound-radar.js";

const execFileAsync = promisify(execFile);

/**
 * Provenance marker (ADR 2026-09-28_broad-intake-remote-issues-both-lanes point 2).
 * Default label is generic; an operator adds extra labels via AGENT_KIT_REMOTE_ISSUE_LABELS
 * (comma list) so no lab name ships in the product.
 */
export const REMOTE_ISSUE_LABEL = "dogfood";
export const REMOTE_ISSUE_TITLE_PREFIX = "[Dogfood]";

export type RemoteProvider = "github" | "gitlab";
export type RemoteLane = "factory" | "consumer";
export type RemoteTargetRole = "origin" | "public";

export type RemoteTargetStatus =
  | "ok"
  | "skipped-no-remote"
  | "skipped-cli-missing"
  | "skipped-auth"
  | "skipped-offline"
  | "skipped-error";

export interface RemoteIssueItem {
  role: RemoteTargetRole;
  provider: RemoteProvider;
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
  updatedAt: string;
  cite: string;
}

export interface RemoteTargetResult {
  role: RemoteTargetRole;
  provider: RemoteProvider | null;
  host: string | null;
  repo: string | null;
  status: RemoteTargetStatus;
  items: RemoteIssueItem[];
}

export interface RemoteIssuesNote {
  label: "note";
  message: string;
}

export interface RemoteIssuesResult {
  lane: RemoteLane;
  checkedAt: string;
  targets: RemoteTargetResult[];
  items: RemoteIssueItem[];
  /** Degradations (missing CLI, auth, offline). Intake shows them as `note` rows; never blocking. */
  notes: RemoteIssuesNote[];
  /** Always false: intake only lists. */
  mutateRecommended: false;
}

/** Injected CLI runner (`gh` / `glab`) for tests. */
export type ForgeRunner = (
  bin: "gh" | "glab",
  args: string[],
  options?: { cwd?: string },
) => Promise<string>;

export interface RemoteIssuesOptions {
  runCli?: ForgeRunner;
  /** Injected `git remote get-url <name>` for tests; returns null when the remote is absent. */
  getRemoteUrl?: (cwd: string, name: string) => Promise<string | null>;
  isFactory?: (cwd: string) => Promise<boolean>;
  now?: () => Date;
}

export interface ParsedRemote {
  provider: RemoteProvider;
  host: string;
  repo: string;
}

/** Parse ssh (`git@host:owner/repo.git`, incl. ssh aliases) and https remotes. */
export function parseRemoteUrl(url: string): ParsedRemote | null {
  const trimmed = url.trim();
  const match = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^:/\s]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i.exec(
    trimmed,
  );
  if (!match) return null;
  const host = (match[1] ?? "").toLowerCase();
  const repo = (match[2] ?? "").replace(/^\/+/, "");
  if (!repo.includes("/")) return null;
  // ssh host aliases (e.g. github-agent-kit) still contain the forge name.
  const provider: RemoteProvider = /gitlab|(^|\.)git\.[^.]+\./i.test(host) ? "gitlab" : "github";
  return { provider, host, repo };
}

/** Provenance filter: label `dogfood` (or env extras) and/or title prefix `[Dogfood]`. */
export function matchesProvenance(
  title: string,
  labels: string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const wanted = new Set([
    REMOTE_ISSUE_LABEL,
    ...(env.AGENT_KIT_REMOTE_ISSUE_LABELS ?? "")
      .split(",")
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean),
  ]);
  if (labels.some((label) => wanted.has(label.toLowerCase()))) return true;
  return title.trim().toLowerCase().startsWith(REMOTE_ISSUE_TITLE_PREFIX.toLowerCase());
}

async function defaultRunCli(
  bin: "gh" | "glab",
  args: string[],
  options?: { cwd?: string },
): Promise<string> {
  const { stdout } = await execFileAsync(bin, args, {
    cwd: options?.cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout;
}

async function defaultGetRemoteUrl(cwd: string, name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", name], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function classifyFailure(error: unknown): RemoteTargetStatus {
  const err = error as { code?: unknown; message?: unknown; stderr?: unknown };
  const text = `${String(err?.message ?? "")} ${String(err?.stderr ?? "")}`;
  if (err?.code === "ENOENT" || /ENOENT|command not found/i.test(text))
    return "skipped-cli-missing";
  if (/auth|login|401|403|token|credential/i.test(text)) return "skipped-auth";
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network|resolve host|timed? ?out|offline/i.test(text)) {
    return "skipped-offline";
  }
  return "skipped-error";
}

interface GithubRow {
  number?: number;
  title?: string;
  updatedAt?: string;
  url?: string;
  labels?: Array<{ name?: string } | string> | null;
}

interface GitlabRow {
  iid?: number;
  title?: string;
  updated_at?: string;
  web_url?: string;
  labels?: Array<{ name?: string } | string> | null;
}

function labelNames(labels: GithubRow["labels"]): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((entry) => (typeof entry === "string" ? entry : entry?.name))
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

function parseRows(stdout: string): unknown[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

async function listGithub(
  runCli: ForgeRunner,
  cwd: string,
  remote: ParsedRemote,
  role: RemoteTargetRole,
): Promise<RemoteIssueItem[]> {
  const stdout = await runCli(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      remote.repo,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,updatedAt,labels,url",
    ],
    { cwd },
  );
  return (parseRows(stdout) as GithubRow[]).flatMap((row) =>
    toItem(role, remote, row.number, row.title, row.url, row.updatedAt, row.labels),
  );
}

async function listGitlab(
  runCli: ForgeRunner,
  cwd: string,
  remote: ParsedRemote,
  role: RemoteTargetRole,
): Promise<RemoteIssueItem[]> {
  const project = encodeURIComponent(remote.repo);
  const args = ["api"];
  if (remote.host !== "gitlab.com") args.push("--hostname", remote.host);
  args.push(`projects/${project}/issues?state=opened&per_page=100`);
  const stdout = await runCli("glab", args, { cwd });
  return (parseRows(stdout) as GitlabRow[]).flatMap((row) =>
    toItem(role, remote, row.iid, row.title, row.web_url, row.updated_at, row.labels),
  );
}

function toItem(
  role: RemoteTargetRole,
  remote: ParsedRemote,
  rawNumber: unknown,
  rawTitle: unknown,
  rawUrl: unknown,
  rawUpdated: unknown,
  rawLabels: GithubRow["labels"],
): RemoteIssueItem[] {
  const number = typeof rawNumber === "number" ? rawNumber : Number(rawNumber);
  if (!Number.isFinite(number) || number <= 0) return [];
  const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : "(no title)";
  const labels = labelNames(rawLabels);
  if (!matchesProvenance(title, labels)) return [];
  return [
    {
      role,
      provider: remote.provider,
      repo: remote.repo,
      number,
      title,
      url:
        typeof rawUrl === "string" && rawUrl.trim()
          ? rawUrl.trim()
          : `https://${remote.host}/${remote.repo}/issues/${number}`,
      labels,
      updatedAt: typeof rawUpdated === "string" ? rawUpdated.trim() : "",
      cite: `${remote.repo}#${number}`,
    },
  ];
}

async function readTarget(
  runCli: ForgeRunner,
  cwd: string,
  role: RemoteTargetRole,
  url: string | null,
): Promise<RemoteTargetResult> {
  const remote = url ? parseRemoteUrl(url) : null;
  if (!remote) {
    return { role, provider: null, host: null, repo: null, status: "skipped-no-remote", items: [] };
  }
  const base = { role, provider: remote.provider, host: remote.host, repo: remote.repo };
  try {
    const items =
      remote.provider === "gitlab"
        ? await listGitlab(runCli, cwd, remote, role)
        : await listGithub(runCli, cwd, remote, role);
    return { ...base, status: "ok", items };
  } catch (error) {
    return { ...base, status: classifyFailure(error), items: [] };
  }
}

function noteFor(target: RemoteTargetResult): RemoteIssuesNote | null {
  if (target.status === "ok") return null;
  const where = target.repo ? `${target.role} ${target.repo}` : `${target.role} remote`;
  const bin = target.provider === "gitlab" ? "glab" : "gh";
  const reason: Record<Exclude<RemoteTargetStatus, "ok">, string> = {
    "skipped-no-remote": "no remote configured",
    "skipped-cli-missing": `${bin} not installed`,
    "skipped-auth": `${bin} not authenticated`,
    "skipped-offline": "offline or host unreachable",
    "skipped-error": "remote read failed",
  };
  return {
    label: "note",
    message: `Remote issues skipped for ${where}: ${reason[target.status]}. Local inbox only.`,
  };
}

/**
 * Read-only list of remote issues carrying the dogfood provenance marker.
 * Factory lane: origin (private agent-kit-dev) + public agent-kit. Consumer lane:
 * own origin only (GitHub via gh, GitLab via glab), never upstream.
 * Fail-open: missing CLI, auth, or network degrade to notes, never throw.
 */
export async function readRemoteIssues(
  cwd: string,
  options: RemoteIssuesOptions = {},
): Promise<RemoteIssuesResult> {
  const now = options.now?.() ?? new Date();
  const runCli = options.runCli ?? defaultRunCli;
  const getRemoteUrl = options.getRemoteUrl ?? defaultGetRemoteUrl;
  const isFactory = options.isFactory ?? detectFactoryCheckout;
  const root = path.resolve(cwd);

  let readable = true;
  try {
    await access(root);
  } catch {
    readable = false;
  }

  const factory = readable ? await isFactory(root) : false;
  const lane: RemoteLane = factory ? "factory" : "consumer";
  const targets: RemoteTargetResult[] = [];

  if (readable) {
    targets.push(await readTarget(runCli, root, "origin", await getRemoteUrl(root, "origin")));
    if (factory) {
      const publicUrl =
        (await getRemoteUrl(root, "public")) ?? `https://github.com/${PUBLIC_INBOUND_REPO}.git`;
      targets.push(await readTarget(runCli, root, "public", publicUrl));
    }
  } else {
    targets.push({
      role: "origin",
      provider: null,
      host: null,
      repo: null,
      status: "skipped-error",
      items: [],
    });
  }

  const notes = targets.flatMap((target) => {
    const note = noteFor(target);
    return note ? [note] : [];
  });
  return {
    lane,
    checkedAt: now.toISOString(),
    targets,
    items: targets.flatMap((target) => target.items),
    notes,
    mutateRecommended: false,
  };
}
