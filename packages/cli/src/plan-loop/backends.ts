import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  type AnswerReader,
  type HitlRunRecord,
  type HitlStop,
  TurnWatcher,
  askOperator,
  createTerminalAnswerReader,
  detectHitlGate,
  emptyHitlRecord,
  noRelayStop,
  unansweredStop,
  userEventLine,
} from "./hitl-relay.js";
import { type StreamSink, createStreamRenderer } from "./stream-render.js";

export type BackendId = "cursor-agent" | "claude";

/** Test seam: `claude --version` reader (default: execFileSync). Null = unknown. */
export type VersionFn = (bin: string) => string | null;

export interface BackendRunOptions {
  workspace: string;
  prompt: string;
  model?: string;
  logPath: string;
  /**
   * Extra environment for the child, merged over `process.env` (an explicit
   * `undefined` unsets an inherited key). Every backend redacts the
   * `CLAUDE_ENV_PASSTHROUGH` values of the merged result (or of `process.env`
   * when no override is given) in every log line, tip and error string.
   */
  env?: NodeJS.ProcessEnv;
  /** Test seam: replacement for `node:child_process` spawn. */
  spawnFn?: typeof spawn;
  /** Test seam: sink for operator tips (default: console.log). */
  log?: (line: string) => void;
  /** Test seam: `claude --version` reader (claude backend only). */
  versionFn?: VersionFn;
  /**
   * HITL relay policy for this run. Absent = prompt the operator on a TTY
   * (a gate on a non-TTY stdin stops the run, never a default answer).
   */
  hitl?: HitlRunOptions;
  /**
   * Terminal side of the tee (default: status lines on process.stdout). The
   * Mission Control live view injects its feed here; the log file always
   * receives the raw NDJSON regardless.
   */
  render?: StreamSink;
  /** Fired once the child is running, with a handle that stops it honestly. */
  onSpawn?: (info: SpawnInfo) => void;
}

/** What a caller learns about the running child, and the one way to stop it. */
export interface SpawnInfo {
  backend: BackendId;
  pid: number | undefined;
  /**
   * Operator stop outside a gate: records `stop` on the run, ends the
   * child's stdin and, past the kill grace, signals it. Idempotent.
   */
  stop: (stop: HitlStop) => void;
}

/** Operator-facing side of the relay; the backend supplies the transport. */
export interface HitlRunOptions {
  /** `off` is `--no-hitl`: reaching a gate stops the run (exit 4). */
  policy?: "prompt" | "off";
  /** Whether stdin is a terminal (default: process.stdin.isTTY). */
  isTTY?: boolean;
  /** Test seam / TUI seam: how one answer line is read (default: node:readline on stdin). */
  readAnswer?: AnswerReader;
  /** Terminal writer for the gate prompt and the relayed stamp (default: process.stdout). */
  write?: (text: string) => void;
  /** Called around the prompt so a caller can pause its own terminal chrome (spinner). */
  onPromptStart?: () => void;
  onPromptEnd?: () => void;
  /** After a stop: ms of grace after stdin end before SIGTERM, then SIGKILL (default 5000). */
  killAfterMs?: number;
}

export interface BackendRunResult {
  /** The child's own exit code; see `hitlExitCode` for the run's. */
  exitCode: number;
  /** Gate replies and the stop record, when the run carried a relay. */
  hitl?: HitlRunRecord;
}

export interface AgentBackend {
  id: BackendId;
  /** Resolve binary path or name; null if not on PATH / not found. */
  resolve(): Promise<string | null>;
  /** Run one headless tick; NDJSON to logPath, rendered status lines to the console. */
  run(opts: BackendRunOptions): Promise<BackendRunResult>;
}

export interface RedactionEntry {
  /** Placeholder label, e.g. the env key name. */
  label: string;
  /** Secret value to elide. Empty strings are ignored. */
  value: string;
}

export interface SpawnLoggedOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: typeof spawn;
  /** Secret values replaced in the tee'd output (console echo and log file). */
  redact?: RedactionEntry[];
  /**
   * Terminal side of the tee (default: a StreamRenderer on process.stdout).
   * Receives the same post-redaction text the log gets and renders status
   * lines; the log file always receives the raw NDJSON.
   */
  render?: StreamSink;
  /**
   * HITL relay. `stdin-stream-json` keeps the child's stdin open, writes the
   * first prompt as a `user` event and relays operator answers the same way;
   * `none` (cursor-agent) only detects a gate and records an honest stop.
   */
  hitl?: SpawnHitlOptions;
  /** Fired once the child is running (pid, stop handle). */
  onSpawn?: (info: SpawnInfo) => void;
  backendId?: BackendId;
}

export type HitlTransport =
  | { kind: "stdin-stream-json"; firstPrompt: string }
  | { kind: "none"; backend: string };

export interface SpawnHitlOptions {
  transport: HitlTransport;
  policy: "prompt" | "off";
  isTTY: boolean;
  readAnswer: AnswerReader;
  write: (text: string) => void;
  onPromptStart?: () => void;
  onPromptEnd?: () => void;
  killAfterMs?: number;
}

const HITL_KILL_GRACE_MS = 5000;

/** Fill the operator side of the relay from the process terminal. */
export function resolveHitlRunOptions(
  hitl: HitlRunOptions | undefined,
  transport: HitlTransport,
): SpawnHitlOptions {
  return {
    transport,
    policy: hitl?.policy ?? "prompt",
    isTTY: hitl?.isTTY ?? Boolean(process.stdin.isTTY),
    readAnswer: hitl?.readAnswer ?? createTerminalAnswerReader(),
    write: hitl?.write ?? ((text) => process.stdout.write(text)),
    onPromptStart: hitl?.onPromptStart,
    onPromptEnd: hitl?.onPromptEnd,
    killAfterMs: hitl?.killAfterMs,
  };
}

/**
 * Env keys the claude backend forwards on purpose and never prints.
 * ANTHROPIC_BASE_URL selects the endpoint (gateway / proxy);
 * ANTHROPIC_AUTH_TOKEN is sent as `Authorization: Bearer` and wins over
 * ANTHROPIC_API_KEY (`X-Api-Key`, always used in `-p` when present).
 * Documented precedence: code.claude.com/docs/en/authentication.
 */
export const CLAUDE_ENV_PASSTHROUGH = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
] as const;

/**
 * Replace every occurrence of each secret with `[<label>]`. Plain string
 * splitting (no RegExp): tokens contain `+ . / =`. Longer secrets first so a
 * value that embeds another one is elided whole.
 */
export function redactSecrets(text: string, secrets: readonly RedactionEntry[]): string {
  let out = text;
  const ordered = secrets
    .filter((s) => s.value.length > 0)
    .sort((a, b) => b.value.length - a.value.length);
  for (const s of ordered) {
    out = out.split(s.value).join(`[${s.label}]`);
  }
  return out;
}

/** Longest partial line held back before the tail-cut fallback kicks in. */
const REDACT_HOLD_MAX_CHARS = 64 * 1024;

/**
 * Chunk-boundary-safe redaction for one stream. `data` events split at
 * arbitrary byte offsets, so a per-event `redactSecrets` misses a secret that
 * straddles two chunks. This buffer emits complete lines only (the tick output
 * is NDJSON, so stdout and stderr also interleave at line boundaries in the
 * tee) and holds the trailing partial line back. A partial line longer than
 * REDACT_HOLD_MAX_CHARS is streamed anyway, minus a raw tail of
 * `max(secret.length) - 1` chars that could be the start of a secret. No cut
 * ever lands inside an occurrence, so every secret is elided whole regardless
 * of chunking. Whatever is still held is emitted by `flush()` on stream end.
 * Multi-byte UTF-8 split across Buffer chunks is reassembled by a
 * StringDecoder.
 */
export class RedactingStreamBuffer {
  private pending = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly secrets: RedactionEntry[];
  private readonly keep: number;

  constructor(secrets: readonly RedactionEntry[]) {
    this.secrets = secrets.filter((s) => s.value.length > 0);
    this.keep =
      this.secrets.length > 0 ? Math.max(...this.secrets.map((s) => s.value.length)) - 1 : 0;
  }

  /** Append a chunk; returns the redacted text that is safe to emit now. */
  push(chunk: Buffer | string): string {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (this.secrets.length === 0) return text;
    this.pending += text;
    let cut = this.pending.lastIndexOf("\n") + 1;
    if (cut === 0) {
      if (this.pending.length < REDACT_HOLD_MAX_CHARS) return "";
      cut = this.pending.length - this.keep;
    }
    if (cut <= 0) return "";
    // Move the cut left to the start of any occurrence that straddles it.
    let moved = true;
    while (moved) {
      moved = false;
      for (const s of this.secrets) {
        let idx = this.pending.indexOf(s.value, Math.max(0, cut - s.value.length + 1));
        while (idx !== -1 && idx < cut) {
          if (idx + s.value.length > cut) {
            cut = idx;
            moved = true;
            break;
          }
          idx = this.pending.indexOf(s.value, idx + 1);
        }
        if (moved) break;
      }
    }
    if (cut <= 0) return "";
    const out = redactSecrets(this.pending.slice(0, cut), this.secrets);
    this.pending = this.pending.slice(cut);
    return out;
  }

  /** Emit whatever is still held back (call once, on stream end). */
  flush(): string {
    const rest = this.pending + this.decoder.end();
    this.pending = "";
    return this.secrets.length === 0 ? rest : redactSecrets(rest, this.secrets);
  }
}

/** Merge overrides over process.env; an explicit undefined unsets a key. */
export function mergeChildEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  if (!overrides) return merged;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

/**
 * Session markers the claude CLI itself deletes before spawning a child
 * `claude` (2.1.261 child-env builder). Inherited verbatim they would make a
 * headless tick started from inside a Claude Code shell classify as a nested
 * child session. Exactly these four; other `CLAUDE_*` keys are left alone.
 */
export const CLAUDE_NESTED_SESSION_KEYS = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
] as const;

/** Child env for a `claude -p` spawn: mergeChildEnv minus the nested-session markers. */
export function claudeChildEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = mergeChildEnv(overrides);
  for (const key of CLAUDE_NESTED_SESSION_KEYS) delete env[key];
  return env;
}

/** Opt-in runaway caps for one headless `claude -p` run (print-only flags). */
export const CLAUDE_MAX_TURNS_ENV = "AGENT_KIT_CLAUDE_MAX_TURNS";
export const CLAUDE_MAX_BUDGET_USD_ENV = "AGENT_KIT_CLAUDE_MAX_BUDGET_USD";

export interface ClaudeRunCaps {
  maxTurns?: number;
  maxBudgetUsd?: number;
}

/**
 * Read the opt-in caps from the child env. Absent or invalid values mean no
 * cap (parity with cursor-agent, which has no cap either); an invalid value
 * is reported so a typo does not silently run uncapped.
 */
export function claudeRunCaps(env: NodeJS.ProcessEnv): { caps: ClaudeRunCaps; invalid: string[] } {
  const caps: ClaudeRunCaps = {};
  const invalid: string[] = [];
  const turnsRaw = env[CLAUDE_MAX_TURNS_ENV];
  if (turnsRaw !== undefined && turnsRaw !== "") {
    const n = Number(turnsRaw);
    if (Number.isInteger(n) && n > 0) caps.maxTurns = n;
    else invalid.push(`${CLAUDE_MAX_TURNS_ENV} (want a positive integer)`);
  }
  const budgetRaw = env[CLAUDE_MAX_BUDGET_USD_ENV];
  if (budgetRaw !== undefined && budgetRaw !== "") {
    const n = Number(budgetRaw);
    if (Number.isFinite(n) && n > 0) caps.maxBudgetUsd = n;
    else invalid.push(`${CLAUDE_MAX_BUDGET_USD_ENV} (want a positive number)`);
  }
  return { caps, invalid };
}

/** Derived forms shorter than this are not redacted (they would mangle unrelated text). */
const REDACT_DERIVED_MIN_CHARS = 4;
const REDACT_DERIVED_SKIP = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function derivedSecretForms(value: string): string[] {
  const forms = [
    value.replaceAll("/", "\\/"), // JSON-escaped (JSON.stringify leaves `/` alone)
    encodeURIComponent(value),
    Buffer.from(value, "utf8").toString("base64"),
    Buffer.from(value, "utf8").toString("base64url"),
  ];
  return forms.filter((f) => f !== value);
}

function derivedUrlForms(value: string): string[] {
  const forms: string[] = [];
  const trimmed = value.replace(/\/+$/, "");
  if (trimmed !== value) forms.push(trimmed);
  else forms.push(`${value}/`);
  try {
    const url = new URL(value);
    forms.push(url.origin, url.host, url.hostname);
  } catch {
    // Not a URL: the raw value is still redacted.
  }
  return forms.filter((f) => f !== value);
}

/**
 * Redaction entries for the passthrough keys present in `env`. Applied by
 * every backend (`claude` and `cursor-agent`) to the environment its child
 * inherits. Besides the exact value, derived forms are elided under the same
 * label:
 * - `ANTHROPIC_BASE_URL`: trailing-slash toggle, origin, `host` (with port)
 *   and `hostname`, so a gateway-down `connect ECONNREFUSED host:port` or
 *   `getaddrinfo ENOTFOUND host` line does not print the gateway address.
 * - tokens/keys: the common encoded forms (JSON-escaped, URL-encoded,
 *   base64 / base64url of the value on its own, i.e. aligned at value start).
 * Redaction is exact-substring matching: a form that cannot be enumerated
 * (a hand-typed abbreviation, a hash of the token) is not covered.
 */
export function claudeRedactions(env: NodeJS.ProcessEnv): RedactionEntry[] {
  const entries: RedactionEntry[] = [];
  const seen = new Set<string>();
  const add = (label: string, value: string, derived: boolean) => {
    if (!value || seen.has(value)) return;
    if (derived && (value.length < REDACT_DERIVED_MIN_CHARS || REDACT_DERIVED_SKIP.has(value))) {
      return;
    }
    seen.add(value);
    entries.push({ label, value });
  };
  for (const key of CLAUDE_ENV_PASSTHROUGH) {
    const value = env[key];
    if (!value) continue;
    add(key, value, false);
    const derived =
      key === "ANTHROPIC_BASE_URL" ? derivedUrlForms(value) : derivedSecretForms(value);
    for (const form of derived) add(key, form, true);
  }
  return entries;
}

export async function whichBinary(bin: string): Promise<string | null> {
  try {
    const out = execFileSync("which", [bin], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function spawnLogged(
  command: string,
  args: string[],
  logPath: string,
  options: SpawnLoggedOptions = {},
): Promise<BackendRunResult> {
  const spawnFn = options.spawnFn ?? spawn;
  const redact = options.redact ?? [];
  // Every rejection goes through here so a raw error (spawn, log stream, or a
  // synchronous throw inside the executor) never carries a secret out.
  const redactedError = (err: unknown) => new Error(redactSecrets(String(err), redact));
  const hitl = options.hitl;
  const stdinTransport = hitl?.transport.kind === "stdin-stream-json";
  return new Promise((resolve, reject) => {
    let out: ReturnType<typeof createWriteStream>;
    let child: ReturnType<typeof spawnFn>;
    // A log that could not be written is a failed run, not exit 0: the loop
    // reads the sentinel from this file, and the open error lands
    // asynchronously (possibly after a fast child has already closed).
    let logError: unknown = null;
    try {
      out = createWriteStream(logPath, { flags: "w" });
      out.on("error", (err) => {
        logError = err;
        reject(redactedError(err));
      });
      child = spawnFn(command, args, {
        stdio: [stdinTransport ? "pipe" : "ignore", "pipe", "pipe"],
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: options.env } : {}),
      });
    } catch (err) {
      reject(redactedError(err));
      return;
    }

    // The log gets every byte first; the renderer rebuilds line boundaries
    // from the same text and decides what the terminal shows (never raw
    // NDJSON). A renderer failure is contained inside the sink. The relay
    // watcher reads the same text to spot the end of a turn.
    const render = options.render ?? createStreamRenderer();
    const relay = hitl ? createRelay(hitl, child, redactedError) : null;
    const emit = (text: string | Buffer) => {
      if (text.length === 0) return;
      out.write(text);
      render.feed(text);
      relay?.feed(text);
    };
    if (relay?.startError) {
      out.end();
      reject(relay.startError);
      return;
    }
    options.onSpawn?.({
      backend: options.backendId ?? "claude",
      pid: child.pid,
      stop: (stop) => {
        if (relay) {
          relay.stop(stop);
          return;
        }
        try {
          child.kill("SIGTERM");
        } catch {
          // Already gone.
        }
      },
    });
    // No redaction: raw log, byte for byte. With redaction: one
    // chunk-boundary-safe buffer per stream (stdout and stderr interleave in
    // the log exactly as their data events arrive).
    const buffers: RedactingStreamBuffer[] = [];
    const tee = (stream: NodeJS.ReadableStream | null | undefined) => {
      if (!stream) return;
      if (redact.length === 0) {
        stream.on("data", (chunk: Buffer | string) => emit(chunk));
        return;
      }
      const buffer = new RedactingStreamBuffer(redact);
      buffers.push(buffer);
      stream.on("data", (chunk: Buffer | string) => emit(buffer.push(chunk)));
    };
    tee(child.stdout);
    tee(child.stderr);

    // The raw spawn error is not kept as `cause`: its message may carry the
    // secret, and util.inspect prints causes verbatim.
    child.on("error", (err) => {
      out.end();
      reject(redactedError(err));
    });
    child.on("close", (code) => {
      for (const buffer of buffers) emit(buffer.flush());
      render.end();
      const finish = () => {
        out.end((err?: Error | null) => {
          const failure = err ?? logError;
          if (failure) reject(redactedError(failure));
          else if (relay) resolve({ exitCode: code ?? 1, hitl: relay.record });
          else resolve({ exitCode: code ?? 1 });
        });
      };
      if (relay) relay.closed().then(finish, finish);
      else finish();
    });
  });
}

interface Relay {
  /** Set when the transport could not be attached (no writable stdin). */
  startError: Error | null;
  record: HitlRunRecord;
  feed(text: string | Buffer): void;
  /** Resolves once the child has closed and any open prompt has settled. */
  closed(): Promise<void>;
  /** Operator stop outside a gate: record it, end stdin, signal past the grace. */
  stop(stop: HitlStop): void;
}

/**
 * Per-run relay: first prompt on stdin, gate detection at every `result`,
 * one operator decision per gate. Rule for the stream-json transport: a
 * `result` that is not a gate ends stdin so the child exits (it idles after
 * every turn until stdin ends); a gate with a reply keeps stdin open for the
 * next turn; a gate without a reply ends stdin and, past a grace period,
 * signals the child.
 */
function createRelay(
  hitl: SpawnHitlOptions,
  child: ReturnType<typeof spawn>,
  redactedError: (err: unknown) => Error,
): Relay {
  const record = emptyHitlRecord();
  const stdinTransport = hitl.transport.kind === "stdin-stream-json";
  const abort = new AbortController();
  const grace = hitl.killAfterMs ?? HITL_KILL_GRACE_MS;
  let startError: Error | null = null;
  let closed = false;
  let stdinEnded = false;
  let pendingAsk: Promise<void> | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let resolveClosed: () => void = () => {};
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const stdin = child.stdin;
  if (hitl.transport.kind === "stdin-stream-json") {
    if (!stdin) {
      startError = new Error("claude child has no writable stdin (stream-json transport)");
    } else {
      // EPIPE after the child died is not a run failure; the exit code is.
      stdin.on("error", () => {});
      try {
        stdin.write(userEventLine(hitl.transport.firstPrompt));
      } catch (err) {
        startError = redactedError(err);
      }
    }
  }

  const endStdin = () => {
    if (!stdinTransport || stdinEnded) return;
    stdinEnded = true;
    try {
      stdin?.end();
    } catch {
      // Already closed by the child.
    }
  };

  const stopChild = () => {
    endStdin();
    const term = setTimeout(() => {
      if (closed) return;
      child.kill("SIGTERM");
      const kill = setTimeout(() => {
        if (!closed) child.kill("SIGKILL");
      }, grace);
      kill.unref?.();
      timers.push(kill);
    }, grace);
    term.unref?.();
    timers.push(term);
  };

  const watcher = new TurnWatcher(({ resultText, assistantTexts }) => {
    if (record.stop || closed) return;
    const gate = detectHitlGate(resultText, assistantTexts);
    if (!gate) {
      endStdin();
      return;
    }
    if (gate.detection === "fallback") record.fallbackDetections += 1;
    if (hitl.transport.kind === "none") {
      record.stop = noRelayStop(gate.askId, hitl.transport.backend);
      return;
    }
    const ask = askOperator(gate, {
      isTTY: hitl.isTTY,
      policy: hitl.policy,
      readAnswer: hitl.readAnswer,
      write: hitl.write,
      signal: abort.signal,
      onPromptStart: hitl.onPromptStart,
      onPromptEnd: hitl.onPromptEnd,
    }).then(
      (outcome) => {
        if (record.stop) return;
        if (outcome.kind === "stop") {
          record.stop = outcome.stop;
          stopChild();
          return;
        }
        if (closed || !stdin) {
          record.stop = unansweredStop(gate.askId, "child exited");
          return;
        }
        record.replies.push(outcome.stamp);
        hitl.write(`→ ${outcome.stamp.line}
`);
        stdin.write(userEventLine(outcome.stamp.line));
      },
      (err) => {
        record.stop = unansweredStop(gate.askId, "child exited");
        hitl.write(`hitl relay: ${redactedError(err).message}
`);
        stopChild();
      },
    );
    pendingAsk = ask;
  });

  child.on("close", () => {
    closed = true;
    for (const t of timers) clearTimeout(t);
    abort.abort();
    watcher.end();
    const settle = () => resolveClosed();
    if (pendingAsk) pendingAsk.then(settle, settle);
    else settle();
  });

  return {
    startError,
    record,
    feed: (text) => watcher.feed(text),
    closed: () => closedPromise,
    stop: (stop) => {
      if (closed || record.stop) return;
      record.stop = stop;
      stopChild();
    },
  };
}

export const cursorAgentBackend: AgentBackend = {
  id: "cursor-agent",
  async resolve() {
    return whichBinary("cursor-agent");
  },
  async run(opts) {
    const args = [
      "-p",
      "--force",
      "--sandbox",
      "disabled",
      "--output-format",
      "stream-json",
      "--workspace",
      opts.workspace,
    ];
    if (opts.model) {
      args.push("--model", opts.model);
    }
    args.push(opts.prompt);
    // Same redaction as the claude backend: cursor-agent does not read the
    // ANTHROPIC_* keys, but the child inherits them (process.env, or the
    // merged override) and a tick can print its environment, so any value
    // present is elided from the console echo, the tick log and every error.
    const env = opts.env ? mergeChildEnv(opts.env) : undefined;
    // No input channel on cursor-agent: a gate is detected and recorded as an
    // honest stop (ADR 2026-09-19 point 1, relay capability `none`).
    return spawnLogged("cursor-agent", args, opts.logPath, {
      spawnFn: opts.spawnFn,
      env,
      redact: claudeRedactions(env ?? process.env),
      hitl: resolveHitlRunOptions(opts.hitl, { kind: "none", backend: "cursor-agent" }),
      render: opts.render,
      onSpawn: opts.onSpawn,
      backendId: "cursor-agent",
    });
  },
};

/** Oldest claude CLI that accepts `--permission-prompts` (code.claude.com/docs/en/headless). */
export const CLAUDE_MIN_VERSION = "2.1.259";

/** Parse `2.1.261 (Claude Code)` style output; null when unparsable. */
export function parseClaudeVersion(raw: string | null): string | null {
  if (!raw) return null;
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const claudeVersionCache = new Map<string, string | null>();

function defaultVersionFn(bin: string): string | null {
  try {
    return execFileSync(bin, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

export type ClaudeVersionCheck =
  | { ok: true; version: string | null; warning?: string }
  | { ok: false; version: string; message: string };

/**
 * Version guard for the headless flags. An older binary fails at parse time
 * with `error: unknown option '--permission-prompts'` and exit 1, which the
 * loop would only report as "claude exited with code 1"; this names the real
 * cause instead. Unparsable output warns and does not block. Memoized per
 * process so a loop asks `claude --version` once, not once per tick.
 */
export function checkClaudeVersion(
  bin: string,
  versionFn: VersionFn = defaultVersionFn,
): ClaudeVersionCheck {
  if (!claudeVersionCache.has(bin)) {
    claudeVersionCache.set(bin, parseClaudeVersion(versionFn(bin)));
  }
  const version = claudeVersionCache.get(bin) ?? null;
  if (version === null) {
    return {
      ok: true,
      version: null,
      warning: `claude tick: could not read \`claude --version\`; the tick needs claude >= ${CLAUDE_MIN_VERSION} (--permission-prompts). Continuing.`,
    };
  }
  if (compareVersions(version, CLAUDE_MIN_VERSION) < 0) {
    return {
      ok: false,
      version,
      message: `claude ${version} is older than ${CLAUDE_MIN_VERSION}, the first release that accepts \`--permission-prompts none\`. Run \`claude update\` and retry.`,
    };
  }
  return { ok: true, version };
}

/** Test seam: clear the memoized `claude --version` result. */
export function resetClaudeVersionCache(): void {
  claudeVersionCache.clear();
}

/**
 * Headless `claude -p` argv shared by the tick backend (`run-plan --backend
 * claude`) and the one-shot dispatch (`agent-kit run <slash>`). Flags
 * confirmed against `claude --help` 2.1.261 and code.claude.com/docs/en/headless:
 * - `--output-format stream-json --verbose`: NDJSON events; the final
 *   `{type:"result"}` line is what sentinel.ts prefers for LOOP_TICK_RESULT
 *   and carries `is_error` / `subtype` for the loop's stop message.
 * - `--input-format stream-json --replay-user-messages`: the prompt is not
 *   positional; it is written to stdin as the first `user` event and every
 *   operator reply to a HITL gate follows as another one in the same session
 *   (ADR 2026-09-19). The child echoes each `user` event into the NDJSON
 *   stream (`isReplay: true`), so the reply stamp lands in the log authored
 *   by the child. After a turn the child idles until stdin ends.
 * - `--dangerously-skip-permissions`: parity with cursor-agent
 *   `--force --sandbox disabled` (the run edits plan/HANDOFF and runs
 *   /git-staging; `-p` alone starts read-only and every Edit/Write/Bash
 *   request is denied with nobody to answer). Refused by claude as root/sudo.
 * - `--permission-prompts none` (claude >= 2.1.259): anything that would still
 *   prompt is denied immediately and AskUserQuestion is removed, so the
 *   `.claude/commands` adapters take their numbered-list HITL branch.
 * - `--max-turns` / `--max-budget-usd` (print-only): opt-in runaway caps from
 *   `AGENT_KIT_CLAUDE_MAX_TURNS` / `AGENT_KIT_CLAUDE_MAX_BUDGET_USD`; no default.
 * No `--cwd` exists on the root command: the working directory is set on spawn.
 */
export function claudeHeadlessArgs(opts: { model?: string } & ClaudeRunCaps = {}): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--permission-prompts",
    "none",
    "--input-format",
    "stream-json",
    "--replay-user-messages",
  ];
  if (opts.maxTurns !== undefined) {
    args.push("--max-turns", String(opts.maxTurns));
  }
  if (opts.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  }
  if (opts.model) {
    args.push("--model", opts.model);
  }
  return args;
}

/** Tick argv: the shared headless argv (kept as a named alias for the loop). */
export const claudeTickArgs = claudeHeadlessArgs;

/**
 * A prompt that opens with `/<name>` is a slash command; under `claude -p` it
 * expands `<workspace>/.claude/commands/<name>.md` (the thin adapter that
 * points at the `.cursor/commands` SoT). Without the adapter the whole prompt
 * is sent as literal text to a session running with permissions bypassed, so
 * the backend fails closed. Adapters are generated by `agent-kit install
 * --claude` (opt-in). Returns null when the prompt carries no leading slash.
 */
export async function missingClaudeAdapter(
  workspace: string,
  prompt: string,
): Promise<string | null> {
  const m = /^\/([A-Za-z0-9][A-Za-z0-9_-]*)/.exec(prompt.trimStart());
  if (!m?.[1]) return null;
  const rel = path.join(".claude", "commands", `${m[1]}.md`);
  try {
    await access(path.join(workspace, rel));
    return null;
  } catch {
    return rel;
  }
}

/**
 * Claude Code tick backend. Same spawnLogged contract as cursor-agent.
 *
 * History: reserved (threw "not implemented") since ADR
 * 2026-08-13_claude-cli-ultracode-orchestration-thin-adapter.md:13 ("headless
 * kit ticks stay cursor-agent until an explicit later plan implements
 * --backend claude"); plan major-tom `phase1-claude-backend` wired it.
 *
 * Collision, named not merged: `externalPlanReview.backend: "claude"` in
 * .cursor/context/config.json selects the post-hoc audits REVIEWER
 * (external-review.ts + .cursor/scripts/plan-external-review.sh). This backend
 * selects the tick IMPLEMENTER. Different code, different value sets.
 *
 * Anthropic-protocol endpoints only (`ANTHROPIC_BASE_URL`); no second ACP
 * listener and no `--backend deepseek` — see ADR 2026-08-22 deepseek-harness
 * concept #9.
 */
export const claudeBackend: AgentBackend = {
  id: "claude",
  async resolve() {
    return whichBinary("claude");
  },
  async run(opts) {
    const log = opts.log ?? ((line: string) => console.log(line));
    const env = claudeChildEnv(opts.env);
    const redact = claudeRedactions(env);

    const version = checkClaudeVersion("claude", opts.versionFn);
    if (!version.ok) {
      throw new Error(`claude backend: ${version.message}`);
    }
    if (version.warning) log(version.warning);

    const adapter = await missingClaudeAdapter(opts.workspace, opts.prompt);
    if (adapter) {
      throw new Error(
        `claude backend: ${adapter} is missing in the workspace, so the tick's leading slash would be sent as literal text. Generate the Claude Code adapters with \`agent-kit install --claude\` and retry.`,
      );
    }

    const { caps, invalid } = claudeRunCaps(env);
    for (const problem of invalid)
      log(`claude tick: ignoring invalid ${problem}; running uncapped.`);
    const capText = [
      caps.maxTurns !== undefined ? `max-turns=${caps.maxTurns}` : null,
      caps.maxBudgetUsd !== undefined ? `max-budget-usd=${caps.maxBudgetUsd}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const presence = CLAUDE_ENV_PASSTHROUGH.map(
      (key) => `${key}=${env[key] ? "set" : "unset"}`,
    ).join(" ");
    // Tip prints presence only: no values, no workspace path (visual-kit ADR point 4).
    log(
      `claude tick: claude -p (bypass permissions, stream-json, stdin relay${capText ? `, ${capText}` : ""}). env: ${presence}`,
    );
    const args = claudeHeadlessArgs({ model: opts.model, ...caps });
    try {
      return await spawnLogged("claude", args, opts.logPath, {
        cwd: opts.workspace,
        env,
        spawnFn: opts.spawnFn,
        redact,
        hitl: resolveHitlRunOptions(opts.hitl, {
          kind: "stdin-stream-json",
          firstPrompt: opts.prompt,
        }),
        render: opts.render,
        onSpawn: opts.onSpawn,
        backendId: "claude",
      });
    } catch (err) {
      // No `cause`: the raw error may carry the secret (see spawnLogged).
      throw new Error(`claude backend failed to start: ${redactSecrets(String(err), redact)}`);
    }
  },
};

const BACKENDS: Record<BackendId, AgentBackend> = {
  "cursor-agent": cursorAgentBackend,
  claude: claudeBackend,
};

export function getBackend(id: string): AgentBackend {
  const backend = BACKENDS[id as BackendId];
  if (!backend) {
    throw new Error(`Unknown backend '${id}'. Supported: ${Object.keys(BACKENDS).join(", ")}`);
  }
  return backend;
}

export function listBackendIds(): BackendId[] {
  return Object.keys(BACKENDS) as BackendId[];
}
