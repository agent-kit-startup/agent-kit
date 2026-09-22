/**
 * Live feed for the Mission Control TUI on the headless run lane (ADR
 * 2026-09-19 point 5). A `StreamSink` that consumes the same post-redaction
 * text the run log receives, parses it with the Phase 1 parser and keeps an
 * in-memory model: Flight Log lines (the Phase 1 status lines, uncolored),
 * the current tool, cost and turns so far, rate-limit state, the last result
 * and the open HITL gate. Nothing here reads the log file or spawns a
 * process; the log stays byte-identical because the feed only observes the
 * tee. Parsing never throws into the tee.
 */

import { StringDecoder } from "node:string_decoder";
import type { HitlGate } from "../plan-loop/hitl-relay.js";
import { parseStreamLine } from "../plan-loop/stream-events.js";
import { type StreamSink, renderStreamEvent } from "../plan-loop/stream-render.js";
import { type InputLine, ScrollRegion } from "./render.js";

export type LiveLogKind =
  | "text"
  | "tool"
  | "result"
  | "hook"
  | "rate_limit"
  | "prompt"
  | "hitl"
  | "note"
  | "error";

export interface LiveLogLine {
  kind: LiveLogKind;
  text: string;
}

export type LiveRunPhase = "starting" | "running" | "gate" | "stopping" | "done";

export interface LiveCrew {
  backend: string | null;
  pid: number | undefined;
  phase: LiveRunPhase;
  startedAt: number;
  costUsd?: number;
  turns?: number;
  toolCalls: number;
  currentTool: { name: string; summary: string } | null;
  lastResult: { ok: boolean; status: string } | null;
  rateLimit: { line: string; severe: boolean } | null;
  logPath: string | null;
}

/** Default Flight Log capacity (lines kept in memory). */
export const LIVE_LOG_CAPACITY = 500;

/** A held partial line longer than this is dropped from the feed (the log keeps it). */
const PENDING_MAX_CHARS = 4 * 1024 * 1024;

export interface LiveRunFeedOptions {
  columns?: number;
  now?: () => number;
  capacity?: number;
  backend?: string | null;
  logPath?: string | null;
}

/**
 * In-memory model of one headless run, fed by the backend tee. `feed` and
 * `end` implement `StreamSink`; `note` lets the run lane append its own
 * status lines (tips, gate prompt, relayed stamps) so nothing else writes to
 * the terminal while the TUI owns it.
 */
export class LiveRunFeed implements StreamSink {
  readonly log: ScrollRegion<LiveLogLine>;
  readonly crew: LiveCrew;
  gate: HitlGate | null = null;
  hitlReplies = 0;
  private pending = "";
  private dropped = false;
  private readonly decoder = new StringDecoder("utf8");
  private readonly columns: number;
  private version = 0;

  constructor(opts: LiveRunFeedOptions = {}) {
    this.columns = Math.max(40, opts.columns ?? 80);
    this.log = new ScrollRegion<LiveLogLine>(opts.capacity ?? LIVE_LOG_CAPACITY);
    this.crew = {
      backend: opts.backend ?? null,
      pid: undefined,
      phase: "starting",
      startedAt: (opts.now ?? Date.now)(),
      toolCalls: 0,
      currentTool: null,
      lastResult: null,
      rateLimit: null,
      logPath: opts.logPath ?? null,
    };
  }

  /** Bumps on every change; a paint loop can skip a frame when nothing moved. */
  get revision(): number {
    return this.version;
  }

  setProcess(info: { backend: string; pid: number | undefined }): void {
    this.crew.backend = info.backend;
    this.crew.pid = info.pid;
    if (this.crew.phase === "starting") this.crew.phase = "running";
    this.version += 1;
  }

  setPhase(phase: LiveRunPhase): void {
    this.crew.phase = phase;
    this.version += 1;
  }

  openGate(gate: HitlGate): void {
    this.gate = gate;
    this.crew.phase = "gate";
    this.version += 1;
  }

  closeGate(): void {
    this.gate = null;
    if (this.crew.phase === "gate") this.crew.phase = "running";
    this.version += 1;
  }

  /** Append a status line the run lane produced itself (never from the stream). */
  note(text: string, kind: LiveLogKind = "note"): void {
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trimEnd();
      if (trimmed) this.log.push({ kind, text: trimmed });
    }
    this.version += 1;
  }

  feed(chunk: string | Buffer): void {
    try {
      const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
      if (!text) return;
      const combined = this.pending + text;
      const lines = combined.split("\n");
      this.pending = lines.pop() ?? "";
      for (const line of lines) {
        if (this.dropped) {
          this.dropped = false;
          continue;
        }
        this.takeLine(line);
      }
      if (this.pending.length > PENDING_MAX_CHARS) {
        this.pending = "";
        this.dropped = true;
      }
    } catch {
      // The tee must never see a feed failure; the log has the bytes.
    }
  }

  end(): void {
    try {
      const rest = this.pending + this.decoder.end();
      this.pending = "";
      if (rest && !this.dropped) this.takeLine(rest);
      this.dropped = false;
      this.crew.currentTool = null;
      if (this.crew.phase !== "done") this.crew.phase = "done";
      this.version += 1;
    } catch {
      // Same contract as feed(): never propagate.
    }
  }

  private takeLine(line: string): void {
    for (const event of parseStreamLine(line)) {
      const rendered = renderStreamEvent(event, { color: false, columns: this.columns });
      if (rendered === null) continue;
      switch (event.kind) {
        case "text":
          this.note(rendered, "text");
          break;
        case "tool_use":
          this.crew.toolCalls += 1;
          this.crew.currentTool = { name: event.name, summary: event.summary };
          this.note(rendered, "tool");
          break;
        case "tool_result":
          this.crew.currentTool = null;
          this.note(rendered, event.ok ? "tool" : "error");
          break;
        case "result":
          this.crew.currentTool = null;
          this.crew.lastResult = { ok: event.ok, status: event.status };
          if (event.costUsd !== undefined) this.crew.costUsd = event.costUsd;
          if (event.turns !== undefined) this.crew.turns = event.turns;
          this.note(rendered, event.ok ? "result" : "error");
          break;
        case "hook":
          this.note(rendered, "hook");
          break;
        case "rate_limit":
          this.crew.rateLimit = { line: event.line, severe: event.severe };
          this.note(rendered, "rate_limit");
          break;
        case "prompt":
          this.note(rendered, "prompt");
          break;
        case "hitl_reply":
          this.hitlReplies += 1;
          this.note(rendered, "hitl");
          break;
        default:
          break;
      }
    }
  }
}

export interface McLiveMission {
  planFile: string | null;
  mode: string | null;
  todos: { done: number; total: number };
  currentTodo: string | null;
  nextTodo: string | null;
  /** Present on a `run-plan-all` HANDOFF (Run queue / Queue cursor, read-only). */
  queue: { done: number; total: number; current: string | null; status: string | null } | null;
}

export interface McLiveChecklistRow {
  label: string;
  state: "done" | "current" | "pending";
}

export interface McLiveGate {
  askId: string;
  labels: string[];
  detection: HitlGate["detection"];
  input: InputLine;
}

export interface McLiveView {
  mission: McLiveMission;
  gate: McLiveGate | null;
  flightLog: ScrollRegion<LiveLogLine>;
  checklist: McLiveChecklistRow[];
  crew: LiveCrew;
  error: string | null;
}

export function emptyLiveMission(): McLiveMission {
  return {
    planFile: null,
    mode: null,
    todos: { done: 0, total: 0 },
    currentTodo: null,
    nextTodo: null,
    queue: null,
  };
}
