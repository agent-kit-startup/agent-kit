/**
 * Pending operator tickets for Mission Control (ADR 2026-10-08
 * countdown-coming-home-generic-lane point 3: "Mission Control shows pending
 * tickets read-only in the Flight Log").
 *
 * Mirrors the read half of `groundControlStatus`
 * (packages/cli/src/commands/ground-control.ts) on the same contract: the
 * gitignored marker `.cursor/context/gate-exit.json`, `gate-exit/<UTC stamp>`
 * branches, the note at `.cursor/gate-exit/<stamp>.md` (first line = ticket
 * headline), and the same merged test (branch tip is an ancestor of the base,
 * or the base holds the note blob byte for byte). A parity test pins this file
 * to the CLI (packages/cli/src/dashboard/gate-exit-tickets.test.ts).
 *
 * Unlike `agent-kit ground-control status` this never fetches: the dashboard
 * re-snapshots on every refresh, so it shows the last fetched state. It never
 * writes, never throws, and costs one `git for-each-ref` when there is no
 * marker and no gate-exit branch.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const GATE_EXIT_BRANCH_PREFIX = "gate-exit/";
export const GATE_EXIT_MARKER_RELPATH = ".cursor/context/gate-exit.json";
export const GATE_EXIT_NOTE_DIR = ".cursor/gate-exit";
export const GATE_EXIT_DEFAULT_BASE = "staging";
export const GATE_EXIT_STAMP_RE = /^\d{8}T\d{6}Z$/;
export const MAX_GATE_EXIT_TICKETS = 10;
export const MAX_GATE_EXIT_SKIPPED = 5;
export const MAX_GATE_EXIT_TEXT = 300;

const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const TRIGGERS = new Set(["gate", "stopped-by-operator", "failure", "review"]);

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function cap(text, max = MAX_GATE_EXIT_TEXT) {
  const s = String(text ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function isSafeBaseRef(ref) {
  return (
    typeof ref === "string" &&
    SAFE_REF_RE.test(ref) &&
    !ref.includes("..") &&
    !ref.endsWith("/") &&
    !ref.endsWith(".lock")
  );
}

/** Synchronous git runner: `{ code, stdout }`, never throws. */
export function makeGitRunner(root, timeoutMs = 5000) {
  return (args) => {
    try {
      const stdout = execFileSync("git", args, {
        cwd: root,
        encoding: "utf-8",
        timeout: timeoutMs,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return { code: 0, stdout };
    } catch (err) {
      const status = isRecord(err) && typeof err.status === "number" ? err.status : 1;
      return { code: status || 1, stdout: "" };
    }
  };
}

/** Marker read with the CLI's validation (`readGateExitMarker`). */
export function readGateExitMarkerSync(root) {
  let raw;
  try {
    raw = readFileSync(join(root, GATE_EXIT_MARKER_RELPATH), "utf8");
  } catch (err) {
    if (isRecord(err) && err.code === "ENOENT") return { kind: "absent" };
    return { kind: "invalid" };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schema !== 1) return { kind: "invalid" };
    if (!Array.isArray(parsed.pending) || !Array.isArray(parsed.skipped)) {
      return { kind: "invalid" };
    }
    const pending = parsed.pending.filter(
      (e) => isRecord(e) && typeof e.stamp === "string" && GATE_EXIT_STAMP_RE.test(e.stamp),
    );
    return { kind: "ok", pending, skipped: parsed.skipped.map(String) };
  } catch {
    return { kind: "invalid" };
  }
}

/** Base ref chain of `resolveGateExitRefs`: origin/<base>, origin/HEAD, local <base>, HEAD. */
function resolveBaseRef(git, hasOrigin, requested) {
  let base = isSafeBaseRef(requested) ? requested : GATE_EXIT_DEFAULT_BASE;
  const verify = (ref) => git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).code === 0;
  if (hasOrigin) {
    if (verify(`refs/remotes/origin/${base}`))
      return { base, baseRef: `refs/remotes/origin/${base}` };
    const head = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    const fallback = head.stdout.trim().replace(/^origin\//, "");
    if (head.code === 0 && isSafeBaseRef(fallback)) {
      base = fallback;
      return { base, baseRef: `refs/remotes/origin/${fallback}` };
    }
    return { base, baseRef: "HEAD" };
  }
  if (verify(`refs/heads/${base}`)) return { base, baseRef: `refs/heads/${base}` };
  return { base, baseRef: "HEAD" };
}

function blobId(git, spec) {
  const r = git(["rev-parse", "--verify", "--quiet", spec]);
  const id = r.stdout.trim();
  return r.code === 0 && id ? id : null;
}

function notePath(stamp) {
  return `${GATE_EXIT_NOTE_DIR}/${stamp}.md`;
}

function isMerged(git, branchRef, baseRef, stamp) {
  if (git(["merge-base", "--is-ancestor", branchRef, baseRef]).code === 0) return true;
  const onBranch = blobId(git, `${branchRef}:${notePath(stamp)}`);
  return onBranch !== null && onBranch === blobId(git, `${baseRef}:${notePath(stamp)}`);
}

function readHeadline(git, ref, stamp) {
  const shown = git(["show", `${ref}:${notePath(stamp)}`]);
  if (shown.code !== 0) return null;
  const first = shown.stdout.split("\n")[0]?.trim() ?? "";
  return first || null;
}

function stampOfBranch(short) {
  const i = short.lastIndexOf(GATE_EXIT_BRANCH_PREFIX);
  if (i < 0) return null;
  const stamp = short.slice(i + GATE_EXIT_BRANCH_PREFIX.length);
  return GATE_EXIT_STAMP_RE.test(stamp) ? stamp : null;
}

function shortRef(ref) {
  return ref.replace(/^refs\/remotes\//, "").replace(/^refs\/heads\//, "");
}

function emptyResult(marker, base = GATE_EXIT_DEFAULT_BASE) {
  return { marker, base, tickets: [], skipped: [], truncated: false };
}

/**
 * Pending operator tickets: marker entries plus unmerged gate-exit branches
 * (remote-tracking and local) with no entry. A merged branch with no entry is
 * history and is hidden, as in `ground-control status`.
 * @param {string} root
 * @param {{ git?: (args: string[]) => { code: number, stdout: string }, redact?: (s: string) => string, max?: number }} [opts]
 */
export function collectGateExitTickets(root, opts = {}) {
  const redact = typeof opts.redact === "function" ? opts.redact : (s) => s;
  const max = Number.isInteger(opts.max) && opts.max > 0 ? opts.max : MAX_GATE_EXIT_TICKETS;
  const git = opts.git ?? makeGitRunner(root);
  const marker = readGateExitMarkerSync(root);
  const entries = marker.kind === "ok" ? marker.pending : [];
  const skipped =
    marker.kind === "ok" ? marker.skipped.slice(-MAX_GATE_EXIT_SKIPPED).map((s) => cap(s, 80)) : [];

  const listed = git([
    "for-each-ref",
    "--format=%(refname)",
    `refs/remotes/origin/${GATE_EXIT_BRANCH_PREFIX}`,
    `refs/heads/${GATE_EXIT_BRANCH_PREFIX}`,
  ]);
  const branchRefs = listed.code === 0 ? listed.stdout.split("\n").filter((l) => l.trim()) : [];
  if (entries.length === 0 && branchRefs.length === 0) {
    return { ...emptyResult(marker.kind), skipped };
  }

  const hasOrigin = git(["remote", "get-url", "origin"]).code === 0;
  const defaultRefs = resolveBaseRef(git, hasOrigin, GATE_EXIT_DEFAULT_BASE);
  // Same scopes as the CLI: with an origin, remote-tracking + local heads; without, local heads.
  const remoteScope = `refs/remotes/origin/${GATE_EXIT_BRANCH_PREFIX}`;
  const present = new Set(branchRefs);
  const stamps = new Set(entries.map((e) => e.stamp));
  for (const ref of branchRefs) {
    if (!hasOrigin && ref.startsWith(remoteScope)) continue;
    const stamp = stampOfBranch(shortRef(ref));
    if (stamp) stamps.add(stamp);
  }

  const tickets = [];
  const ordered = [...stamps].sort();
  for (const stamp of ordered) {
    const entry = entries.find((e) => e.stamp === stamp);
    const remote = `refs/remotes/origin/${GATE_EXIT_BRANCH_PREFIX}${stamp}`;
    const local = `refs/heads/${GATE_EXIT_BRANCH_PREFIX}${stamp}`;
    const branchRef = hasOrigin && present.has(remote) ? remote : present.has(local) ? local : null;
    const refs =
      entry && isSafeBaseRef(entry.base) && entry.base !== defaultRefs.base
        ? resolveBaseRef(git, hasOrigin, entry.base)
        : defaultRefs;
    let branchState = "none";
    if (branchRef) {
      branchState = isMerged(git, branchRef, refs.baseRef, stamp) ? "merged" : "unmerged";
    }
    if (!entry && branchState === "merged") continue;
    const headline =
      (branchRef ? readHeadline(git, branchRef, stamp) : null) ??
      readHeadline(git, refs.baseRef, stamp);
    const url = typeof entry?.url === "string" && /^https?:\/\//.test(entry.url) ? entry.url : null;
    tickets.push({
      stamp,
      headline: headline ? cap(redact(headline)) : null,
      askId: typeof entry?.askId === "string" ? cap(entry.askId, 64) : null,
      labels: Array.isArray(entry?.labels)
        ? entry.labels.slice(0, 8).map((l) => cap(redact(String(l)), 80))
        : [],
      trigger: TRIGGERS.has(entry?.trigger) ? entry.trigger : null,
      openedAt: typeof entry?.openedAt === "string" ? cap(entry.openedAt, 40) : null,
      url: url ? cap(redact(url), 300) : null,
      branch: branchRef ? shortRef(branchRef) : null,
      branchState,
      inMarker: Boolean(entry),
    });
  }

  return {
    marker: marker.kind,
    base: defaultRefs.base,
    tickets: tickets.slice(0, max),
    skipped,
    truncated: tickets.length > max,
  };
}
