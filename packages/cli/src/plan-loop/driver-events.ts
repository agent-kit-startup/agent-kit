/**
 * Driver mode (`agent-kit run-plan --events ndjson`): the machine-readable
 * seam an app (a desktop app, a CI script, any client without a TTY) uses to
 * drive the headless runner over pipes.
 *
 * - stdout carries only NDJSON events, one JSON object per line, each with
 *   `v` (protocol major) and `type`. Human-oriented lines go out as `log`
 *   events; nothing else is written to stdout while the mode is on.
 * - stdin carries the app's answers, one JSON object per line. The only
 *   answers are `hitl_reply` (to the open gate) and `stop`.
 *
 * No second tick dialect (ADR 2026-08-13, 2026-09-19): events wrap the same
 * four sentinels verbatim (`tick_start.prompt` is TICK_PROMPT,
 * `hitl_gate.line` is the `HITL_GATE:` line, the child's own replay of the
 * `HITL_REPLY:` stamp arrives as an `agent_event`, `tick_end.result` is the
 * `LOOP_TICK_RESULT:` line). A reply is resolved by the same
 * `resolveOperatorAnswer` as the terminal path, so the stamp written to the
 * child is byte-identical. Never a default answer: a reply whose `askId` is
 * not the open gate, a line that is not JSON, or EOF stops the run (exit 4).
 *
 * Node built-ins only (thin-deps ADRs 2026-08-27, 2026-09-05).
 * Contract doc: docs/driver-events-protocol.md.
 */

import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import {
  type AnswerReader,
  type HitlGate,
  type HitlReplyStamp,
  type HitlStop,
  type RawAnswer,
  formatHitlGateLine,
} from "./hitl-relay.js";
import type { StreamSink } from "./stream-render.js";

/** Protocol major carried by every event as `v`. Bumped only on a breaking change. */
export const DRIVER_PROTOCOL_MAJOR = 1;
/** Full protocol version announced in `run_start` (SemVer; minor = additive fields/events). */
export const DRIVER_PROTOCOL_VERSION = "1.1.0";
/** The only `--events` value accepted today. */
export const DRIVER_EVENTS_FORMATS = ["ndjson"] as const;
export type DriverEventsFormat = (typeof DRIVER_EVENTS_FORMATS)[number];

/** Longest inbound line accepted before it is treated as a protocol error. */
const INBOUND_MAX_CHARS = 64 * 1024;
/** A held partial child line longer than this is dropped (the tick log keeps it). */
const AGENT_PENDING_MAX_CHARS = 4 * 1024 * 1024;

export interface DriverTickSentinel {
  kind: "continue" | "stop" | "missing";
  reason?: string;
  /** The verbatim `LOOP_TICK_RESULT:` line, or null when the tick printed none. */
  line: string | null;
}

/** Outbound events (stdout). Every event also carries `v` and `ts`. */
export type DriverEvent =
  | {
      type: "run_start";
      protocol: string;
      backend: string;
      plan: string;
      pending: number;
      maxTicks: number;
      hitl: "driver" | "off";
    }
  | {
      type: "tick_start";
      tick: number;
      maxTicks: number;
      pending: number;
      log: string;
      prompt: string;
      /** Backend running this tick (1.1.0; changes only under `--on-limit`). */
      backend: string;
    }
  | { type: "agent_event"; tick: number; event: Record<string, unknown> }
  | { type: "agent_text"; tick: number; text: string }
  | {
      type: "hitl_gate";
      tick: number;
      askId: string;
      labels: string[];
      detection: HitlGate["detection"];
      line: string;
    }
  | {
      type: "tick_end";
      tick: number;
      /** Backend that ran this tick (1.1.0). */
      backend: string;
      /** Vendor usage-limit stop seen in this tick, or null (1.1.0). */
      limit: { source: "rate_limit_event" | "result" | "stderr"; detail: string } | null;
      exitCode: number;
      pendingBefore: number;
      pendingAfter: number | null;
      result: DriverTickSentinel | null;
      replies: Pick<HitlReplyStamp, "askId" | "reply" | "label" | "line" | "at">[];
      stop: Pick<HitlStop, "askId" | "cause" | "message" | "exitCode"> | null;
    }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | {
      type: "run_end";
      exitCode: number;
      ticks: number;
      pending: number | null;
      reason: string;
      planExhausted: boolean;
    };

export type DriverEventType = DriverEvent["type"];

/** All outbound event types, in the order a run can emit them (contract test pin). */
export const DRIVER_EVENT_TYPES: readonly DriverEventType[] = [
  "run_start",
  "tick_start",
  "agent_event",
  "agent_text",
  "hitl_gate",
  "tick_end",
  "log",
  "run_end",
];

/** One NDJSON line for an event (`v` and `ts` first, so a client can switch on them cheaply). */
export function formatDriverEvent(event: DriverEvent, now: () => Date = () => new Date()): string {
  return `${JSON.stringify({ v: DRIVER_PROTOCOL_MAJOR, ts: now().toISOString(), ...event })}\n`;
}

export interface DriverEmitter {
  emit(event: DriverEvent): void;
}

/** Emitter over a writer (default: process.stdout). Write failures are swallowed: the run decides its exit. */
export function createDriverEmitter(
  write: (text: string) => void = (text) => {
    process.stdout.write(text);
  },
  now?: () => Date,
): DriverEmitter {
  return {
    emit(event) {
      try {
        write(formatDriverEvent(event, now));
      } catch {
        // A closed pipe on the app side is not a reason to crash the run.
      }
    },
  };
}

/** Inbound messages (stdin). */
export type DriverInbound =
  | { type: "hitl_reply"; askId: string; reply: number | string }
  | { type: "stop"; reason?: string };

export type DriverInboundParse =
  | { ok: true; message: DriverInbound }
  | { ok: false; error: string };

/**
 * Parse one inbound line. `hitl_reply.reply` is a 1-based number, an exact
 * label, or free text (sent to the agent as `operator reply other`), the same
 * three shapes the terminal accepts. An empty string is not a reply.
 */
export function parseDriverInbound(line: string): DriverInboundParse {
  const text = line.trim();
  if (text.length > INBOUND_MAX_CHARS) return { ok: false, error: "line too long" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "not JSON" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "not a JSON object" };
  }
  const msg = value as {
    v?: unknown;
    type?: unknown;
    askId?: unknown;
    reply?: unknown;
    reason?: unknown;
  };
  if (msg.v !== undefined && msg.v !== DRIVER_PROTOCOL_MAJOR) {
    return { ok: false, error: `unsupported protocol v${String(msg.v)}` };
  }
  if (msg.type === "stop") {
    return {
      ok: true,
      message: { type: "stop", ...(typeof msg.reason === "string" ? { reason: msg.reason } : {}) },
    };
  }
  if (msg.type !== "hitl_reply")
    return { ok: false, error: `unknown type ${JSON.stringify(msg.type)}` };
  if (typeof msg.askId !== "string" || !/^[a-z0-9-]+$/.test(msg.askId)) {
    return { ok: false, error: "hitl_reply.askId must be a kebab-case string" };
  }
  if (typeof msg.reply === "number") {
    if (!Number.isInteger(msg.reply) || msg.reply < 1) {
      return { ok: false, error: "hitl_reply.reply number must be a positive integer" };
    }
    return { ok: true, message: { type: "hitl_reply", askId: msg.askId, reply: msg.reply } };
  }
  if (typeof msg.reply === "string" && msg.reply.trim() && !/[\r\n]/.test(msg.reply)) {
    return { ok: true, message: { type: "hitl_reply", askId: msg.askId, reply: msg.reply.trim() } };
  }
  return { ok: false, error: "hitl_reply.reply must be a number or a one-line non-empty string" };
}

/**
 * Map one inbound message to the raw answer for `gate`. A reply to another
 * gate is a protocol error, never re-routed; `stop` is the app's
 * skip/cancel. The reply text goes through `resolveOperatorAnswer`
 * downstream exactly like a typed line.
 */
export function inboundToRawAnswer(gate: HitlGate, parsed: DriverInboundParse): RawAnswer {
  if (!parsed.ok) return { kind: "stop", cause: "protocol error", detail: parsed.error };
  const message = parsed.message;
  if (message.type === "stop") return { kind: "stop", cause: "driver stop" };
  if (message.askId !== gate.askId) {
    return {
      kind: "stop",
      cause: "protocol error",
      detail: `reply for ${message.askId} while gate ${gate.askId} is open`,
    };
  }
  return { kind: "line", text: String(message.reply) };
}

export interface DriverAnswerReaderOptions {
  /** Where answers come from (default: process.stdin). */
  input?: NodeJS.ReadableStream;
  emitter: DriverEmitter;
  /** Current tick number, stamped on the `hitl_gate` event. */
  tick: () => number;
}

export interface DriverAnswerReader {
  read: AnswerReader;
  /** Release stdin (call once at run end). */
  close(): void;
}

/**
 * Answer reader for driver mode. One `node:readline` interface lives for the
 * whole run (stdin is a pipe: a per-gate interface would lose buffered
 * lines). At each gate it emits `hitl_gate` and takes the next inbound line.
 * Lines that arrive while no gate is open are queued and checked against the
 * gate that is open when they are read (a stale reply is a protocol error).
 * Stream end is EOF: the run stops with no default.
 */
export function createDriverAnswerReader(opts: DriverAnswerReaderOptions): DriverAnswerReader {
  const input = opts.input ?? process.stdin;
  const queue: string[] = [];
  let ended = false;
  let waiter: ((line: string | null) => void) | null = null;
  let rl: ReturnType<typeof createInterface> | null = null;

  const ensure = () => {
    if (rl) return;
    rl = createInterface({ input, terminal: false, crlfDelay: Number.POSITIVE_INFINITY });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(line);
      } else queue.push(line);
    });
    rl.on("close", () => {
      ended = true;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(null);
      }
    });
  };

  const nextLine = (signal?: AbortSignal): Promise<string | null> =>
    new Promise((resolve) => {
      const queued = queue.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      if (ended) {
        resolve(null);
        return;
      }
      const onAbort = () => {
        if (waiter === settle) waiter = null;
        resolve(null);
      };
      const settle = (line: string | null) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(line);
      };
      if (signal?.aborted) {
        resolve(null);
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      waiter = settle;
    });

  return {
    read: async (gate, readOpts) => {
      ensure();
      opts.emitter.emit({
        type: "hitl_gate",
        tick: opts.tick(),
        askId: gate.askId,
        labels: [...gate.labels],
        detection: gate.detection,
        line: formatHitlGateLine(gate),
      });
      const line = await nextLine(readOpts.signal);
      if (line === null) return { kind: "eof" };
      return inboundToRawAnswer(gate, parseDriverInbound(line));
    },
    close: () => {
      const r = rl;
      rl = null;
      r?.close();
      if (typeof (input as NodeJS.ReadStream).pause === "function") {
        (input as NodeJS.ReadStream).pause();
      }
    },
  };
}

/**
 * Terminal side of the backend tee in driver mode: every complete child line
 * (already redacted by `RedactingStreamBuffer`, the only text this sink
 * sees) becomes one `agent_event` envelope when it is a JSON object, else one
 * `agent_text`. The envelope keeps the child's own `type` from colliding
 * with the driver's. The tick log still receives the raw bytes.
 */
export class DriverAgentSink implements StreamSink {
  private pending = "";
  private dropped = false;
  private readonly decoder = new StringDecoder("utf8");

  constructor(
    private readonly emitter: DriverEmitter,
    private readonly tick: number,
  ) {}

  feed(chunk: string | Buffer): void {
    try {
      const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
      if (!text) return;
      const lines = (this.pending + text).split("\n");
      this.pending = lines.pop() ?? "";
      for (const line of lines) {
        if (this.dropped) {
          this.dropped = false;
          continue;
        }
        this.take(line);
      }
      if (this.pending.length > AGENT_PENDING_MAX_CHARS) {
        this.pending = "";
        this.dropped = true;
      }
    } catch {
      // Never propagate into the tee: the log has the bytes.
    }
  }

  end(): void {
    try {
      const rest = this.pending + this.decoder.end();
      this.pending = "";
      if (rest && !this.dropped) this.take(rest);
      this.dropped = false;
    } catch {
      // Same contract as feed().
    }
  }

  private take(raw: string): void {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) return;
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try {
        const event = JSON.parse(trimmed) as unknown;
        if (typeof event === "object" && event !== null && !Array.isArray(event)) {
          this.emitter.emit({
            type: "agent_event",
            tick: this.tick,
            event: event as Record<string, unknown>,
          });
          return;
        }
      } catch {
        // Not JSON: forwarded as text below.
      }
    }
    this.emitter.emit({ type: "agent_text", tick: this.tick, text: line });
  }
}
