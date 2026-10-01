import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PUBLIC_INBOUND_REPO } from "./public-inbound-radar.js";
import {
  type ForgeRunner,
  REMOTE_ISSUE_TITLE_PREFIX,
  type RemoteProvider,
  parseRemoteUrl,
} from "./remote-issues.js";

const execFileAsync = promisify(execFile);

export type DogfoodLane = "factory" | "consumer";
export type IssueVisibility = "private" | "public";

export interface DogfoodDeps {
  /** Injected `git remote get-url <name>`; null when the remote is absent. */
  getRemoteUrl?: (cwd: string, name: string) => Promise<string | null>;
  runCli?: ForgeRunner;
  now?: () => Date;
}

export interface HygieneResult {
  text: string;
  /** Categories that were redacted (e.g. `secret`, `email`, `path`). */
  redacted: string[];
  /** True when a redaction removed content that may have carried identity or credentials. */
  needsAnonymization: boolean;
}

const TRANSIENT_PHRASES = [/\bas I mentioned\b/gi, /\bdear user\b/gi, /\bconforme falamos\b/gi];

/** Hygiene strip from `.cursor/commands/dogfood.md` point 2. Fail-closed helpers read `needsAnonymization`. */
export function hygieneStrip(input: string): HygieneResult {
  const redacted = new Set<string>();
  let text = input;
  const apply = (name: string, pattern: RegExp, replacement: string) => {
    text = text.replace(pattern, () => {
      redacted.add(name);
      return replacement;
    });
  };
  apply(
    "secret",
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    "[redacted-secret]",
  );
  apply(
    "secret",
    /\b(?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*\S+/gi,
    "[redacted-secret]",
  );
  apply("secret", /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, "[redacted-secret]");
  apply("email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]");
  apply("path", /(?:\/Users|\/home)\/[^\s/]+(?:\/[^\s`'")]*)?/g, "[redacted-path]");
  for (const phrase of TRANSIENT_PHRASES) apply("transient", phrase, "");
  text = text.replace(/[ \t]{2,}/g, " ");
  const needsAnonymization = ["secret", "email", "path"].some((kind) => redacted.has(kind));
  return { text: text.trim(), redacted: [...redacted], needsAnonymization };
}

export function normalizeTopic(topic: string): string {
  const normalized = topic
    .toLowerCase()
    .replace(/\d{4}[-_]?\d{2}[-_]?\d{2}\s*$/, "")
    .replace(/[\s_-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  return normalized || "note";
}

export function dogfoodFilename(topic: string, date: Date): string {
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "_");
  return `cursor_${normalizeTopic(topic)}_${stamp}.md`;
}

export interface DogfoodNoteInput {
  topic: string;
  lane: DogfoodLane;
  observation: string;
  impact?: string;
  tags?: string[];
  source?: string;
  date: Date;
  needsAnonymization?: boolean;
}

export function renderDogfoodNote(input: DogfoodNoteInput): string {
  const tags = (input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const lines = [
    `# Dogfood: ${input.topic}`,
    "",
    `- **Date:** ${input.date.toISOString().slice(0, 10)}`,
    `- **Lane:** ${input.lane}`,
    `- **Source:** ${input.source ?? "explicit dogfood args"}`,
  ];
  if (input.needsAnonymization) lines.push("- **Flag:** needs-anonymization");
  lines.push(
    "",
    "## Observation",
    "",
    input.observation || "(no description)",
    "",
    "## Impact",
    "",
    input.impact || "(to be assessed at triage)",
    "",
    "## Triage (initial)",
    "",
    "- Fix now / Park / Ignore",
    `- **Tags:** ${tags.join(", ")}`,
    "",
  );
  return lines.join("\n");
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
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

/** Lane order from `.cursor/commands/dogfood.md` Step 1; `null` = unknown (caller stops). */
export async function detectDogfoodLane(
  root: string,
  deps: DogfoodDeps = {},
): Promise<DogfoodLane | null> {
  const getRemoteUrl = deps.getRemoteUrl ?? defaultGetRemoteUrl;
  const origin = await getRemoteUrl(root, "origin");
  if (origin && /agent-kit-dev/i.test(origin)) return "factory";
  if (await exists(path.join(root, "dogfood", "README.md"))) return "factory";
  if (await exists(path.join(root, ".cursor", "agent-kit.json"))) return "consumer";
  return null;
}

function inboxDir(root: string, lane: DogfoodLane): string {
  return lane === "factory" ? path.join(root, "dogfood") : path.join(root, ".cursor", "dogfood");
}

const UNPROCESSED_HEADING = /^(#{2,3})\s+Unprocessed Files\s*$/m;
const NEW_INDEX = "# Dogfood inbox\n\n### Unprocessed Files\n\n### Processed Files\n";

/** Append an entry under the `Unprocessed Files` heading (`##` or `###` accepted on read, `###` pinned on create). */
export function appendUnprocessedEntry(readme: string, entry: string): string {
  const match = UNPROCESSED_HEADING.exec(readme);
  if (!match) {
    const base = readme.trimEnd();
    return `${base}${base ? "\n\n" : ""}### Unprocessed Files\n\n${entry}\n`;
  }
  const level = (match[1] ?? "###").length;
  const start = match.index + match[0].length;
  const rest = readme.slice(start);
  const next = new RegExp(`^#{1,${level}}\\s`, "m").exec(rest);
  const sectionEnd = next ? start + next.index : readme.length;
  const section = readme.slice(start, sectionEnd).replace(/\s+$/, "");
  const tail = readme.slice(sectionEnd);
  return `${readme.slice(0, start)}${section}\n${entry}\n${tail ? `\n${tail}` : ""}`;
}

export interface DogfoodAddInput {
  topic: string;
  summary?: string;
  impact?: string;
  tags?: string[];
  source?: string;
}

export type DogfoodAddResult =
  | { status: "unknown-lane" }
  | {
      status: "exists";
      lane: DogfoodLane;
      file: string;
    }
  | {
      status: "filed";
      lane: DogfoodLane;
      file: string;
      relativeFile: string;
      indexFile: string;
      needsAnonymization: boolean;
      redacted: string[];
    };

/** `agent-kit dogfood add`: template file + Unprocessed index append for the detected lane. Never git-adds. */
export async function addDogfoodNote(
  root: string,
  input: DogfoodAddInput,
  deps: DogfoodDeps = {},
): Promise<DogfoodAddResult> {
  const lane = await detectDogfoodLane(root, deps);
  if (!lane) return { status: "unknown-lane" };
  const now = deps.now?.() ?? new Date();
  const topic = hygieneStrip(input.topic);
  const observation = hygieneStrip(input.summary ?? input.topic);
  const impact = hygieneStrip(input.impact ?? "");
  const redacted = [...new Set([...topic.redacted, ...observation.redacted, ...impact.redacted])];
  const needsAnonymization =
    topic.needsAnonymization || observation.needsAnonymization || impact.needsAnonymization;

  const dir = inboxDir(root, lane);
  const filename = dogfoodFilename(topic.text || input.topic, now);
  const file = path.join(dir, filename);
  if (await exists(file)) return { status: "exists", lane, file };

  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    renderDogfoodNote({
      topic: topic.text || input.topic,
      lane,
      observation: observation.text,
      impact: impact.text || undefined,
      tags: input.tags,
      source: input.source,
      date: now,
      needsAnonymization,
    }),
    "utf8",
  );

  const indexFile = path.join(dir, "README.md");
  const oneLine = observation.text.split(/\r?\n/)[0]?.slice(0, 200) ?? "";
  const entry = `- \`${filename}\` - ${oneLine || topic.text} (captured ${now.toISOString().slice(0, 10)})${needsAnonymization ? " [needs-anonymization]" : ""}`;
  const current = (await exists(indexFile)) ? await readFile(indexFile, "utf8") : NEW_INDEX;
  await writeFile(indexFile, appendUnprocessedEntry(current, entry), "utf8");

  return {
    status: "filed",
    lane,
    file,
    relativeFile: path.relative(root, file),
    indexFile,
    needsAnonymization,
    redacted,
  };
}

export interface FileIssueInput {
  visibility: IssueVisibility;
  title: string;
  body: string;
  /** Public filing needs an explicit operator yes (ADR 2026-09-28 point 5; 2026-07-31 decision 3). */
  approvedPublic?: boolean;
}

export type FileIssueStatus =
  | "filed"
  | "refused-unknown-lane"
  | "refused-consumer-public"
  | "refused-not-approved"
  | "refused-hygiene"
  | "skipped-no-remote"
  | "skipped-cli-missing"
  | "skipped-auth"
  | "skipped-error";

export interface FileIssueResult {
  status: FileIssueStatus;
  visibility: IssueVisibility;
  provider: RemoteProvider | null;
  repo: string | null;
  title: string;
  confidential: boolean;
  url: string | null;
  redacted: string[];
  message: string;
}

function withMarker(title: string): string {
  const trimmed = title.trim();
  return trimmed.toLowerCase().startsWith(REMOTE_ISSUE_TITLE_PREFIX.toLowerCase())
    ? trimmed
    : `${REMOTE_ISSUE_TITLE_PREFIX} ${trimmed}`;
}

function classifyCliFailure(error: unknown): FileIssueStatus {
  const err = error as { code?: unknown; message?: unknown; stderr?: unknown };
  const text = `${String(err?.message ?? "")} ${String(err?.stderr ?? "")}`;
  if (err?.code === "ENOENT" || /ENOENT|command not found/i.test(text))
    return "skipped-cli-missing";
  if (/auth|login|401|403|token|credential/i.test(text)) return "skipped-auth";
  return "skipped-error";
}

function extractUrl(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as { web_url?: unknown; url?: unknown };
    const url = parsed.web_url ?? parsed.url;
    if (typeof url === "string" && url) return url;
  } catch {
    // gh prints the URL as plain text
  }
  return /https?:\/\/\S+/.exec(trimmed)?.[0] ?? null;
}

/**
 * `agent-kit dogfood file-issue`. Private: own origin, GitLab confidential. Public: factory only,
 * public repo, requires explicit approval, fails closed when the hygiene strip removed anything
 * identifying. Every issue carries the `[Dogfood]` provenance marker. Never opens PRs.
 */
export async function fileDogfoodIssue(
  root: string,
  input: FileIssueInput,
  deps: DogfoodDeps = {},
): Promise<FileIssueResult> {
  const getRemoteUrl = deps.getRemoteUrl ?? defaultGetRemoteUrl;
  const runCli = deps.runCli ?? defaultRunCli;
  const title = hygieneStrip(withMarker(input.title));
  const body = hygieneStrip(input.body);
  const redacted = [...new Set([...title.redacted, ...body.redacted])];
  const base = {
    visibility: input.visibility,
    provider: null,
    repo: null,
    title: title.text,
    confidential: false,
    url: null,
    redacted,
  } as const;
  const stop = (status: FileIssueStatus, message: string, extra: Partial<FileIssueResult> = {}) =>
    ({ ...base, status, message, ...extra }) as FileIssueResult;

  const lane = await detectDogfoodLane(root, deps);
  if (!lane)
    return stop("refused-unknown-lane", "Lane unknown: not the factory nor a kit install.");

  let target: string | null;
  if (input.visibility === "public") {
    if (lane !== "factory") {
      return stop("refused-consumer-public", "Consumers never file upstream; use a private issue.");
    }
    if (!input.approvedPublic) {
      return stop(
        "refused-not-approved",
        "Public issues need explicit operator approval (--approve-public).",
      );
    }
    if (title.needsAnonymization || body.needsAnonymization) {
      return stop(
        "refused-hygiene",
        `Hygiene strip removed ${redacted.join(", ")}; anonymize the text and retry.`,
      );
    }
    target = `https://github.com/${PUBLIC_INBOUND_REPO}.git`;
  } else {
    target = await getRemoteUrl(root, "origin");
  }

  const remote = target ? parseRemoteUrl(target) : null;
  if (!remote)
    return stop("skipped-no-remote", `No ${input.visibility} remote to file the issue in.`);
  const found = { provider: remote.provider, repo: remote.repo };

  // Private issues keep their own text; public text is the stripped one (identical unless it was clean).
  const finalTitle = title.text;
  const finalBody = input.visibility === "public" ? body.text : input.body.trim();
  try {
    if (remote.provider === "gitlab") {
      const args = ["api", "--method", "POST"];
      if (remote.host !== "gitlab.com") args.push("--hostname", remote.host);
      args.push(
        `projects/${encodeURIComponent(remote.repo)}/issues`,
        "-f",
        `title=${finalTitle}`,
        "-f",
        `description=${finalBody}`,
        "-f",
        `confidential=${input.visibility === "private" ? "true" : "false"}`,
      );
      const url = extractUrl(await runCli("glab", args, { cwd: root }));
      return stop("filed", `Filed ${input.visibility} GitLab issue in ${remote.repo}.`, {
        ...found,
        confidential: input.visibility === "private",
        url,
      });
    }
    const url = extractUrl(
      await runCli(
        "gh",
        ["issue", "create", "--repo", remote.repo, "--title", finalTitle, "--body", finalBody],
        { cwd: root },
      ),
    );
    return stop("filed", `Filed ${input.visibility} GitHub issue in ${remote.repo}.`, {
      ...found,
      url,
    });
  } catch (error) {
    const status = classifyCliFailure(error);
    return stop(status, `Issue not filed (${status}); the local note stays the record.`, found);
  }
}
