/**
 * Terminal renderer for a headless agent stream. It consumes the text a
 * backend tee emits (complete lines after redaction), rebuilds line
 * boundaries itself, and writes readable status lines instead of raw NDJSON:
 * assistant text, tool calls, tool results, hooks, rate limits and the final
 * result. The tick log still receives every byte; only the terminal echo
 * changes. Color follows the visual-kit gate (TTY only; off under NO_COLOR,
 * NODE_DISABLE_COLORS, FORCE_COLOR=0, CI); plain mode prints the same lines
 * without ANSI. A line that is not JSON prints nothing.
 */

import { StringDecoder } from "node:string_decoder";
import { trueColor } from "kolorist";
import {
  HELMET_ACCENT,
  LABEL_MUTED,
  SPACE_MARKS,
  STATUS_ERR,
  STATUS_OK,
  STATUS_WARN,
  shouldUseWelcomeColor,
  withKoloristColor,
} from "../welcome/visual-kit.js";
import { type StreamEvent, oneLine, parseStreamLine } from "./stream-events.js";

/** Sink for the terminal side of a backend tee. */
export interface StreamSink {
  feed(text: string | Buffer): void;
  end(): void;
}

export interface StreamRendererOptions {
  /** Terminal writer (default: process.stdout.write at call time). */
  write?: (text: string) => void;
  /** Whether stdout is a TTY (default: process.stdout.isTTY). */
  isTTY?: boolean;
  /** Environment for the color gate (default: process.env). */
  env?: NodeJS.ProcessEnv;
  /** Terminal width for one-line summaries (default: process.stdout.columns or 80). */
  columns?: number;
}

/** A held partial line longer than this is discarded unrendered (the log keeps it). */
const PENDING_MAX_CHARS = 4 * 1024 * 1024;
const MIN_COLUMNS = 40;

function paint(hex: string, text: string, color: boolean): string {
  if (!color) return text;
  return withKoloristColor(() =>
    trueColor(
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    )(text),
  );
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(1, width - 1))}…`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}m ${rest}s`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(usd < 0.1 ? 4 : 2)}`;
}

/**
 * Render one parsed event as a terminal line (without trailing newline), or
 * null when the event prints nothing. Assistant text is returned verbatim.
 */
export function renderStreamEvent(
  event: StreamEvent,
  opts: { color: boolean; columns: number },
): string | null {
  const width = Math.max(MIN_COLUMNS, opts.columns);
  const color = opts.color;
  switch (event.kind) {
    case "text":
      return event.text;
    case "tool_use": {
      const head = `${SPACE_MARKS.diamond} ${event.name}`;
      const summary = truncate(event.summary, width - head.length - 3);
      return paint(HELMET_ACCENT, summary ? `${head} ${SPACE_MARKS.tick} ${summary}` : head, color);
    }
    case "tool_result": {
      const label = event.ok ? "ok" : "error";
      const head = `  ${SPACE_MARKS.tick} ${label}`;
      const line = truncate(oneLine(event.line), width - head.length - 3);
      const text = line ? `${head} ${SPACE_MARKS.tick} ${line}` : head;
      return paint(event.ok ? LABEL_MUTED : STATUS_ERR, text, color);
    }
    case "result": {
      const parts = [`${SPACE_MARKS.star} result ${event.status}`];
      if (event.costUsd !== undefined) parts.push(formatCost(event.costUsd));
      if (event.durationMs !== undefined) parts.push(formatDuration(event.durationMs));
      else if (event.apiMs !== undefined) parts.push(`${formatDuration(event.apiMs)} api`);
      if (event.turns !== undefined) {
        parts.push(`${event.turns} turn${event.turns === 1 ? "" : "s"}`);
      }
      return paint(event.ok ? STATUS_OK : STATUS_ERR, parts.join(` ${SPACE_MARKS.tick} `), color);
    }
    case "hook": {
      const detail = event.detail ? ` (${event.detail})` : "";
      return paint(
        LABEL_MUTED,
        truncate(`${SPACE_MARKS.tick} hook ${event.name} ${event.phase}${detail}`, width),
        color,
      );
    }
    case "rate_limit":
      return paint(
        event.severe ? STATUS_ERR : STATUS_WARN,
        truncate(`! rate limit ${SPACE_MARKS.tick} ${event.line}`, width),
        color,
      );
    case "prompt":
      return paint(
        LABEL_MUTED,
        `${SPACE_MARKS.tick} prompt sent ${SPACE_MARKS.tick} ${event.chars} chars`,
        color,
      );
    case "hitl_reply":
      return paint(HELMET_ACCENT, truncate(`↩ ${event.line}`, width), color);
    default:
      return null;
  }
}

/**
 * Line-boundary renderer. `feed` accepts any chunking (the redacting buffer
 * emits batches of complete lines and, past its hold limit, partial lines);
 * complete lines are rendered as they close and the trailing partial line is
 * held until the next feed or `end()`. Rendering errors never propagate.
 */
export class StreamRenderer implements StreamSink {
  private pending = "";
  private dropped = false;
  private textOpen = false;
  private readonly decoder = new StringDecoder("utf8");
  private readonly write: (text: string) => void;
  private readonly color: boolean;
  private readonly columns: number;

  constructor(opts: StreamRendererOptions = {}) {
    this.write = opts.write ?? ((text) => process.stdout.write(text));
    this.color = shouldUseWelcomeColor({
      stdoutIsTTY: opts.isTTY ?? Boolean(process.stdout.isTTY),
      env: opts.env,
    });
    this.columns = opts.columns ?? process.stdout.columns ?? 80;
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
        this.renderLine(line);
      }
      if (this.pending.length > PENDING_MAX_CHARS) {
        this.pending = "";
        this.dropped = true;
      }
    } catch {
      // A rendering failure must not reach the tee; the log has the bytes.
    }
  }

  end(): void {
    try {
      const rest = this.pending + this.decoder.end();
      this.pending = "";
      if (rest && !this.dropped) this.renderLine(rest);
      this.dropped = false;
      this.closeText();
    } catch {
      // Same contract as feed(): never propagate.
    }
  }

  private renderLine(line: string): void {
    for (const event of parseStreamLine(line)) {
      const rendered = renderStreamEvent(event, { color: this.color, columns: this.columns });
      if (rendered === null) continue;
      if (event.kind === "text") {
        this.write(rendered);
        this.textOpen = !rendered.endsWith("\n");
        continue;
      }
      this.closeText();
      this.write(`${rendered}\n`);
    }
  }

  private closeText(): void {
    if (!this.textOpen) return;
    this.textOpen = false;
    this.write("\n");
  }
}

/** Renderer bound to the process terminal (stdout TTY probe, process.env). */
export function createStreamRenderer(opts: StreamRendererOptions = {}): StreamRenderer {
  return new StreamRenderer(opts);
}
