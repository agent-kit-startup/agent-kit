/**
 * Live agent roster for one workspace (ADR 2026-07-26_run-plan-all-queue-contract,
 * Amend 2026-11-16 agent check-in, point 5): who else is live before a session,
 * an Ask or a plan-state write.
 *
 * Read-only and composed from existing sources only: the queue lease
 * (`inspectQueueLease`), workspace agent processes (`ps` plus `/proc/<pid>/cwd`),
 * `git worktree list`, Claude transcripts by modification time and detached
 * `agent-kit-audit-*` PTY sessions. No new file, store or event type.
 *
 * Every source fails open: a missing `/proc`, `ps`, `git`, `tmux` or `screen`
 * adds a note, never an error. Rows carry derived fields only (kind, role,
 * pid, age, cwd, session id, plan); raw command lines never leave this module,
 * because an argv can hold a prompt or a token and the roster is injected into
 * agent context by the session-start hook.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";
import { claudeProjectDir } from "../../../../dashboard/lib/chat-sessions.mjs";
import { HANDOFF_REL } from "../utils/kit-paths.js";
import { inspectQueueLease, type QueueLease, type QueueLeaseVerdict } from "./queue-lease.js";

/** Ceiling for each shell-out (`ps`, `git worktree list`). */
export const LIVE_ROSTER_COMMAND_TIMEOUT_MS = 2_000;
/** Transcripts modified within this window are listed as recent (not proof of liveness). */
export const LIVE_ROSTER_TRANSCRIPT_WINDOW_MS = 30 * 60_000;
/** At most this many recent transcripts. */
export const LIVE_ROSTER_TRANSCRIPT_CAP = 5;
/** At most this many pids per worktree row. */
export const LIVE_ROSTER_WORKTREE_PID_CAP = 10;

export type LiveAgentKind = "interactive" | "headless" | "driver" | "audit" | "worker";

export interface LiveRosterRow {
  kind: LiveAgentKind;
  /** Short derived label: `claude chat`, `claude -p`, `run-plan-all`, `run-plan`, `countdown`, `run /x`, `cursor-agent`, `audit`. */
  role: string;
  pid: number | null;
  /** Nearest agent ancestor in this roster (workers only). */
  parentPid: number | null;
  sessionId: string | null;
  plan: string | null;
  todo: string | null;
  ageSeconds: number | null;
  cwd: string | null;
  /** The linked worktree that holds `cwd`, when it is not the workspace root. */
  worktree: string | null;
  /** The caller's own process chain (or a process nested under it). */
  self: boolean;
  /** Dispatcher or agent recorded in the queue lease. */
  leaseHolder: boolean;
}

export interface LiveRosterWorktree {
  path: string;
  branch: string | null;
  /** Live processes whose working directory is inside this worktree (any process, not only agents). */
  pids: number[];
  /** True when one of those pids belongs to the caller's own process chain. */
  self: boolean;
}

export interface LiveRosterTranscript {
  id: string;
  modified: string;
  ageSeconds: number;
}

export interface LiveRoster {
  version: 1;
  root: string;
  generatedAt: string;
  lease: QueueLeaseVerdict;
  /** HANDOFF `Plan` and `Queue status` (first word), when present. */
  handoff: { plan: string | null; queueStatus: string | null };
  rows: LiveRosterRow[];
  worktrees: LiveRosterWorktree[];
  /** Recently written Claude transcripts for this folder: a hint, not proof of liveness. */
  transcripts: LiveRosterTranscript[];
  notes: string[];
}

/** One `ps -axo pid=,ppid=,etime=,args=` row. */
export interface PsRow {
  pid: number;
  ppid: number;
  ageSeconds: number | null;
  argv: string[];
}

export interface AuditSessionLike {
  channel: "tmux" | "screen";
  name: string;
  ageSeconds: number;
}

/** Everything the pure composer needs; `collectLiveRoster` gathers it. */
export interface LiveRosterInput {
  root: string;
  now: number;
  /** `ps -axo pid=,ppid=,etime=,args=` output; `null` when ps failed. */
  ps: string | null;
  /** Working directory of a pid; `null` when unknown. */
  cwdOf: (pid: number) => string | null;
  /** Pids whose cwd can be read (Linux `/proc`); `null` off Linux. */
  allPids: number[] | null;
  /** The caller's pid (its ppid chain from the `ps` snapshot is `self`). */
  selfPid: number;
  /** `git worktree list --porcelain` output; `null` when git failed. */
  worktreePorcelain: string | null;
  lease: QueueLeaseVerdict;
  handoffText: string | null;
  transcripts: Array<{ id: string; modifiedMs: number }> | null;
  audit: AuditSessionLike[] | null;
  /** True when `dir` (strictly inside root) is the top of another git repository. */
  isNestedRepo?: (dir: string) => boolean;
  notes?: string[];
}

/** `[[dd-]hh:]mm:ss` (ps etime) to seconds. */
export function parseEtime(text: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text.trim());
  if (!m) return null;
  const [, d, h, mm, ss] = m;
  return Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(mm) * 60 + Number(ss);
}

export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, etime, args] = m;
    const argv = (args ?? "").trim().split(/\s+/).filter(Boolean);
    if (argv.length === 0) continue;
    rows.push({ pid: Number(pid), ppid: Number(ppid), ageSeconds: parseEtime(etime ?? ""), argv });
  }
  return rows;
}

const CLAUDE_HELPER_ARGS = new Set([
  "bg-pty-host",
  "--bg-pty-host",
  "bg-spare",
  "--bg-spare",
  "daemon",
  "--chrome-native-host",
  "mcp",
]);
const AGENT_KIT_SUBCOMMANDS = new Set(["run-plan-all", "run-plan", "countdown", "run"]);
const NODE_BINS = new Set(["node", "node.exe", "bun", "deno"]);

export interface ClassifiedProcess {
  agent: "claude" | "cursor-agent" | "agent-kit";
  kind: "interactive" | "headless" | "driver";
  role: string;
  sessionId: string | null;
  plan: string | null;
  todo: string | null;
}

function flagValue(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === flag) return argv[i + 1] ?? null;
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  }
  return null;
}

function isAgentKitScript(p: string): boolean {
  const norm = p.replace(/\\/g, "/");
  return (
    /(^|\/)agent-kit(\.m?js)?$/.test(norm) ||
    /agent-kit[^/]*\/(?:packages\/cli\/)?(?:dist|bin)\/[^/]+\.m?js$/.test(norm) ||
    /\/colony\/engine\/[^/]+\/dist\/index\.m?js$/.test(norm)
  );
}

/** Agent process or `null` (helpers, dashboards, hooks and every other process). */
export function classifyProcess(argv: string[]): ClassifiedProcess | null {
  const exe = path.basename(argv[0] ?? "");
  if (exe === "claude") {
    if (argv.slice(0, 3).some((a) => CLAUDE_HELPER_ARGS.has(a))) return null;
    const headless = argv.includes("-p") || argv.includes("--print");
    const sessionId = flagValue(argv, "--session-id") ?? flagValue(argv, "--resume");
    return {
      agent: "claude",
      kind: headless ? "headless" : "interactive",
      role: headless ? "claude -p" : "claude chat",
      sessionId: sessionId && /^[0-9a-f-]{8,}$/i.test(sessionId) ? sessionId : null,
      plan: null,
      todo: null,
    };
  }
  const cursorAt = [0, 1].find((i) => path.basename(argv[i] ?? "") === "cursor-agent");
  if (cursorAt !== undefined && (cursorAt === 0 || NODE_BINS.has(exe))) {
    const headless = argv.includes("-p") || argv.includes("--print");
    return {
      agent: "cursor-agent",
      kind: headless ? "headless" : "interactive",
      role: headless ? "cursor-agent -p" : "cursor-agent",
      sessionId: null,
      plan: null,
      todo: null,
    };
  }
  let rest: string[] | null = null;
  if (/^agent-kit(\.m?js)?$/.test(exe)) rest = argv.slice(1);
  else if (NODE_BINS.has(exe)) {
    const script = argv.findIndex((a, i) => i > 0 && !a.startsWith("-"));
    if (script > 0 && isAgentKitScript(argv[script] as string)) rest = argv.slice(script + 1);
  }
  if (!rest) return null;
  const sub = rest.find((a) => !a.startsWith("-"));
  if (!sub || !AGENT_KIT_SUBCOMMANDS.has(sub)) return null;
  const events = flagValue(rest, "--events");
  let role = sub;
  if (sub === "run") {
    const slash = rest[rest.indexOf("run") + 1];
    role = slash && !slash.startsWith("-") ? `run ${slash}` : "run";
  }
  return {
    agent: "agent-kit",
    kind: events === "ndjson" ? "driver" : "headless",
    role,
    sessionId: null,
    plan: flagValue(rest, "--plan"),
    todo: flagValue(rest, "--todo"),
  };
}

/** Parse `git worktree list --porcelain`. */
export function parseWorktreePorcelain(
  text: string,
): Array<{ path: string; branch: string | null }> {
  const out: Array<{ path: string; branch: string | null }> = [];
  let cur: { path: string; branch: string | null } | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), branch: null };
      out.push(cur);
    } else if (cur && line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (cur && line === "detached") {
      cur.branch = "(detached)";
    }
  }
  return out;
}

function inside(dir: string, base: string): boolean {
  return dir === base || dir.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`);
}

/** HANDOFF `Plan` and the first word of `Queue status`. */
export function readHandoffSummary(text: string | null): {
  plan: string | null;
  queueStatus: string | null;
} {
  if (!text) return { plan: null, queueStatus: null };
  const field = (name: string): string | null => {
    const m = new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.+)$`, "m").exec(text);
    return m?.[1]?.trim() ?? null;
  };
  const plan = field("Plan")?.replace(/`/g, "").split(/\s+/)[0]?.replace(/[,;]$/, "");
  const status = field("Queue status")?.split(/[\s(]/)[0]?.replace(/[,;]$/, "");
  return { plan: plan || null, queueStatus: status || null };
}

/** Pure composition of the roster from gathered sources. */
export function composeLiveRoster(input: LiveRosterInput): LiveRoster {
  const root = path.resolve(input.root);
  const notes = [...(input.notes ?? [])];
  const ps = input.ps === null ? [] : parsePs(input.ps);
  if (input.ps === null) notes.push("ps unavailable: no process rows");
  if (input.allPids === null) {
    notes.push("no /proc: working directories unknown, processes scoped by command line only");
  }
  const byPid = new Map(ps.map((r) => [r.pid, r]));

  // The caller's own chain, from the same snapshot.
  const selfChain = new Set<number>();
  for (let p = input.selfPid, guard = 0; p > 1 && guard < 64; guard++) {
    selfChain.add(p);
    const row = byPid.get(p);
    if (!row) break;
    p = row.ppid;
  }

  const worktrees =
    input.worktreePorcelain === null ? null : parseWorktreePorcelain(input.worktreePorcelain);
  if (worktrees === null) notes.push("git worktree list unavailable: worktree rows skipped");
  const linked = (worktrees ?? [])
    .map((w) => ({ ...w, path: path.resolve(w.path) }))
    .filter((w) => w.path !== root)
    .sort((a, b) => b.path.length - a.path.length);
  const worktreeOf = (cwd: string): string | null =>
    linked.find((w) => inside(cwd, w.path))?.path ?? null;

  const nestedCache = new Map<string, boolean>();
  const inNestedRepo = (cwd: string): boolean => {
    if (!input.isNestedRepo || !inside(cwd, root) || cwd === root) return false;
    const cached = nestedCache.get(cwd);
    if (cached !== undefined) return cached;
    let found = false;
    for (let dir = cwd; dir !== root && inside(dir, root); dir = path.dirname(dir)) {
      if (input.isNestedRepo(dir)) {
        found = true;
        break;
      }
    }
    nestedCache.set(cwd, found);
    return found;
  };

  const mentionsRoot = (argv: string[]): boolean =>
    argv.some((a) => a === root || a.startsWith(`${root}/`) || a.startsWith(`--cwd=${root}`));

  type Candidate = { ps: PsRow; c: ClassifiedProcess; cwd: string | null; worktree: string | null };
  const candidates: Candidate[] = [];
  for (const row of ps) {
    const c = classifyProcess(row.argv);
    if (!c) continue;
    const cwd = input.cwdOf(row.pid);
    let worktree: string | null = null;
    let scoped = false;
    if (cwd) {
      worktree = worktreeOf(cwd);
      scoped = worktree !== null || (inside(cwd, root) && !inNestedRepo(cwd));
    } else {
      scoped = mentionsRoot(row.argv);
    }
    if (scoped) candidates.push({ ps: row, c, cwd, worktree });
  }
  const agentPids = new Set(candidates.map((x) => x.ps.pid));
  const nearestAgentAncestor = (pid: number): number | null => {
    let p = byPid.get(pid)?.ppid ?? 0;
    for (let guard = 0; p > 1 && guard < 64; guard++) {
      if (agentPids.has(p)) return p;
      p = byPid.get(p)?.ppid ?? 0;
    }
    return null;
  };

  const lease: QueueLease | null =
    input.lease.kind === "free" ? null : (input.lease.lease as QueueLease | null);
  const leasePids = new Set<number>();
  if (lease && input.lease.kind !== "stale") {
    leasePids.add(lease.dispatcher.pid);
    if (lease.agent) leasePids.add(lease.agent.pid);
  }

  const rows: LiveRosterRow[] = candidates.map(({ ps: r, c, cwd, worktree }) => {
    const parentPid = nearestAgentAncestor(r.pid);
    return {
      kind: parentPid !== null ? "worker" : c.kind,
      role: c.role,
      pid: r.pid,
      parentPid,
      sessionId: c.sessionId ?? (leasePids.has(r.pid) && lease ? lease.session : null),
      plan: c.plan,
      todo: c.todo,
      ageSeconds: r.ageSeconds,
      cwd,
      worktree,
      self: false,
      leaseHolder: leasePids.has(r.pid),
    };
  });
  // Self: own chain, nested under it, or the lease this caller's session owns.
  const selfPids = new Set<number>();
  for (const row of rows) {
    if (row.pid !== null && selfChain.has(row.pid)) selfPids.add(row.pid);
  }
  for (const row of rows) {
    let p = row.parentPid;
    let self = row.pid !== null && selfPids.has(row.pid);
    for (let guard = 0; !self && p !== null && guard < 64; guard++) {
      if (selfPids.has(p)) self = true;
      p = rows.find((x) => x.pid === p)?.parentPid ?? null;
    }
    row.self = self || (input.lease.kind === "own" && row.leaseHolder);
  }

  // A live lease whose holder the process scan did not see (other host, no ps).
  if (lease && (input.lease.kind === "held" || input.lease.kind === "own")) {
    const seen = rows.some((r) => r.pid !== null && leasePids.has(r.pid));
    if (!seen) {
      rows.unshift({
        kind: "headless",
        role: `lease holder (host ${lease.host})`,
        pid: lease.dispatcher.pid,
        parentPid: null,
        sessionId: lease.session,
        plan: null,
        todo: null,
        ageSeconds: Number.isFinite(Date.parse(lease.startedAt))
          ? Math.max(0, Math.floor((input.now - Date.parse(lease.startedAt)) / 1000))
          : null,
        cwd: null,
        worktree: null,
        self: input.lease.kind === "own",
        leaseHolder: true,
      });
    }
  }

  if (input.audit === null) notes.push("tmux/screen listing unavailable: audit rows skipped");
  for (const a of input.audit ?? []) {
    rows.push({
      kind: "audit",
      role: `audit (${a.channel})`,
      pid: null,
      parentPid: null,
      sessionId: a.name,
      plan: null,
      todo: null,
      ageSeconds: a.ageSeconds >= 0 ? a.ageSeconds : null,
      cwd: null,
      worktree: null,
      self: false,
      leaseHolder: false,
    });
  }

  // Lease holders first, then interactive, driver, headless, worker, audit; oldest first within.
  const order: Record<LiveAgentKind, number> = {
    driver: 1,
    headless: 2,
    interactive: 3,
    worker: 4,
    audit: 5,
  };
  rows.sort(
    (a, b) =>
      Number(b.leaseHolder) - Number(a.leaseHolder) ||
      order[a.kind] - order[b.kind] ||
      (b.ageSeconds ?? -1) - (a.ageSeconds ?? -1) ||
      (a.pid ?? 0) - (b.pid ?? 0),
  );

  const worktreeRows: LiveRosterWorktree[] = [];
  if (input.allPids !== null && linked.length > 0) {
    const hits = new Map<string, number[]>();
    for (const pid of input.allPids) {
      const cwd = input.cwdOf(pid);
      if (!cwd) continue;
      const w = worktreeOf(cwd);
      if (!w) continue;
      const list = hits.get(w) ?? [];
      list.push(pid);
      hits.set(w, list);
    }
    for (const w of [...linked].sort((a, b) => a.path.localeCompare(b.path))) {
      const pids = (hits.get(w.path) ?? []).sort((a, b) => a - b);
      if (pids.length === 0) continue;
      worktreeRows.push({
        path: w.path,
        branch: w.branch,
        pids: pids.slice(0, LIVE_ROSTER_WORKTREE_PID_CAP),
        self: pids.some((p) => selfChain.has(p)),
      });
    }
  }

  if (input.transcripts === null) notes.push("no Claude transcript folder for this workspace");
  const transcripts = (input.transcripts ?? [])
    .filter((t) => input.now - t.modifiedMs <= LIVE_ROSTER_TRANSCRIPT_WINDOW_MS)
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
    .slice(0, LIVE_ROSTER_TRANSCRIPT_CAP)
    .map((t) => ({
      id: t.id,
      modified: new Date(t.modifiedMs).toISOString(),
      ageSeconds: Math.max(0, Math.floor((input.now - t.modifiedMs) / 1000)),
    }));

  return {
    version: 1,
    root,
    generatedAt: new Date(input.now).toISOString(),
    lease: input.lease,
    handoff: readHandoffSummary(input.handoffText),
    rows,
    worktrees: worktreeRows,
    transcripts,
    notes,
  };
}

function runBounded(cmd: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<string | null>((resolve) => {
    try {
      execFile(
        cmd,
        args,
        { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
        (err, stdout) => resolve(err ? null : stdout),
      );
    } catch {
      resolve(null);
    }
  });
}

function procPids(): number[] | null {
  if (process.platform !== "linux") return null;
  try {
    return readdirSync("/proc")
      .filter((n) => /^\d+$/.test(n))
      .map(Number);
  } catch {
    return null;
  }
}

function procCwd(pid: number): string | null {
  if (process.platform !== "linux") return null;
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/** Claude transcripts for `root` by modification time (stat only; titles are never read). */
export function listTranscriptTimes(
  root: string,
  home?: string | null,
): Array<{ id: string; modifiedMs: number }> | null {
  const dir = claudeProjectDir(root, { home });
  if (!dir) return null;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const out: Array<{ id: string; modifiedMs: number }> = [];
  for (const name of names) {
    const m = /^([0-9a-f-]{36})\.jsonl$/i.exec(name);
    if (!m) continue;
    try {
      const st = statSync(path.join(dir, name));
      if (st.isFile()) out.push({ id: m[1] as string, modifiedMs: st.mtimeMs });
    } catch {
      // Vanished between readdir and stat.
    }
  }
  return out;
}

export interface CollectLiveRosterDeps {
  now?: () => number;
  selfPid?: number;
  /** Detached audit sessions (the session-start hook's lister); `null` = unavailable. */
  listAudit?: () => Promise<AuditSessionLike[] | null>;
  lease?: QueueLeaseVerdict;
  home?: string | null;
  timeoutMs?: number;
}

/** Gather every source (bounded, fail-open) and compose the roster. */
export async function collectLiveRoster(
  rootDir: string,
  deps: CollectLiveRosterDeps = {},
): Promise<LiveRoster> {
  const root = path.resolve(rootDir);
  const timeout = deps.timeoutMs ?? LIVE_ROSTER_COMMAND_TIMEOUT_MS;
  const notes: string[] = [];
  const [psText, porcelain, audit] = await Promise.all([
    runBounded("ps", ["-axo", "pid=,ppid=,etime=,args="], root, timeout),
    runBounded("git", ["worktree", "list", "--porcelain"], root, timeout),
    (deps.listAudit ?? (async () => [] as AuditSessionLike[]))().catch(() => null),
  ]);
  let lease: QueueLeaseVerdict;
  try {
    lease = deps.lease ?? inspectQueueLease(root);
  } catch {
    lease = { kind: "free" };
    notes.push("queue lease unreadable");
  }
  let handoffText: string | null = null;
  try {
    handoffText = readFileSync(path.join(root, HANDOFF_REL), "utf8");
  } catch {
    // No HANDOFF: no plan to show.
  }
  let transcripts: Array<{ id: string; modifiedMs: number }> | null = null;
  try {
    transcripts = listTranscriptTimes(root, deps.home);
  } catch {
    transcripts = null;
  }
  return composeLiveRoster({
    root,
    now: (deps.now ?? Date.now)(),
    ps: psText,
    cwdOf: procCwd,
    allPids: procPids(),
    selfPid: deps.selfPid ?? process.pid,
    worktreePorcelain: porcelain,
    lease,
    handoffText,
    transcripts,
    audit,
    isNestedRepo: (dir) => existsSync(path.join(dir, ".git")),
    notes,
  });
}

/** `12s`, `5m`, `3h`, `2d`. */
export function formatRosterAge(seconds: number | null): string {
  if (seconds === null) return "?";
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
}

/** One line for the lease verdict, with the HANDOFF plan when someone holds it. */
export function formatRosterLease(roster: LiveRoster): string {
  const v = roster.lease;
  const plan = roster.handoff.plan ? `; HANDOFF plan ${roster.handoff.plan}` : "";
  const status = roster.handoff.queueStatus ? `, Queue status ${roster.handoff.queueStatus}` : "";
  switch (v.kind) {
    case "free":
      return "Queue lease: free.";
    case "own":
      return `Queue lease: held by this session (${v.lease.session}${plan}${status}).`;
    case "stale":
      return `Queue lease: stale (${v.reason}).`;
    case "held":
      return `Queue lease: HELD by another live session (${v.reason}; session ${v.lease.session}${v.lease.agent ? `, agent pid ${v.lease.agent.pid}` : ""}${plan}${status}).`;
  }
}

export function formatRosterRow(row: LiveRosterRow, root: string): string {
  const bits = [row.kind.padEnd(11), row.pid === null ? "-".padEnd(8) : String(row.pid).padEnd(8)];
  bits.push(formatRosterAge(row.ageSeconds).padEnd(4), row.role);
  const extra: string[] = [];
  if (row.parentPid !== null) extra.push(`under pid ${row.parentPid}`);
  if (row.leaseHolder) extra.push("lease holder");
  if (row.sessionId) extra.push(`session ${row.sessionId}`);
  if (row.plan) extra.push(`plan ${row.plan}`);
  if (row.todo) extra.push(`to-do ${row.todo}`);
  if (row.worktree) extra.push(`worktree ${row.worktree}`);
  else if (row.cwd && row.cwd !== root) extra.push(`cwd ${row.cwd}`);
  if (row.self) extra.push("this session");
  return `  ${bits.join("  ")}${extra.length ? `  (${extra.join(", ")})` : ""}`;
}

/** Human text for `agent-kit sessions --live`. */
export function renderLiveRoster(roster: LiveRoster): string {
  const lines = [
    `Live agents in ${roster.root} (${roster.generatedAt})`,
    formatRosterLease(roster),
  ];
  if (roster.rows.length === 0) lines.push("  No live agent process in this workspace.");
  for (const row of roster.rows) lines.push(formatRosterRow(row, roster.root));
  if (roster.worktrees.length > 0) {
    lines.push("", "Worktrees with a live process (do not reuse them):");
    for (const w of roster.worktrees) {
      lines.push(
        `  ${w.path}${w.branch ? ` [${w.branch}]` : ""}  pids ${w.pids.join(", ")}${w.self ? "  (this session)" : ""}`,
      );
    }
  }
  if (roster.transcripts.length > 0) {
    lines.push(
      "",
      "Claude transcripts written in the last 30 min (a hint, not proof of liveness):",
    );
    for (const t of roster.transcripts) {
      lines.push(`  ${t.id}  ${formatRosterAge(t.ageSeconds)} ago`);
    }
  }
  if (roster.notes.length > 0) lines.push("", `Notes: ${roster.notes.join("; ")}.`);
  return lines.join("\n");
}
