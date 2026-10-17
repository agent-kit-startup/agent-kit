import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findOnPath } from "../utils/find-on-path.js";
import { ensurePathIgnored } from "../utils/git-local-exclude.js";
import { claudeRedactions, type RedactionEntry, redactSecrets } from "./backends.js";
import { findHitlGateInText, type HitlStop } from "./hitl-relay.js";

/**
 * Gate exit (codename Coming Home): an opt-in landing step at the end of a
 * headless run (`--land-on-gate`, config key `landOnGate`). When the run ends
 * at an unanswered gate, as `stopped-by-operator`, or as a failure, the
 * outcome is written as a note on a `gate-exit/<UTC stamp>` branch created in
 * a temporary worktree outside the repository, pushed (never forced), and a
 * PR/MR is opened when `gh`/`glab` is on PATH and authenticated. The
 * invocation-root working tree is never written except for the gitignored
 * marker. The landing never answers a gate.
 *
 * Identifiers follow ADR 2026-10-08_countdown-coming-home-generic-lane point 7.
 */

export const GATE_EXIT_BRANCH_PREFIX = "gate-exit/";
/** Gitignored marker in the invocation root (KIT_OWNED_IGNORE_PATTERNS). */
export const GATE_EXIT_MARKER_RELPATH = ".cursor/context/gate-exit.json";
/** Tracked path on the gate-exit branch that holds one note per stamp. */
export const GATE_EXIT_NOTE_DIR = ".cursor/gate-exit";
export const GATE_EXIT_DEFAULT_BASE = "staging";
export const GATE_EXIT_MARKER_SCHEMA = 1;
/** `YYYYMMDDTHHMMSSZ` (UTC). Validated on every read-back. */
export const GATE_EXIT_STAMP_RE = /^\d{8}T\d{6}Z$/;
/** Longest run summary carried by the note (characters, after redaction). */
export const GATE_EXIT_SUMMARY_MAX_CHARS = 8 * 1024;
/**
 * Longest review findings carried by the note (`review` trigger). The note is
 * also the PR/MR body, so this stays well under the forges' body limits.
 */
export const GATE_EXIT_FINDINGS_MAX_CHARS = 32 * 1024;

/** Branch names the landing accepts as a base (no leading dash, no `..`). */
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Fallback identity for a landing on a box with no git identity (timers, CI). */
const FALLBACK_GIT_IDENTITY = [
  "-c",
  "user.name=agent-kit",
  "-c",
  "user.email=agent-kit@noreply.invalid",
];

/** Shared help text for `--land-on-gate` (run, run-plan, run-plan-all). */
export const LAND_ON_GATE_DESCRIPTION =
  "Gate exit: when the run stops at an unanswered gate, is stopped by the operator, or fails, push the outcome note to a gate-exit/<UTC stamp> branch from a temporary worktree and open a PR/MR when gh/glab is authenticated (root tree untouched; off by default)";

/**
 * `review` is the review job's normal end (`countdown --job review`): its
 * findings land as a ticket even though no gate was reached.
 */
export type GateExitTrigger = "gate" | "stopped-by-operator" | "failure" | "review";

/** UTC stamp, second resolution: `20261014T093000Z`. */
export function gateExitStamp(now: Date = new Date()): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

export function isGateExitStamp(value: string): boolean {
  return GATE_EXIT_STAMP_RE.test(value);
}

export function gateExitBranch(stamp: string): string {
  if (!isGateExitStamp(stamp)) throw new Error(`invalid gate-exit stamp: ${stamp}`);
  return `${GATE_EXIT_BRANCH_PREFIX}${stamp}`;
}

export function isSafeBaseRef(ref: string): boolean {
  return (
    SAFE_REF_RE.test(ref) && !ref.includes("..") && !ref.endsWith("/") && !ref.endsWith(".lock")
  );
}

/**
 * Which run endings land. A gate stop (any `HitlStop`: `--no-hitl`, no TTY,
 * no relay, reserved gate, driver stop) is a gate, or `stopped-by-operator`
 * when the stop record says so; a failed tick or dispatch is a failure.
 * Plan exhausted, tick budget, stop file and vendor usage limits do not land
 * (the plan is unchanged and the next run resumes it).
 */
export function classifyGateExit(input: {
  stop?: HitlStop;
  failed: boolean;
}): GateExitTrigger | null {
  if (input.stop) {
    return input.stop.message.startsWith("stopped-by-operator") ? "stopped-by-operator" : "gate";
  }
  return input.failed ? "failure" : null;
}

export interface GateExitOutcome {
  trigger: GateExitTrigger;
  exitCode: number;
  /** One-line end reason (the stop record or the failure line). */
  reason: string;
  /** Ask id from the stop record; absent on a failure. */
  askId?: string;
  /** What ran, e.g. `run-plan` or `run backlog-add`. */
  command: string;
  backend: string;
  plan?: string;
  ticks?: number;
  pending?: number | null;
  /** Absolute path of the (already redacted) run log. */
  logPath?: string;
  /** Last turn text, when the run kept one. */
  summary?: string;
  /** The last turn's texts (result + assistant blocks); the gate line is read from here first. */
  gateText?: string;
}

export interface GateExitEntry {
  stamp: string;
  openedAt: string;
  trigger: GateExitTrigger;
  askId: string | null;
  labels: string[];
  base: string;
  branch: string | null;
  pushed: boolean;
  url: string | null;
}

export interface GateExitMarker {
  schema: typeof GATE_EXIT_MARKER_SCHEMA;
  pending: GateExitEntry[];
  /** `skipped <UTC stamp>` records appended by the launcher (Countdown). */
  skipped: string[];
}

export function gateExitMarkerPath(root: string): string {
  return path.join(root, GATE_EXIT_MARKER_RELPATH);
}

export type MarkerRead =
  | { kind: "absent" }
  | { kind: "ok"; marker: GateExitMarker }
  | { kind: "invalid"; detail: string };

export async function readGateExitMarker(root: string): Promise<MarkerRead> {
  let raw: string;
  try {
    raw = await readFile(gateExitMarkerPath(root), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "invalid", detail: String(err) };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GateExitMarker>;
    if (
      parsed?.schema !== GATE_EXIT_MARKER_SCHEMA ||
      !Array.isArray(parsed.pending) ||
      !Array.isArray(parsed.skipped)
    ) {
      return { kind: "invalid", detail: "unexpected marker shape" };
    }
    const pending = parsed.pending.filter(
      (e): e is GateExitEntry => typeof e?.stamp === "string" && isGateExitStamp(e.stamp),
    );
    return {
      kind: "ok",
      marker: { schema: GATE_EXIT_MARKER_SCHEMA, pending, skipped: parsed.skipped.map(String) },
    };
  } catch (err) {
    return { kind: "invalid", detail: String(err) };
  }
}

/** Atomic write (temp file + rename) of the marker under `.cursor/context/`. */
export async function writeGateExitMarker(root: string, marker: GateExitMarker): Promise<void> {
  const file = gateExitMarkerPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/**
 * Redaction for every line the landing writes: backend secrets plus forge
 * tokens. Same set as every backend tee (`claudeRedactions` covers
 * `FORGE_SECRET_ENV` with derived forms), so a note, PR body, marker label or
 * run log never differ in what they elide.
 */
export function gateExitRedactions(env: NodeJS.ProcessEnv): RedactionEntry[] {
  return claudeRedactions(env);
}

export interface GateExitNoteInput {
  stamp: string;
  outcome: GateExitOutcome;
  labels: string[];
  base: string;
  logRel: string | null;
  dirtyPaths: number;
}

/** First line of the note; Ground Control reads it as the ticket headline. */
export function gateExitHeadline(stamp: string, outcome: GateExitOutcome): string {
  const what =
    outcome.trigger === "failure"
      ? "run failed"
      : outcome.trigger === "review"
        ? "review findings"
        : outcome.trigger === "stopped-by-operator"
          ? `stopped by operator at gate \`${outcome.askId ?? "none"}\``
          : `unanswered gate \`${outcome.askId ?? "none"}\``;
  return `# Gate exit ${stamp}: ${what}`;
}

export function buildGateExitNote(input: GateExitNoteInput): string {
  const { outcome } = input;
  const gateLine =
    outcome.askId && input.labels.length > 0
      ? `\`HITL_GATE: ${outcome.askId} | ${input.labels.join(" | ")}\``
      : "(no `HITL_GATE:` line recorded)";
  const plan =
    outcome.plan !== undefined
      ? `${outcome.plan} (ticks: ${outcome.ticks ?? 0}, pending to-dos: ${outcome.pending ?? "unknown"})`
      : "(none)";
  const review = outcome.trigger === "review";
  const lines = [
    gateExitHeadline(input.stamp, outcome),
    "",
    review
      ? "- **Provenance:** agent-inferred. Written by `agent-kit` at the end of a headless review-only run (no tools, no edits, no commits to the reviewed branches); the findings below are the reviewer's output, not an operator decision."
      : "- **Provenance:** agent-inferred. Written by `agent-kit` at the end of a headless run; no operator reply exists for this gate and none was inferred.",
    `- **Trigger:** ${outcome.trigger}`,
    `- **Ask id:** ${outcome.askId ? `\`${outcome.askId}\`` : "(none)"}`,
    `- **Gate:** ${gateLine}`,
    `- **Stop:** ${outcome.reason}`,
    `- **Exit code:** ${outcome.exitCode}`,
    `- **Command:** \`agent-kit ${outcome.command}\` (backend ${outcome.backend})`,
    `- **Plan:** ${plan}`,
    `- **Log:** ${input.logRel ? `\`${input.logRel}\` (on the machine that ran; not pushed)` : "(none)"}`,
    `- **Root tree:** ${input.dirtyPaths > 0 ? `dirty (${input.dirtyPaths} path(s)), reported and not cleaned` : "clean"}`,
    `- **Base:** \`${input.base}\``,
    "",
    review
      ? "Next: read the findings, act on any of them in a live session, then accept or discard this ticket (`agent-kit ground-control`). Never `/git-prod` from a headless run."
      : "Next: answer the gate in a live session (`/continue-plan` or `/run-plan`), then accept or discard this ticket (`agent-kit ground-control`). Never `/git-prod` from a headless run.",
  ];
  const summary = outcome.summary?.trim();
  if (summary) {
    const max = review ? GATE_EXIT_FINDINGS_MAX_CHARS : GATE_EXIT_SUMMARY_MAX_CHARS;
    const what = review ? "findings" : "summary";
    const capped =
      summary.length > max
        ? `${summary.slice(0, max)}\n\n(${what} truncated at ${max} characters)`
        : summary;
    lines.push(
      "",
      review ? "## Findings" : "## Run summary",
      "",
      "```text",
      capped.replaceAll("```", "'''"),
      "```",
    );
  }
  return `${lines.join("\n")}\n`;
}

function collectStrings(value: unknown, out: string[], depth: number): void {
  if (depth > 8) return;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
  }
}

/** Log text with every NDJSON line's strings decoded (stream-json escapes newlines). */
export function decodeRunLog(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    out.push(line);
    if (!line.startsWith("{")) continue;
    try {
      collectStrings(JSON.parse(line), out, 0);
    } catch {
      // not JSON: kept as is
    }
  }
  return out.join("\n");
}

/** Labels of the last `HITL_GATE:` line for `askId`: the turn text first, then the run log. */
export async function findGateLabels(
  askId: string,
  sources: { gateText?: string; logPath?: string },
): Promise<string[]> {
  const fromText = sources.gateText ? findHitlGateInText(sources.gateText) : null;
  if (fromText?.askId === askId) return fromText.labels;
  if (!sources.logPath) return [];
  try {
    const gate = findHitlGateInText(decodeRunLog(await readFile(sources.logPath, "utf8")));
    return gate?.askId === askId ? gate.labels : [];
  } catch {
    return [];
  }
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ExecFn = (
  bin: string,
  args: readonly string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

/** `execFile` with an argument array (never a shell); a failure is a non-zero code. */
export const defaultExec: ExecFn = (bin, args, opts) =>
  new Promise((resolve) => {
    execFile(
      bin,
      [...args],
      {
        cwd: opts.cwd,
        env: { ...(opts.env ?? process.env), GIT_TERMINAL_PROMPT: "0" },
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 120_000,
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        resolve({
          code,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? err?.message ?? ""),
        });
      },
    );
  });

/** Git bound to one working directory (preflight and triage helpers). */
export type GitFn = (args: readonly string[]) => Promise<ExecResult>;

export interface GateExitRefs {
  /** Base branch name: `staging` by default, else the remote default branch. */
  base: string;
  /** Ref the merged checks run against. */
  baseRef: string;
  /** Ref prefix the gate-exit branches live under. */
  scope: string;
}

/**
 * Base ref and branch scope for gate-exit checks, with the landing's
 * fallbacks: `origin/<base>`, else the remote default branch; without an
 * `origin`, the local base, else `HEAD`.
 */
export async function resolveGateExitRefs(
  git: GitFn,
  hasOrigin: boolean,
  requestedBase: string = GATE_EXIT_DEFAULT_BASE,
): Promise<GateExitRefs> {
  let base = isSafeBaseRef(requestedBase) ? requestedBase : GATE_EXIT_DEFAULT_BASE;
  const verify = (ref: string) => git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (hasOrigin) {
    const scope = `refs/remotes/origin/${GATE_EXIT_BRANCH_PREFIX}`;
    if ((await verify(`refs/remotes/origin/${base}`)).code === 0) {
      return { base, baseRef: `refs/remotes/origin/${base}`, scope };
    }
    const head = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    const fallback = head.stdout.trim().replace(/^origin\//, "");
    if (head.code === 0 && isSafeBaseRef(fallback)) {
      base = fallback;
      return { base, baseRef: `refs/remotes/origin/${fallback}`, scope };
    }
    return { base, baseRef: "HEAD", scope };
  }
  const scope = `refs/heads/${GATE_EXIT_BRANCH_PREFIX}`;
  if ((await verify(`refs/heads/${base}`)).code === 0) {
    return { base, baseRef: `refs/heads/${base}`, scope };
  }
  return { base, baseRef: "HEAD", scope };
}

/** Gate-exit branches under `refs.scope` (short names), optionally only those not merged into `refs.baseRef`. */
export async function listGateExitBranches(
  git: GitFn,
  refs: GateExitRefs,
  opts: { unmergedOnly?: boolean } = {},
): Promise<{ ok: boolean; branches: string[] }> {
  const listed = await git([
    "for-each-ref",
    "--format=%(refname:short)",
    ...(opts.unmergedOnly ? [`--no-merged=${refs.baseRef}`] : []),
    refs.scope,
  ]);
  return {
    ok: listed.code === 0,
    branches: listed.stdout.split("\n").filter((l) => l.trim()),
  };
}

/** Tracked path of one note on its gate-exit branch. */
export function gateExitNotePath(stamp: string): string {
  if (!isGateExitStamp(stamp)) throw new Error(`invalid gate-exit stamp: ${stamp}`);
  return `${GATE_EXIT_NOTE_DIR}/${stamp}.md`;
}

export interface LandGateExitOptions {
  root: string;
  outcome: GateExitOutcome;
  /** Base branch for the worktree and the PR/MR (default `staging`). */
  base?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  exec?: ExecFn;
  which?: (bin: string) => Promise<string | null>;
  /** Parent of the temporary worktree directory (default: the OS temp dir). */
  tmpRoot?: string;
  log?: (line: string) => void;
}

export interface LandGateExitResult {
  stamp: string;
  branch: string | null;
  committed: boolean;
  pushed: boolean;
  url: string | null;
  markerWritten: boolean;
  /** The note as written (redacted). */
  note: string;
}

/** True when `child` resolves outside `parent` (temporary worktrees and review workspaces). */
export function isOutside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel.startsWith("..") || path.isAbsolute(rel);
}

/**
 * Land one gate exit. Never throws for git/forge failures: each step reports
 * through `log` and the result says how far it got. The marker is written
 * whether or not the branch reached the remote, so a launcher never fires
 * into a waiting gate.
 */
export async function landGateExit(opts: LandGateExitOptions): Promise<LandGateExitResult> {
  const env = opts.env ?? process.env;
  const exec = opts.exec ?? defaultExec;
  const which = opts.which ?? ((bin: string) => findOnPath(bin, { env }));
  const redactions = gateExitRedactions(env);
  const red = (text: string) => redactSecrets(text, redactions);
  const log = (line: string) => opts.log?.(red(`gate-exit: ${line}`));
  const now = opts.now ?? new Date();
  const stamp = gateExitStamp(now);
  const branch = gateExitBranch(stamp);
  const outcome = opts.outcome;
  const requestedBase = opts.base ?? GATE_EXIT_DEFAULT_BASE;
  const result: LandGateExitResult = {
    stamp,
    branch: null,
    committed: false,
    pushed: false,
    url: null,
    markerWritten: false,
    note: "",
  };

  const git = (args: readonly string[], cwd: string) => exec("git", args, { cwd, env });

  // Ask id and labels: the last `HITL_GATE:` line whose id matches the stop
  // record, from the turn text or the (redacted) run log. The relay is not touched.
  const labels = outcome.askId
    ? await findGateLabels(outcome.askId, { gateText: outcome.gateText, logPath: outcome.logPath })
    : [];

  const top = await git(["rev-parse", "--show-toplevel"], opts.root);
  const repo = top.code === 0 ? top.stdout.trim() : null;
  let dirtyPaths = 0;
  if (repo) {
    const status = await git(["status", "--porcelain"], repo);
    dirtyPaths = status.stdout.split("\n").filter((l) => l.trim()).length;
    if (dirtyPaths > 0) {
      log(`root tree is dirty (${dirtyPaths} path(s)); reported, not cleaned`);
    }
  }

  let base = isSafeBaseRef(requestedBase) ? requestedBase : GATE_EXIT_DEFAULT_BASE;
  const logRel = outcome.logPath ? path.relative(opts.root, outcome.logPath) : null;
  const buildNote = () =>
    red(buildGateExitNote({ stamp, outcome, labels, base, logRel, dirtyPaths }));

  const writeMarker = async () => {
    const entry: GateExitEntry = {
      stamp,
      openedAt: now.toISOString(),
      trigger: outcome.trigger,
      askId: outcome.askId ?? null,
      labels: labels.map(red),
      base,
      branch: result.branch,
      pushed: result.pushed,
      url: result.url,
    };
    const current = await readGateExitMarker(opts.root);
    if (current.kind === "invalid") {
      log(
        `${GATE_EXIT_MARKER_RELPATH} is unreadable (${current.detail}); left as is, entry ${stamp} not recorded`,
      );
      return;
    }
    const marker: GateExitMarker =
      current.kind === "ok"
        ? { ...current.marker, pending: [...current.marker.pending, entry] }
        : { schema: GATE_EXIT_MARKER_SCHEMA, pending: [entry], skipped: [] };
    // Before the write: when the repository's ignore rules miss the marker,
    // a clone-local exclude keeps it (and its triaged leftovers) from making
    // the next Countdown fire refuse a dirty tree.
    if (
      repo &&
      !(await ensurePathIgnored(
        (args) => git(args, opts.root),
        opts.root,
        GATE_EXIT_MARKER_RELPATH,
      ))
    ) {
      log(
        `${GATE_EXIT_MARKER_RELPATH} is not gitignored here; add it to .gitignore (agent-kit update adds it)`,
      );
    }
    try {
      await writeGateExitMarker(opts.root, marker);
      result.markerWritten = true;
    } catch (err) {
      log(`could not write ${GATE_EXIT_MARKER_RELPATH}: ${String(err)}`);
      return;
    }
  };

  if (!repo) {
    log("not a git repository; no branch landed");
    result.note = buildNote();
    await writeMarker();
    return result;
  }

  // Start point: origin/<base> after a fetch; else the remote default branch;
  // without an `origin`, the local base (or HEAD) and no push.
  const origin = await git(["remote", "get-url", "origin"], repo);
  const hasOrigin = origin.code === 0 && origin.stdout.trim().length > 0;
  const originUrl = hasOrigin ? origin.stdout.trim() : "";
  let startRef: string | null = null;
  if (hasOrigin) {
    const fetched = await git(["fetch", "--quiet", "origin", base], repo);
    if (fetched.code !== 0)
      log(`fetch origin ${base} failed: ${fetched.stderr.trim().split("\n")[0] ?? ""}`);
    const verify = await git(
      ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}^{commit}`],
      repo,
    );
    if (verify.code === 0) {
      startRef = `refs/remotes/origin/${base}`;
    } else {
      const head = await git(
        ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        repo,
      );
      const fallback = head.stdout.trim().replace(/^origin\//, "");
      if (head.code === 0 && isSafeBaseRef(fallback)) {
        log(`origin/${base} not found; using the remote default branch ${fallback}`);
        base = fallback;
        startRef = `refs/remotes/origin/${fallback}`;
      }
    }
  } else {
    log("no `origin` remote: the branch stays local, nothing is pushed");
    const local = await git(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${base}^{commit}`],
      repo,
    );
    startRef = local.code === 0 ? `refs/heads/${base}` : "HEAD";
  }

  result.note = buildNote();
  if (!startRef) {
    log(`no base to branch from (origin/${base} missing); note not landed`);
    await writeMarker();
    return result;
  }

  let tmp: string | null = null;
  let wt: string | null = null;
  try {
    tmp = await mkdtemp(path.join(opts.tmpRoot ?? tmpdir(), "agent-kit-gate-exit-"));
    if (!isOutside(repo, tmp)) {
      log("temporary directory resolves inside the repository; refusing to land there");
      return result;
    }
    wt = path.join(tmp, "wt");
    const added = await git(["worktree", "add", "--detach", "--quiet", wt, startRef], repo);
    if (added.code !== 0) {
      wt = null;
      log(`worktree add failed: ${added.stderr.trim().split("\n")[0] ?? ""}`);
      return result;
    }
    const noteRel = gateExitNotePath(stamp);
    await mkdir(path.join(wt, GATE_EXIT_NOTE_DIR), { recursive: true });
    await writeFile(path.join(wt, noteRel), result.note, "utf8");
    const add = await git(["add", "-f", "--", noteRel], wt);
    if (add.code !== 0) {
      log(`git add failed: ${add.stderr.trim().split("\n")[0] ?? ""}`);
      return result;
    }
    const email = await git(["config", "user.email"], wt);
    const identity = email.code === 0 && email.stdout.trim() ? [] : FALLBACK_GIT_IDENTITY;
    const subject = `docs(gate-exit): record the ${outcome.trigger} of ${stamp}`;
    const body = `Ask id: ${outcome.askId ?? "none"}. Provenance: agent-inferred.`;
    const commit = await git([...identity, "commit", "--quiet", "-m", subject, "-m", body], wt);
    if (commit.code !== 0) {
      log(`commit failed: ${commit.stderr.trim().split("\n")[0] ?? ""}`);
      return result;
    }
    result.committed = true;

    if (hasOrigin) {
      const push = await git(["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`], wt);
      if (push.code === 0) {
        result.pushed = true;
        result.branch = branch;
        log(`pushed ${branch}`);
      } else {
        log(`push failed: ${push.stderr.trim().split("\n")[0] ?? ""}`);
      }
    }
    if (!result.pushed) {
      // Keep the commit reachable: a local branch ref (the root tree is not touched).
      const keep = await git(["branch", branch, "HEAD"], wt);
      if (keep.code === 0) {
        result.branch = branch;
        log(`branch ${branch} kept locally; push it with: git push origin ${branch}`);
      }
    }

    if (result.pushed) {
      result.url = await openReview({
        branch,
        base,
        title: `${outcome.trigger === "failure" ? "Gate exit: run failed" : outcome.trigger === "review" ? "Gate exit: review findings" : `Gate exit: ${outcome.askId ?? "gate"}`} (${stamp})`,
        body: result.note,
        cwd: wt,
        tmp,
        originUrl,
        exec,
        which,
        env,
        log,
      });
    }
  } catch (err) {
    log(`landing failed: ${String(err)}`);
  } finally {
    if (wt) await git(["worktree", "remove", "--force", wt], repo);
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    await git(["worktree", "prune"], repo);
    await writeMarker();
  }
  return result;
}

interface OpenReviewInput {
  branch: string;
  base: string;
  title: string;
  body: string;
  cwd: string;
  tmp: string;
  originUrl: string;
  exec: ExecFn;
  which: (bin: string) => Promise<string | null>;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}

function lastUrl(text: string): string | null {
  const urls = text.match(/https?:\/\/\S+/g);
  return urls?.at(-1) ?? null;
}

export type ForgeId = "gh" | "glab";

/**
 * The first forge CLI on PATH that is authenticated, `glab` first when the
 * origin URL names GitLab. Each unauthenticated binary is reported through `log`.
 */
export async function findAuthenticatedForge(input: {
  originUrl: string;
  cwd: string;
  exec: ExecFn;
  which: (bin: string) => Promise<string | null>;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}): Promise<{ forge: ForgeId; bin: string } | null> {
  const forges: ForgeId[] = /gitlab/i.test(input.originUrl) ? ["glab", "gh"] : ["gh", "glab"];
  for (const forge of forges) {
    const bin = await input.which(forge);
    if (!bin) continue;
    const auth = await input.exec(bin, ["auth", "status"], { cwd: input.cwd, env: input.env });
    if (auth.code !== 0) {
      input.log(`${forge} is not authenticated; skipping the ${forge === "gh" ? "PR" : "MR"}`);
      continue;
    }
    return { forge, bin };
  }
  return null;
}

/** PR (`gh`) or MR (`glab`) when the binary is on PATH and authenticated; else the manual command. */
async function openReview(input: OpenReviewInput): Promise<string | null> {
  const found = await findAuthenticatedForge(input);
  if (found) {
    const { forge, bin } = found;
    let created: ExecResult;
    if (forge === "gh") {
      const bodyFile = path.join(input.tmp, "pr-body.md");
      await writeFile(bodyFile, input.body, "utf8");
      created = await input.exec(
        bin,
        [
          "pr",
          "create",
          "--base",
          input.base,
          "--head",
          input.branch,
          "--title",
          input.title,
          "--body-file",
          bodyFile,
        ],
        { cwd: input.cwd, env: input.env },
      );
    } else {
      created = await input.exec(
        bin,
        [
          "mr",
          "create",
          "--source-branch",
          input.branch,
          "--target-branch",
          input.base,
          "--title",
          input.title,
          "--description",
          input.body,
          "--yes",
        ],
        { cwd: input.cwd, env: input.env },
      );
    }
    if (created.code === 0) {
      const url = lastUrl(created.stdout);
      input.log(`${forge === "gh" ? "PR" : "MR"} opened${url ? `: ${url}` : ""}`);
      return url;
    }
    input.log(`${forge} could not open the review: ${created.stderr.trim().split("\n")[0] ?? ""}`);
    return null;
  }
  input.log(
    `no authenticated gh/glab; open the review by hand: gh pr create --base ${input.base} --head ${input.branch} (or glab mr create --source-branch ${input.branch} --target-branch ${input.base})`,
  );
  return null;
}
