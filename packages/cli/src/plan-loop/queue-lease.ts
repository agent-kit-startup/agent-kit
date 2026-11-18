/**
 * Queue owner lease for `/run-plan-all`: one live owner per repository queue
 * (ADR 2026-07-26_run-plan-all-queue-contract, Amend 2026-11-16).
 *
 * The headless dispatcher (`agent-kit run-plan-all`, terminal or driver mode)
 * holds `.cursor/context/run-plan-all.lock` for its whole session. A second
 * dispatcher refuses while the lease is live; a stale lease is taken over and
 * logged in HANDOFF. The lease records the agent child too: when Colony was
 * closed on 2026-11-11 the dispatcher died and the `claude -p` orchestrator
 * lived on, so a lease keyed on the dispatcher alone would have been taken
 * over while the orphan kept writing the repository.
 *
 * Surface (kept small; later plans build on it): `decideQueueLease` (pure),
 * `acquireQueueLease` / `QueueLeaseHandle` (dispatcher), `inspectQueueLease`
 * (read-only, `agent-kit queue lease`), `forwardTermination` (signals).
 * All file IO is synchronous so a signal handler can release the lease.
 */

import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { HANDOFF_REL } from "../utils/kit-paths.js";

export const QUEUE_LEASE_RELPATH = ".cursor/context/run-plan-all.lock";
/** The dispatcher refreshes `heartbeatAt` this often. */
export const QUEUE_LEASE_HEARTBEAT_MS = 30_000;
/** A heartbeat older than this is expired (four missed beats). */
export const QUEUE_LEASE_TTL_MS = 120_000;
/** After SIGINT / SIGTERM / SIGHUP: how long to wait for the agent before leaving the lease. */
export const QUEUE_LEASE_INTERRUPT_WAIT_MS = 2_000;
/** Exported to the agent child: the session that owns the lease. */
export const QUEUE_LEASE_SESSION_ENV = "AGENT_KIT_QUEUE_LEASE_SESSION";

/** A process, with its start time (Linux `/proc/<pid>/stat` field 22) when known. */
export interface QueueLeaseProc {
  pid: number;
  start: string | null;
}

export interface QueueLease {
  version: 1;
  session: string;
  host: string;
  dispatcher: QueueLeaseProc;
  agent: QueueLeaseProc | null;
  startedAt: string;
  heartbeatAt: string;
}

export type QueueLeaseVerdict =
  | { kind: "free" }
  | { kind: "own"; lease: QueueLease }
  | { kind: "held"; lease: QueueLease; orphan: boolean; reason: string }
  | { kind: "stale"; lease: QueueLease | null; reason: string };

export interface QueueLeaseProbe {
  host: string;
  now: number;
  /** True when the process still runs (same start time when one is recorded). */
  alive: (proc: QueueLeaseProc) => boolean;
  /** The caller's own session (`AGENT_KIT_QUEUE_LEASE_SESSION`), if any. */
  session?: string;
  ttlMs?: number;
}

/**
 * Pure decision. `lease` is `null` when no file exists; `"corrupt"` when the
 * file does not parse (stale: nobody can prove it is live).
 */
export function decideQueueLease(
  lease: QueueLease | null | "corrupt",
  probe: QueueLeaseProbe,
): QueueLeaseVerdict {
  if (lease === null) return { kind: "free" };
  if (lease === "corrupt") return { kind: "stale", lease: null, reason: "unreadable lease file" };
  if (probe.session && probe.session === lease.session) return { kind: "own", lease };
  const ttl = probe.ttlMs ?? QUEUE_LEASE_TTL_MS;
  const beat = Date.parse(lease.heartbeatAt);
  const fresh = Number.isFinite(beat) && probe.now - beat <= ttl;
  if (lease.host !== probe.host) {
    // Another machine on a shared folder: its pids mean nothing here.
    return fresh
      ? {
          kind: "held",
          lease,
          orphan: false,
          reason: `held by host ${lease.host} (fresh heartbeat)`,
        }
      : { kind: "stale", lease, reason: `heartbeat expired (host ${lease.host})` };
  }
  const dispatcherAlive = probe.alive(lease.dispatcher);
  const agentAlive = lease.agent !== null && probe.alive(lease.agent);
  if (agentAlive && !dispatcherAlive) {
    return {
      kind: "held",
      lease,
      orphan: true,
      reason: `orphaned agent pid ${lease.agent?.pid} is still running (dispatcher pid ${lease.dispatcher.pid} is gone)`,
    };
  }
  if (agentAlive && !fresh) {
    return {
      kind: "held",
      lease,
      orphan: true,
      reason: `agent pid ${lease.agent?.pid} is still running under an unresponsive dispatcher (pid ${lease.dispatcher.pid}, heartbeat expired)`,
    };
  }
  if (dispatcherAlive && fresh) {
    return {
      kind: "held",
      lease,
      orphan: false,
      reason: `held by dispatcher pid ${lease.dispatcher.pid}`,
    };
  }
  if (!dispatcherAlive) {
    return { kind: "stale", lease, reason: `dispatcher pid ${lease.dispatcher.pid} is gone` };
  }
  return {
    kind: "stale",
    lease,
    reason: `heartbeat expired (dispatcher pid ${lease.dispatcher.pid})`,
  };
}

/** Operator text for a refusal: what holds the queue and what to do. */
export function formatQueueLeaseRefusal(v: Extract<QueueLeaseVerdict, { kind: "held" }>): string {
  const l = v.lease;
  const who = [
    `dispatcher pid ${l.dispatcher.pid}`,
    l.agent ? `agent pid ${l.agent.pid}` : "no agent yet",
    `session ${l.session}`,
    `host ${l.host}`,
    `started ${l.startedAt}`,
    `last heartbeat ${l.heartbeatAt}`,
  ].join(", ");
  const next = v.orphan
    ? `It may still be writing this repository. Check it (ps -o pid,etime,args -p ${l.agent?.pid}), stop it, then start /run-plan-all again.`
    : "Wait for that session to end (or stop it from the window that started it), then start /run-plan-all again.";
  return `Queue lease held: another /run-plan-all owns this queue (${v.reason}; ${who}). ${next}`;
}

/** Linux process start time, or `null` (other platforms, gone, unreadable). */
export function procStart(pid: number): string | null {
  if (process.platform !== "linux") return null;
  const stat = procStat(pid);
  return stat?.start ?? null;
}

function procStat(pid: number): { state: string; ppid: number; start: string } | null {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name (field 2) sits in parentheses and may hold spaces.
    const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
    const state = fields[0];
    const ppid = Number(fields[1]);
    const start = fields[19];
    return state && start ? { state, ppid, start } : null;
  } catch {
    return null;
  }
}

/** Linux parent pid, or `null` (other platforms, gone, unreadable). */
export function procParent(pid: number): number | null {
  if (process.platform !== "linux") return null;
  return procStat(pid)?.ppid ?? null;
}

/** Default liveness: signal 0, then (Linux) not a zombie and same start time. */
export function processAlive(proc: QueueLeaseProc): boolean {
  if (!Number.isInteger(proc.pid) || proc.pid <= 1) return false;
  try {
    process.kill(proc.pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  if (process.platform !== "linux") return true;
  const stat = procStat(proc.pid);
  if (!stat) return false;
  if (stat.state === "Z" || stat.state === "X") return false;
  return proc.start === null || proc.start === stat.start;
}

export function queueLeasePath(root: string): string {
  return path.join(root, QUEUE_LEASE_RELPATH);
}

/** The lease on disk: `null` when absent, `"corrupt"` when it does not parse. */
export function readQueueLease(root: string): QueueLease | null | "corrupt" {
  let text: string;
  try {
    text = readFileSync(queueLeasePath(root), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "corrupt";
  }
  try {
    const v = JSON.parse(text) as Partial<QueueLease>;
    const okProc = (p: unknown): p is QueueLeaseProc =>
      !!p && typeof (p as QueueLeaseProc).pid === "number";
    if (
      v.version !== 1 ||
      typeof v.session !== "string" ||
      typeof v.host !== "string" ||
      !okProc(v.dispatcher) ||
      (v.agent !== null && !okProc(v.agent)) ||
      typeof v.startedAt !== "string" ||
      typeof v.heartbeatAt !== "string"
    ) {
      return "corrupt";
    }
    return v as QueueLease;
  } catch {
    return "corrupt";
  }
}

function leaseTmp(root: string, lease: QueueLease): string {
  const tmp = `${queueLeasePath(root)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
  return tmp;
}

function writeLeaseAtomic(root: string, lease: QueueLease): void {
  renameSync(leaseTmp(root, lease), queueLeasePath(root));
}

/** Create the lease only when no file exists, complete or not at all (link fails on EEXIST). */
function createLeaseExclusive(root: string, lease: QueueLease): boolean {
  const tmp = leaseTmp(root, lease);
  try {
    linkSync(tmp, queueLeasePath(root));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // Already gone.
    }
  }
}

/** Synchronous pause (a signal handler and the acquire path cannot await). */
function pauseMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Ms a takeover waits before reading the file back (narrows the two-takeover race). */
export const QUEUE_LEASE_TAKEOVER_SETTLE_MS = 150;

export interface QueueLeaseEnv {
  /** Command named in the HANDOFF takeover line (default `agent-kit run-plan-all`). */
  holder?: string;
  host?: string;
  pid?: number;
  now?: () => number;
  alive?: (proc: QueueLeaseProc) => boolean;
  procStart?: (pid: number) => string | null;
  session?: string;
  heartbeatMs?: number;
  ttlMs?: number;
  /** Test seam: pause before reading a takeover back. */
  settleMs?: number;
}

/** Read-only check (`agent-kit queue lease`): never writes the file. */
export function inspectQueueLease(
  root: string,
  env: QueueLeaseEnv & { callerSession?: string } = {},
): QueueLeaseVerdict {
  return decideQueueLease(readQueueLease(root), {
    host: env.host ?? hostname(),
    now: (env.now ?? Date.now)(),
    alive: env.alive ?? processAlive,
    session: env.callerSession ?? process.env[QUEUE_LEASE_SESSION_ENV],
    ttlMs: env.ttlMs,
  });
}

export interface QueueLeaseHandle {
  session: string;
  /** Set when a stale lease was replaced (the HANDOFF line is already written). */
  takeover: Extract<QueueLeaseVerdict, { kind: "stale" }> | null;
  /** Record the agent child once it is spawned. */
  setAgent: (pid: number | undefined) => void;
  /** The recorded agent child, if any (pid and start time). */
  agent: () => QueueLeaseProc | null;
  /** Refresh the heartbeat now (the timer calls it every 30 s). */
  beat: () => void;
  /** False once another session replaced the file (this owner lost the lease). */
  held: () => boolean;
  /** Remove the file if it is still ours; stop the heartbeat. Idempotent. */
  release: () => void;
  /**
   * Interrupted session: wait up to `waitMs` for the recorded agent to exit,
   * then release. When the agent is still alive the file stays (heartbeat
   * stopped), so the next dispatcher sees the orphan and names it.
   */
  releaseAfterAgent: (waitMs: number) => boolean;
}

export type QueueLeaseAcquire =
  | { ok: true; handle: QueueLeaseHandle }
  | { ok: false; verdict: Extract<QueueLeaseVerdict, { kind: "held" }>; message: string };

/**
 * Take the queue lease for this dispatcher: create the file (O_EXCL), or
 * replace a stale one and log the takeover in HANDOFF, or refuse a live one.
 * The heartbeat timer is `unref`'d so it never keeps the process alive.
 */
export function acquireQueueLease(
  root: string,
  env: QueueLeaseEnv & { onLost?: (by: QueueLease | null) => void } = {},
): QueueLeaseAcquire {
  const now = env.now ?? Date.now;
  const host = env.host ?? hostname();
  const pid = env.pid ?? process.pid;
  const startOf = env.procStart ?? procStart;
  const alive = env.alive ?? processAlive;
  const session = env.session ?? randomUUID();
  const iso = () => new Date(now()).toISOString();
  const file = queueLeasePath(root);
  mkdirSync(path.dirname(file), { recursive: true });

  let lease: QueueLease = {
    version: 1,
    session,
    host,
    dispatcher: { pid, start: startOf(pid) },
    agent: null,
    startedAt: iso(),
    heartbeatAt: iso(),
  };

  let takeover: Extract<QueueLeaseVerdict, { kind: "stale" }> | null = null;
  if (!createLeaseExclusive(root, lease)) {
    const verdict = decideQueueLease(readQueueLease(root), {
      host,
      now: now(),
      alive,
      ttlMs: env.ttlMs,
    });
    if (verdict.kind === "held") {
      return { ok: false, verdict, message: formatQueueLeaseRefusal(verdict) };
    }
    writeLeaseAtomic(root, lease);
    // Two dispatchers may replace the same stale lease: the last rename wins.
    // Reading back after a short pause lets a near-simultaneous rename land
    // first, so the loser sees a foreign session. This narrows the race; it
    // does not close it (no lock primitive spans hosts and platforms here).
    pauseMs(env.settleMs ?? QUEUE_LEASE_TAKEOVER_SETTLE_MS);
    const back = readQueueLease(root);
    if (back === null || back === "corrupt" || back.session !== session) {
      const held: Extract<QueueLeaseVerdict, { kind: "held" }> = {
        kind: "held",
        lease: back !== null && back !== "corrupt" ? back : lease,
        orphan: false,
        reason: "another dispatcher took over the stale lease first",
      };
      return { ok: false, verdict: held, message: formatQueueLeaseRefusal(held) };
    }
    takeover =
      verdict.kind === "stale"
        ? verdict
        : { kind: "stale", lease: null, reason: "lease file vanished" };
    logQueueLeaseTakeover(root, takeover, { at: iso(), pid, session, holder: env.holder });
  }

  let released = false;
  let lost = false;
  const mine = (): boolean => {
    const cur = readQueueLease(root);
    if (cur !== null && cur !== "corrupt" && cur.session === session) return true;
    if (!lost) {
      lost = true;
      env.onLost?.(cur !== null && cur !== "corrupt" ? cur : null);
    }
    return false;
  };
  const write = (next: QueueLease) => {
    if (released || lost || !mine()) return;
    lease = next;
    writeLeaseAtomic(root, lease);
  };
  const timer = setInterval(() => {
    try {
      write({ ...lease, heartbeatAt: iso() });
    } catch {
      // A failed beat only ages the lease; the next one retries.
    }
  }, env.heartbeatMs ?? QUEUE_LEASE_HEARTBEAT_MS);
  timer.unref();

  let agent: QueueLeaseProc | null = null;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(timer);
    try {
      const cur = readQueueLease(root);
      if (cur !== null && cur !== "corrupt" && cur.session === session) unlinkSync(file);
    } catch {
      // Already gone.
    }
  };
  const handle: QueueLeaseHandle = {
    session,
    takeover,
    setAgent: (agentPid) => {
      if (agentPid === undefined) return;
      agent = { pid: agentPid, start: startOf(agentPid) };
      write({ ...lease, agent, heartbeatAt: iso() });
    },
    agent: () => agent,
    beat: () => write({ ...lease, heartbeatAt: iso() }),
    held: () => !released && !lost && mine(),
    release,
    releaseAfterAgent: (waitMs) => {
      const deadline = now() + waitMs;
      while (agent !== null && alive(agent) && now() < deadline) pauseMs(50);
      if (agent !== null && alive(agent)) {
        clearInterval(timer);
        return false;
      }
      release();
      return true;
    },
  };
  return { ok: true, handle };
}

/** One dated bullet right under the HANDOFF title; no HANDOFF, no line. */
export function logQueueLeaseTakeover(
  root: string,
  verdict: Extract<QueueLeaseVerdict, { kind: "stale" }>,
  by: { at: string; pid: number; session: string; holder?: string },
): string | null {
  const file = path.join(root, HANDOFF_REL);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const old = verdict.lease;
  const from = old
    ? `dispatcher pid ${old.dispatcher.pid}${old.agent ? `, agent pid ${old.agent.pid}` : ""}, session ${old.session}, host ${old.host}, started ${old.startedAt}, last heartbeat ${old.heartbeatAt}`
    : "no readable owner";
  const line = `- **Queue lease takeover ${by.at} (${by.holder ?? "agent-kit run-plan-all"}, pid ${by.pid}, session ${by.session}):** took over a stale queue lease (${verdict.reason}; ${from}). Check the old owner's worktrees before resuming its rows.`;
  const nl = text.indexOf("\n");
  const next =
    nl === -1 ? `${text}\n${line}\n` : `${text.slice(0, nl + 1)}${line}\n${text.slice(nl + 1)}`;
  writeFileSync(file, next, "utf8");
  return line;
}

/**
 * Slashes whose `agent-kit run` takes no lease: read-only jobs (ADR 2026-07-26
 * Amend 2026-11-16 agent check-in, point 2). Every other slash may write
 * HANDOFF or plan files, so its run holds the lease.
 */
export const LEASE_FREE_SLASHES: ReadonlySet<string> = new Set([
  "summary",
  "context-status",
  "tips",
  "review-pack",
  "resolve-conflicts",
]);

export interface NestedLeaseProbe {
  /** The caller's session (default `AGENT_KIT_QUEUE_LEASE_SESSION`). */
  session?: string;
  /** The caller's pid (default `process.pid`). */
  pid?: number;
  /**
   * Parent pid lookup for the ancestry check; `null` from the default means no
   * `/proc` (off Linux), where the session variable alone counts.
   */
  parentOf?: (pid: number) => number | null;
  /** True when ancestry can be checked (default: Linux). */
  canCheckAncestry?: boolean;
  host?: string;
  now?: number;
  alive?: (proc: QueueLeaseProc) => boolean;
  ttlMs?: number;
}

/**
 * The live lease this process runs under as a subsession (Amend 2026-11-16
 * agent check-in, point 3), or `null`. Nested means: the caller's
 * `AGENT_KIT_QUEUE_LEASE_SESSION` names the live lease, and (where `/proc`
 * exists) the caller descends from the lease's dispatcher or agent. A shell
 * that merely inherited the variable is not nested. Off Linux the variable
 * alone counts (documented residual).
 */
export function nestedUnderLease(root: string, probe: NestedLeaseProbe = {}): QueueLease | null {
  const session = probe.session ?? process.env[QUEUE_LEASE_SESSION_ENV];
  if (!session) return null;
  const lease = readQueueLease(root);
  if (lease === null || lease === "corrupt" || lease.session !== session) return null;
  // Live only: a stale lease is taken over, not joined.
  const verdict = decideQueueLease(lease, {
    host: probe.host ?? hostname(),
    now: probe.now ?? Date.now(),
    alive: probe.alive ?? processAlive,
    ttlMs: probe.ttlMs,
  });
  if (verdict.kind !== "held") return null;
  const canCheck = probe.canCheckAncestry ?? process.platform === "linux";
  if (!canCheck) return lease;
  const parentOf = probe.parentOf ?? procParent;
  const holders = new Set([lease.dispatcher.pid, ...(lease.agent ? [lease.agent.pid] : [])]);
  let p: number | null = probe.pid ?? process.pid;
  for (let guard = 0; p !== null && p > 1 && guard < 128; guard++) {
    if (holders.has(p)) return lease;
    p = parentOf(p);
  }
  return null;
}

export type PlanWriterLease =
  | { kind: "acquired"; handle: QueueLeaseHandle }
  | { kind: "nested"; lease: QueueLease }
  | { kind: "refused"; message: string };

/** Refusal text for a plan writer other than run-plan-all. */
export function formatPlanWriterRefusal(
  v: Extract<QueueLeaseVerdict, { kind: "held" }>,
  command: string,
): string {
  const l = v.lease;
  const who = [
    `dispatcher pid ${l.dispatcher.pid}`,
    l.agent ? `agent pid ${l.agent.pid}` : "no agent yet",
    `session ${l.session}`,
    `host ${l.host}`,
    `started ${l.startedAt}`,
  ].join(", ");
  const next = v.orphan
    ? `It may still be writing this repository. Check it (ps -o pid,etime,args -p ${l.agent?.pid}), stop it, then start ${command} again.`
    : `Wait for that session to end (agent-kit sessions --live shows it), then start ${command} again.`;
  return `Queue lease held: another live session writes this workspace's plans (${v.reason}; ${who}). ${command} did not start. ${next}`;
}

/**
 * Check-in before a gate (Amend 2026-11-16 agent check-in, point 4): read the
 * lease as `session` would. Returns the probe line when another live session
 * holds it (the caller does not offer the gate), `null` otherwise. Fail-open:
 * an unreadable lease never blocks a gate.
 */
export function gateCheckIn(
  root: string,
  session: () => string | null | undefined,
  env: QueueLeaseEnv = {},
): () => string | null {
  return () => {
    try {
      const v = inspectQueueLease(root, { ...env, callerSession: session() ?? undefined });
      if (v.kind !== "held") return null;
      return `Queue lease held: another live session writes this workspace's plans (${v.reason}; session ${v.lease.session}); check with agent-kit sessions --live`;
    } catch {
      return null;
    }
  };
}

/**
 * Lease for a headless plan writer (`agent-kit run-plan`, `agent-kit run
 * <slash>`): join the holder's lease as a subsession, or acquire it (same
 * acquire / heartbeat / takeover rules as run-plan-all), or refuse.
 */
export function acquirePlanWriterLease(
  root: string,
  command: string,
  env: QueueLeaseEnv & { onLost?: (by: QueueLease | null) => void; nested?: NestedLeaseProbe } = {},
): PlanWriterLease {
  const nested = nestedUnderLease(root, {
    host: env.host,
    now: env.now?.(),
    alive: env.alive,
    ttlMs: env.ttlMs,
    pid: env.pid,
    ...env.nested,
  });
  if (nested) return { kind: "nested", lease: nested };
  const acquired = acquireQueueLease(root, { ...env, holder: env.holder ?? command });
  if (acquired.ok) return { kind: "acquired", handle: acquired.handle };
  return { kind: "refused", message: formatPlanWriterRefusal(acquired.verdict, command) };
}

const QUEUE_STATUS_LINE = /^- \*\*Queue status:\*\*[ \t]*(.*)$/m;

/**
 * Out-of-queue run (Amend 2026-11-16 agent check-in, point 6): while it holds
 * the lease, a `running` or `paused` queue reads `held (by <plan>, <who>,
 * <date>; was <previous>)`. Returns the restore function, or `null` when there
 * is nothing to hold (no HANDOFF, no queue, or another status). Restore puts
 * the previous line back only while the held line is still the one written
 * here, so a later edit by someone else is never overwritten.
 */
export function holdQueueStatus(
  root: string,
  by: { plan: string; who: string; at: string },
): (() => boolean) | null {
  const file = path.join(root, HANDOFF_REL);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const m = QUEUE_STATUS_LINE.exec(text);
  if (!m) return null;
  const previous = (m[1] ?? "").trim();
  if (!/^(running|paused)\b/i.test(previous)) return null;
  const original = m[0];
  const held = `- **Queue status:** held (by ${by.plan}, ${by.who}, ${by.at}; was ${previous})`;
  writeFileSync(
    file,
    text.replace(original, () => held),
    "utf8",
  );
  return () => {
    try {
      const now = readFileSync(file, "utf8");
      const cur = QUEUE_STATUS_LINE.exec(now);
      if (!cur || cur[0] !== held) return false;
      writeFileSync(
        file,
        now.replace(held, () => original),
        "utf8",
      );
      return true;
    } catch {
      return false;
    }
  };
}

export type ForwardedSignal = "SIGTERM" | "SIGHUP" | "SIGINT";

/**
 * On SIGTERM or SIGHUP (a host's parent-death signal, a closed terminal; plus
 * SIGINT when the caller has no handler of its own), signal the running agent
 * child with SIGTERM, then run `onExit` (release the lease, last event,
 * `process.exit`). The agent is signalled only while it is still the process
 * recorded at spawn (same start time), never a reused pid. Returns the
 * unregister function.
 */
export function forwardTermination(
  agent: () => QueueLeaseProc | null | undefined,
  onExit: (signal: ForwardedSignal) => void,
  opts: {
    signals?: ForwardedSignal[];
    kill?: (pid: number, signal: NodeJS.Signals) => void;
    alive?: (proc: QueueLeaseProc) => boolean;
  } = {},
): () => void {
  const kill =
    opts.kill ??
    ((p: number, s: NodeJS.Signals) => {
      process.kill(p, s);
    });
  const isAlive = opts.alive ?? processAlive;
  const handler = (signal: ForwardedSignal) => {
    const proc = agent();
    if (proc && proc.pid > 1 && isAlive(proc)) {
      try {
        kill(proc.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    onExit(signal);
  };
  const signals = opts.signals ?? ["SIGTERM", "SIGHUP"];
  const listeners = signals.map((sig) => [sig, () => handler(sig)] as const);
  for (const [sig, fn] of listeners) process.on(sig, fn);
  return () => {
    for (const [sig, fn] of listeners) process.off(sig, fn);
  };
}
