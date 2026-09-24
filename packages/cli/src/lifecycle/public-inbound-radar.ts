import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileExists, writeJson } from "../utils/fs.js";
import { contextConfigPath, intervalElapsed, loadContextConfig } from "./context-config.js";

const execFileAsync = promisify(execFile);

/** Public mirror SoT for inbound inspect (never the private factory issues board). */
export const PUBLIC_INBOUND_REPO = "agent-kit-startup/agent-kit";

export type PublicInboundStatus =
  | "ok"
  | "skipped-non-factory"
  | "skipped-gh-missing"
  | "skipped-offline"
  | "skipped-disabled"
  | "skipped-interval"
  | "error";

export type PublicInboundKind = "issue" | "pull_request";

export type PublicInboundClass = "issue" | "human-pr" | "dependabot";

export interface PublicInboundItem {
  kind: PublicInboundKind;
  class: PublicInboundClass;
  number: number;
  title: string;
  author: string;
  updatedAt: string;
  url: string;
  labels: string[];
  cite: string;
}

export interface PublicInboundSummary {
  issues: number;
  humanPullRequests: number;
  dependabotPullRequests: number;
  total: number;
}

export interface PublicInboundCheckPrefs {
  enabled: boolean;
  intervalDays: number;
  lastCheckedAt: string | null;
}

export interface PublicInboundResult {
  status: PublicInboundStatus;
  repo: typeof PUBLIC_INBOUND_REPO;
  checkedAt: string;
  factory: boolean;
  items: PublicInboundItem[];
  summary: PublicInboundSummary;
  message: string;
  /** Always false: this check never mutates GitHub. */
  mutateRecommended: false;
}

export type GhRunner = (args: string[], options?: { cwd?: string }) => Promise<string>;

export interface PublicInboundOptions {
  /** Injected `gh` runner for tests. Default shells out to `gh`. */
  runGh?: GhRunner;
  /** Injected factory-lane probe. Default: origin has agent-kit-dev or dogfood/ exists. */
  isFactory?: (cwd: string) => Promise<boolean>;
  /** When true, skip network and return skipped-offline. */
  offline?: boolean;
  /** When true, honor publicInboundCheck.enabled + intervalDays. */
  respectPrefs?: boolean;
  /** Persist publicInboundCheck.lastCheckedAt after a successful or empty ok check. */
  stamp?: boolean;
  /** Override clock for stamps in tests. */
  now?: () => Date;
}

const DEFAULT_PREFS: PublicInboundCheckPrefs = {
  enabled: false,
  intervalDays: 7,
  lastCheckedAt: null,
};

interface GhListRow {
  number?: number;
  title?: string;
  updatedAt?: string;
  url?: string;
  author?: { login?: string } | null;
  labels?: Array<{ name?: string } | string> | null;
}

function emptySummary(): PublicInboundSummary {
  return { issues: 0, humanPullRequests: 0, dependabotPullRequests: 0, total: 0 };
}

function summarize(items: PublicInboundItem[]): PublicInboundSummary {
  const summary = emptySummary();
  for (const item of items) {
    summary.total += 1;
    if (item.class === "issue") summary.issues += 1;
    else if (item.class === "dependabot") summary.dependabotPullRequests += 1;
    else summary.humanPullRequests += 1;
  }
  return summary;
}

function labelNames(labels: GhListRow["labels"]): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((entry) => (typeof entry === "string" ? entry : entry?.name))
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

/** Dependabot / renovate bot authors collapse to one operator decision. */
export function isDependabotAuthor(login: string | undefined | null): boolean {
  if (!login) return false;
  const normalized = login.toLowerCase();
  return (
    normalized === "dependabot" ||
    normalized === "dependabot[bot]" ||
    normalized === "app/dependabot" ||
    normalized.startsWith("dependabot") ||
    normalized === "renovate" ||
    normalized === "renovate[bot]"
  );
}

export function classifyInbound(kind: PublicInboundKind, authorLogin: string): PublicInboundClass {
  if (kind === "issue") return "issue";
  return isDependabotAuthor(authorLogin) ? "dependabot" : "human-pr";
}

export function readPublicInboundCheckPrefs(config: unknown): PublicInboundCheckPrefs {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ...DEFAULT_PREFS };
  }
  const raw = (config as Record<string, unknown>).publicInboundCheck;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_PREFS };
  }
  const uc = raw as Record<string, unknown>;
  const intervalDays =
    typeof uc.intervalDays === "number" && Number.isInteger(uc.intervalDays) && uc.intervalDays >= 1
      ? uc.intervalDays
      : DEFAULT_PREFS.intervalDays;
  return {
    enabled: uc.enabled === true,
    intervalDays,
    lastCheckedAt: typeof uc.lastCheckedAt === "string" ? uc.lastCheckedAt : null,
  };
}

/** Persist publicInboundCheck.lastCheckedAt (interval stamp only). */
export async function stampPublicInboundCheck(cwd: string, checkedAt?: Date): Promise<void> {
  const existing = (await loadContextConfig(cwd)) ?? {};
  const prev =
    existing.publicInboundCheck && typeof existing.publicInboundCheck === "object"
      ? { ...(existing.publicInboundCheck as Record<string, unknown>) }
      : {};
  existing.publicInboundCheck = {
    ...DEFAULT_PREFS,
    ...prev,
    lastCheckedAt: (checkedAt ?? new Date()).toISOString(),
  };
  await writeJson(contextConfigPath(cwd), existing);
}

function mapRows(kind: PublicInboundKind, rows: GhListRow[]): PublicInboundItem[] {
  const items: PublicInboundItem[] = [];
  for (const row of rows) {
    const number = typeof row.number === "number" ? row.number : Number(row.number);
    if (!Number.isFinite(number) || number <= 0) continue;
    const author = row.author?.login?.trim() || "unknown";
    const title =
      typeof row.title === "string" && row.title.trim() ? row.title.trim() : "(no title)";
    const updatedAt =
      typeof row.updatedAt === "string" && row.updatedAt.trim() ? row.updatedAt.trim() : "";
    const url =
      typeof row.url === "string" && row.url.trim()
        ? row.url.trim()
        : `https://github.com/${PUBLIC_INBOUND_REPO}/${kind === "issue" ? "issues" : "pull"}/${number}`;
    items.push({
      kind,
      class: classifyInbound(kind, author),
      number,
      title,
      author,
      updatedAt,
      url,
      labels: labelNames(row.labels),
      cite: `${PUBLIC_INBOUND_REPO}#${number}`,
    });
  }
  return items;
}

async function defaultRunGh(args: string[], options?: { cwd?: string }): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    cwd: options?.cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout;
}

async function ghAvailable(runGh: GhRunner, cwd: string): Promise<boolean> {
  try {
    await runGh(["--version"], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Factory lane: origin URL contains `agent-kit-dev`, or `dogfood/` exists at the
 * checkout root (same hard stop as `/public-issue-triage`).
 */
export async function detectFactoryCheckout(cwd: string): Promise<boolean> {
  const root = path.resolve(cwd);
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
      timeout: 5_000,
    });
    if (/agent-kit-dev/i.test(stdout)) return true;
  } catch {
    // fall through to dogfood probe
  }
  return fileExists(path.join(root, "dogfood", "README.md"));
}

async function listJson(
  runGh: GhRunner,
  cwd: string,
  resource: "issue" | "pr",
): Promise<GhListRow[]> {
  const stdout = await runGh(
    [
      resource,
      "list",
      "--repo",
      PUBLIC_INBOUND_REPO,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,author,updatedAt,labels,url",
    ],
    { cwd },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  return Array.isArray(parsed) ? (parsed as GhListRow[]) : [];
}

function resultBase(
  status: PublicInboundStatus,
  message: string,
  factory: boolean,
  now: Date,
  items: PublicInboundItem[] = [],
): PublicInboundResult {
  return {
    status,
    repo: PUBLIC_INBOUND_REPO,
    checkedAt: now.toISOString(),
    factory,
    items,
    summary: summarize(items),
    message,
    mutateRecommended: false,
  };
}

/**
 * Read-only list of open public issues and pull requests on the public mirror.
 * Fail-open: missing gh, offline, or non-factory checkout skips without throwing.
 */
export async function checkPublicInbound(
  cwd: string,
  options: PublicInboundOptions = {},
): Promise<PublicInboundResult> {
  const now = options.now?.() ?? new Date();
  const runGh = options.runGh ?? defaultRunGh;
  const isFactory = options.isFactory ?? detectFactoryCheckout;
  const root = path.resolve(cwd);

  try {
    await access(root);
  } catch {
    return resultBase("error", `cwd unreadable: ${root}`, false, now);
  }

  const factory = await isFactory(root);
  if (!factory) {
    return resultBase(
      "skipped-non-factory",
      "Factory-only check. Aborting outside agent-kit-dev / dogfood checkout.",
      false,
      now,
    );
  }

  if (options.respectPrefs) {
    const prefs = readPublicInboundCheckPrefs(await loadContextConfig(root));
    if (!prefs.enabled) {
      return resultBase(
        "skipped-disabled",
        "publicInboundCheck.enabled is false (opt-in). Set true in .cursor/context/config.json to nudge.",
        true,
        now,
      );
    }
    if (!intervalElapsed(prefs.lastCheckedAt, prefs.intervalDays)) {
      return resultBase(
        "skipped-interval",
        `Within publicInboundCheck.intervalDays (${prefs.intervalDays}); last check ${prefs.lastCheckedAt}.`,
        true,
        now,
      );
    }
  }

  if (options.offline) {
    return resultBase("skipped-offline", "Offline flag set; skipped GitHub fetch.", true, now);
  }

  if (!(await ghAvailable(runGh, root))) {
    return resultBase(
      "skipped-gh-missing",
      "gh CLI missing or not runnable; fail-open skip.",
      true,
      now,
    );
  }

  try {
    const [issueRows, prRows] = await Promise.all([
      listJson(runGh, root, "issue"),
      listJson(runGh, root, "pr"),
    ]);
    const items = [...mapRows("issue", issueRows), ...mapRows("pull_request", prRows)].sort(
      (a, b) => b.number - a.number,
    );
    const summary = summarize(items);
    const message =
      summary.total === 0
        ? `No open issues or pull requests on ${PUBLIC_INBOUND_REPO}.`
        : `Open inbound on ${PUBLIC_INBOUND_REPO}: ${summary.issues} issue(s), ${summary.humanPullRequests} human PR(s), ${summary.dependabotPullRequests} Dependabot PR(s).`;
    const result = resultBase("ok", message, true, now, items);
    if (options.stamp) {
      await stampPublicInboundCheck(root, now);
    }
    return result;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Network / auth failures fail open (same class as offline).
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|offline|Could not resolve/i.test(detail)) {
      return resultBase(
        "skipped-offline",
        `GitHub unreachable; fail-open skip (${detail}).`,
        true,
        now,
      );
    }
    return resultBase("error", `Public inbound check failed: ${detail}`, true, now);
  }
}

/** True when sessionStart / project-command nudge should surface the route Ask. */
export function shouldEmitPublicInboundNudge(
  result: PublicInboundResult | Record<string, unknown> | null,
): boolean {
  if (!result || result.status !== "ok") return false;
  if (result.mutateRecommended === true) return false;
  const summary = result.summary;
  if (!summary || typeof summary !== "object") return false;
  const total = (summary as { total?: unknown }).total;
  return typeof total === "number" && total > 0;
}
