/**
 * ASCII space-vintage renderer for the four Mission Control TUI panels.
 * Tokens and motion/color gates come from the visual kit (no parallel palette).
 */

import { trueColor } from "kolorist";
import {
  HELMET_ACCENT,
  HELMET_FILL,
  HELMET_OUTLINE,
  LABEL_MUTED,
  SPACE_MARKS,
  STATUS_ERR,
  STATUS_INFO,
  STATUS_OK,
  STATUS_WARN,
  type WelcomeRenderOptions,
  shouldUseVisualMotion,
  shouldUseWelcomeColor,
  spinnerFrame,
  withKoloristColor,
  wrapNarrow,
} from "../welcome/visual-kit.js";
import type { McLiveView } from "./live-feed.js";
import type { McTuiView } from "./view.js";

export {
  HELMET_ACCENT,
  HELMET_FILL,
  HELMET_OUTLINE,
  LABEL_MUTED,
  STATUS_ERR,
  STATUS_INFO,
  STATUS_OK,
  STATUS_WARN,
};

const DEFAULT_COLUMNS = 80;
const MIN_COLUMNS = 40;
const INNER_PAD = 2;
const ESC = "\u001b";
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

const STATUS_OK_KEYS = new Set([
  "executing",
  "completed",
  "ok",
  "run_plan",
  "success",
  "done",
  "started",
  "merged",
]);
const STATUS_WARN_KEYS = new Set([
  "awaiting",
  "awaiting_user",
  "warning",
  "handoff",
  "stopped",
  "residual",
]);
const STATUS_ERR_KEYS = new Set(["error", "failed", "fail", "blocked", "incomplete", "fix"]);
const STATUS_INFO_KEYS = new Set([
  "backlog",
  "queued",
  "parked",
  "delivery",
  "memory",
  "activity",
  "advice",
  "prompt",
]);

export type McTuiRenderOptions = WelcomeRenderOptions & {
  columns?: number;
  frameIndex?: number;
};

function hexPaint(hex: string, text: string, color: boolean): string {
  if (!color) return text;
  return withKoloristColor(() =>
    trueColor(
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    )(text),
  );
}

function muted(text: string, color: boolean): string {
  return hexPaint(LABEL_MUTED, text, color);
}

function statusTokenHex(token: string): string {
  const key = token.trim().toLowerCase();
  if (STATUS_OK_KEYS.has(key)) return STATUS_OK;
  if (STATUS_WARN_KEYS.has(key)) return STATUS_WARN;
  if (STATUS_ERR_KEYS.has(key)) return STATUS_ERR;
  if (STATUS_INFO_KEYS.has(key)) return STATUS_INFO;
  return HELMET_OUTLINE;
}

function paintStatus(text: string, color: boolean): string {
  return hexPaint(statusTokenHex(text), text, color);
}

function visibleLength(text: string): number {
  return text.replace(ANSI_RE, "").length;
}

function clipToVisible(text: string, max: number): string {
  if (visibleLength(text) <= max) return text;
  return text.replace(ANSI_RE, "").slice(0, max);
}

function box(title: string, bodyLines: string[], width: number, color: boolean): string[] {
  const inner = Math.max(8, width - 2);
  const label = ` ${title} `;
  const dashCount = Math.max(1, inner - label.length);
  const top = `┌${label}${"─".repeat(dashCount)}┐`;
  const bottom = `└${"─".repeat(inner)}┘`;
  const paintedTop = hexPaint(HELMET_FILL, top, color);
  const paintedBottom = hexPaint(HELMET_OUTLINE, bottom, color);
  const max = inner - INNER_PAD;
  const rows = bodyLines.map((line) => {
    const clipped = clipToVisible(line, max);
    const pad = " ".repeat(Math.max(0, max - visibleLength(clipped)));
    const content = ` ${clipped}${pad} `;
    return `${hexPaint(HELMET_OUTLINE, "│", color)}${content}${hexPaint(HELMET_OUTLINE, "│", color)}`;
  });
  return [paintedTop, ...rows, paintedBottom];
}

function lineOrQuiet(text: string | null, fallback: string): string {
  const trimmed = text?.trim();
  return trimmed ? trimmed : fallback;
}

function labeled(label: string, value: string, color: boolean, valueHex = HELMET_OUTLINE): string {
  return `${hexPaint(LABEL_MUTED, label, color)}${hexPaint(valueHex, value, color)}`;
}

function paintNowLine(flight: McTuiView["flightLog"], color: boolean): string {
  if (!flight.now) {
    return labeled("NOW  ", "All clear", color, STATUS_OK);
  }
  const kind = flight.nowKind?.trim();
  const prefix = kind
    ? `${hexPaint(LABEL_MUTED, "NOW ", color)}${hexPaint(statusTokenHex(kind), `(${kind})`, color)}${hexPaint(HELMET_OUTLINE, "  ", color)}`
    : hexPaint(LABEL_MUTED, "NOW   ", color);
  return `${prefix}${hexPaint(HELMET_OUTLINE, flight.now, color)}`;
}

/**
 * Render one TUI frame. Color/motion follow the visual-kit gates.
 */
export function renderMcTui(view: McTuiView, opts: McTuiRenderOptions = {}): string {
  const color = shouldUseWelcomeColor(opts);
  const motion = shouldUseVisualMotion(opts);
  const columns = Math.max(
    MIN_COLUMNS,
    Math.floor(opts.columns ?? process.stdout.columns ?? DEFAULT_COLUMNS),
  );
  const mark = motion ? spinnerFrame(opts.frameIndex ?? 0) : SPACE_MARKS.tick;
  const header = hexPaint(
    HELMET_ACCENT,
    `${mark} Mission Control ${SPACE_MARKS.star} terminal view (web dashboard unchanged)`,
    color,
  );

  const missionBody = view.error
    ? [
        hexPaint(
          STATUS_ERR,
          wrapNarrow(view.error, columns - 4).split("\n")[0] ?? view.error,
          color,
        ),
      ]
    : [
        `${hexPaint(LABEL_MUTED, "status  ", color)}${paintStatus(view.mission.status, color)}${
          view.mission.mode ? hexPaint(HELMET_OUTLINE, `  ·  ${view.mission.mode}`, color) : ""
        }`,
        labeled("plan    ", lineOrQuiet(view.mission.planFile, "none"), color),
        labeled("todos   ", view.mission.progressLabel, color),
        labeled("now     ", lineOrQuiet(view.mission.currentTodo, "none"), color),
        labeled("next    ", lineOrQuiet(view.mission.nextTodo, "none"), color),
      ];

  const flightBody = [
    paintNowLine(view.flightLog, color),
    ...view.flightLog.warnings.map((w) => labeled("warn  ", w, color, STATUS_WARN)),
    ...(view.flightLog.earlier.length > 0
      ? view.flightLog.earlier.map((t) => labeled("Earlier  ", t, color))
      : [muted("Earlier  none", color)]),
  ];

  const checklistBody =
    view.checklist.length === 0
      ? [muted("no open plans", color)]
      : view.checklist.map((row) => {
          const todo = row.currentTodo ? `  ·  ${row.currentTodo}` : "";
          return `${hexPaint(HELMET_OUTLINE, `${row.file}  `, color)}${paintStatus(row.lifecycle, color)}${hexPaint(HELMET_OUTLINE, `  ${row.progressLabel}${todo}`, color)}`;
        });

  const crewBody =
    view.crewMonitor.length === 0
      ? [muted("quiet", color)]
      : view.crewMonitor.map(
          (row) =>
            `${paintStatus(row.kind, color)}${hexPaint(HELMET_OUTLINE, `  ${row.label}`, color)}`,
        );

  const panels = [
    ...box("Mission", missionBody, columns, color),
    ...box("Flight Log", flightBody, columns, color),
    ...box("Checklist", checklistBody, columns, color),
    ...box("Crew Monitor", crewBody, columns, color),
  ];

  const footer = muted("Third surface · local snapshot · q / Ctrl-C to quit live view", color);
  return [header, ...panels, footer].join("\n");
}

/** True when a live refresh loop is appropriate (TTY, not CI, not forced one-shot). */
export function shouldLiveRefresh(opts: {
  once?: boolean;
  stdoutIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (opts.once) return false;
  const env = opts.env ?? process.env;
  if (env.CI != null && env.CI !== "") return false;
  const tty = opts.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  return tty;
}

/* ------------------------------------------------------------------------ */
/* Live-run primitives (in-process ANSI; no widget runtime)                 */
/* ------------------------------------------------------------------------ */

export interface ProgressBarOptions {
  done: number;
  total: number;
  /** Cells inside the brackets (default 20, minimum 4). */
  width?: number;
  color?: boolean;
}

/** `[████░░░░] 3/7` with the filled part painted in the accent tone. */
export function renderProgressBar(opts: ProgressBarOptions): string {
  const width = Math.max(4, Math.floor(opts.width ?? 20));
  const total = Math.max(0, Math.floor(opts.total));
  const done = Math.min(total, Math.max(0, Math.floor(opts.done)));
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  const color = opts.color ?? false;
  const bar = `${hexPaint(HELMET_ACCENT, "█".repeat(filled), color)}${hexPaint(
    LABEL_MUTED,
    "░".repeat(width - filled),
    color,
  )}`;
  return `${hexPaint(HELMET_OUTLINE, "[", color)}${bar}${hexPaint(HELMET_OUTLINE, "]", color)} ${hexPaint(
    HELMET_OUTLINE,
    `${done}/${total}`,
    color,
  )}`;
}

export interface ScrollViewport<T> {
  lines: T[];
  /** Lines above the viewport (older). */
  above: number;
  /** Lines below the viewport (newer; non-zero only when scrolled up). */
  below: number;
}

/**
 * Bounded line buffer with a viewport anchored at the bottom. `offset` is how
 * many lines the viewport is scrolled up from the newest line; pushing past
 * the capacity drops the oldest lines and keeps the viewport anchored.
 */
export class ScrollRegion<T = string> {
  private lines: T[] = [];
  private offset = 0;
  readonly capacity: number;

  constructor(capacity = 500) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  get length(): number {
    return this.lines.length;
  }

  get scrolledUp(): number {
    return this.offset;
  }

  push(line: T): void {
    this.lines.push(line);
    if (this.lines.length > this.capacity) {
      this.lines.splice(0, this.lines.length - this.capacity);
    }
    if (this.offset > 0) this.offset = Math.min(this.offset, Math.max(0, this.lines.length - 1));
  }

  scrollUp(n = 1): void {
    this.offset = Math.min(Math.max(0, this.lines.length - 1), this.offset + Math.max(0, n));
  }

  scrollDown(n = 1): void {
    this.offset = Math.max(0, this.offset - Math.max(0, n));
  }

  scrollToBottom(): void {
    this.offset = 0;
  }

  /** The last `height` lines (minus the scroll offset). */
  viewport(height: number): ScrollViewport<T> {
    const h = Math.max(0, Math.floor(height));
    const end = Math.max(0, this.lines.length - this.offset);
    const start = Math.max(0, end - h);
    return { lines: this.lines.slice(start, end), above: start, below: this.lines.length - end };
  }

  all(): readonly T[] {
    return this.lines;
  }
}

export type InputKeyResult = "submit" | "sigint" | "eof" | "edit" | "ignored";

const KEY_LEFT = `${ESC}[D`;
const KEY_RIGHT = `${ESC}[C`;
const KEY_HOME_SET = new Set([`${ESC}[H`, `${ESC}[1~`, `${ESC}OH`]);
const KEY_END_SET = new Set([`${ESC}[F`, `${ESC}[4~`, `${ESC}OF`]);
const KEY_DELETE = `${ESC}[3~`;

/** Split a raw-mode chunk into keys: escape sequences stay whole, everything else is one char. */
export function splitKeys(chunk: string | Buffer): string[] {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const keys: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === ESC && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === "[" || next === "O") {
        let j = i + 2;
        while (j < text.length && !/[A-Za-z~]/.test(text[j] ?? "")) j += 1;
        keys.push(text.slice(i, Math.min(text.length, j + 1)));
        i = j + 1;
        continue;
      }
    }
    keys.push(ch);
    i += 1;
  }
  return keys;
}

/**
 * One-line editor for raw-mode input. Handles printable insert, backspace,
 * delete, left/right, home/end, Ctrl-U (clear), Ctrl-W (delete word); Enter
 * submits, Ctrl-C is `sigint`, Ctrl-D on an empty line is `eof`. Unknown
 * escape sequences are ignored. Never reads the terminal itself.
 */
export class InputLine {
  private buffer = "";
  private cursorPos = 0;

  get value(): string {
    return this.buffer;
  }

  get cursor(): number {
    return this.cursorPos;
  }

  reset(): void {
    this.buffer = "";
    this.cursorPos = 0;
  }

  handleKey(chunk: string | Buffer): InputKeyResult {
    let result: InputKeyResult = "ignored";
    for (const key of splitKeys(chunk)) {
      const r = this.handleOne(key);
      if (r === "submit" || r === "sigint" || r === "eof") return r;
      if (r === "edit") result = "edit";
    }
    return result;
  }

  private handleOne(key: string): InputKeyResult {
    if (key === "\r" || key === "\n") return "submit";
    if (key === "\x03") return "sigint";
    if (key === "\x04") return this.buffer.length === 0 ? "eof" : "ignored";
    if (key === "\x7f" || key === "\b") {
      if (this.cursorPos === 0) return "ignored";
      this.buffer = this.buffer.slice(0, this.cursorPos - 1) + this.buffer.slice(this.cursorPos);
      this.cursorPos -= 1;
      return "edit";
    }
    if (key === KEY_DELETE) {
      if (this.cursorPos >= this.buffer.length) return "ignored";
      this.buffer = this.buffer.slice(0, this.cursorPos) + this.buffer.slice(this.cursorPos + 1);
      return "edit";
    }
    if (key === KEY_LEFT) {
      if (this.cursorPos === 0) return "ignored";
      this.cursorPos -= 1;
      return "edit";
    }
    if (key === KEY_RIGHT) {
      if (this.cursorPos >= this.buffer.length) return "ignored";
      this.cursorPos += 1;
      return "edit";
    }
    if (KEY_HOME_SET.has(key) || key === "\x01") {
      this.cursorPos = 0;
      return "edit";
    }
    if (KEY_END_SET.has(key) || key === "\x05") {
      this.cursorPos = this.buffer.length;
      return "edit";
    }
    if (key === "\x15") {
      if (this.buffer.length === 0) return "ignored";
      this.reset();
      return "edit";
    }
    if (key === "\x17") {
      if (this.cursorPos === 0) return "ignored";
      const head = this.buffer.slice(0, this.cursorPos).replace(/\S*\s*$/, "");
      this.buffer = head + this.buffer.slice(this.cursorPos);
      this.cursorPos = head.length;
      return "edit";
    }
    if (key.startsWith(ESC)) return "ignored";
    const code = key.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return "ignored";
    this.buffer = this.buffer.slice(0, this.cursorPos) + key + this.buffer.slice(this.cursorPos);
    this.cursorPos += key.length;
    return "edit";
  }

  /** `> text` with the cursor cell marked by reverse video (plain: `_` at the end). */
  render(width: number, color: boolean, prompt = "> "): string {
    const max = Math.max(4, width - prompt.length - 1);
    let start = 0;
    if (this.cursorPos >= max) start = this.cursorPos - max + 1;
    const visible = this.buffer.slice(start, start + max);
    const at = this.cursorPos - start;
    const before = visible.slice(0, at);
    const cell = visible.slice(at, at + 1) || " ";
    const after = visible.slice(at + 1);
    const painted = color
      ? `${hexPaint(HELMET_OUTLINE, before, true)}${ESC}[7m${cell}${ESC}[0m${hexPaint(HELMET_OUTLINE, after, true)}`
      : `${before}${cell === " " && after === "" ? "_" : cell}${after}`;
    return `${hexPaint(HELMET_ACCENT, prompt, color)}${painted}`;
  }
}

export type McLiveRenderOptions = McTuiRenderOptions & {
  /** Terminal height; bounds the Flight Log viewport (default: process.stdout.rows or 24). */
  rows?: number;
  now?: number;
};

const LIVE_MIN_LOG_ROWS = 3;
const LIVE_MAX_LOG_ROWS = 40;
const LIVE_CHECKLIST_CAP = 4;

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function liveLineHex(kind: string): string {
  switch (kind) {
    case "tool":
      return HELMET_ACCENT;
    case "result":
      return STATUS_OK;
    case "error":
      return STATUS_ERR;
    case "rate_limit":
      return STATUS_WARN;
    case "hitl":
      return HELMET_ACCENT;
    case "hook":
    case "prompt":
    case "note":
      return LABEL_MUTED;
    default:
      return HELMET_OUTLINE;
  }
}

/**
 * Render one live-run frame: Mission (progress bars, gate prompt and input
 * line), Flight Log (scrolling region), Checklist (queue or to-dos) and Crew
 * Monitor (the child process). Same color and motion gates as the snapshot.
 */
export function renderMcLive(view: McLiveView, opts: McLiveRenderOptions = {}): string {
  const color = shouldUseWelcomeColor(opts);
  const motion = shouldUseVisualMotion(opts);
  const columns = Math.max(
    MIN_COLUMNS,
    Math.floor(opts.columns ?? process.stdout.columns ?? DEFAULT_COLUMNS),
  );
  const rows = Math.max(12, Math.floor(opts.rows ?? process.stdout.rows ?? 24));
  const inner = columns - 2 - INNER_PAD;
  const now = opts.now ?? Date.now();
  const running = view.crew.phase === "running" || view.crew.phase === "gate";
  const mark = motion && running ? spinnerFrame(opts.frameIndex ?? 0) : SPACE_MARKS.tick;
  const header = hexPaint(
    HELMET_ACCENT,
    `${mark} Mission Control ${SPACE_MARKS.star} live run ${SPACE_MARKS.tick} ${view.crew.backend ?? "agent"} ${SPACE_MARKS.tick} ${view.crew.phase}`,
    color,
  );

  const barWidth = Math.max(8, Math.min(24, Math.floor(inner / 3)));
  const missionBody: string[] = [];
  if (view.error) {
    missionBody.push(
      hexPaint(STATUS_ERR, wrapNarrow(view.error, inner).split("\n")[0] ?? "", color),
    );
  } else {
    const m = view.mission;
    missionBody.push(
      `${labeled("plan     ", lineOrQuiet(m.planFile, "none"), color)}${
        m.mode ? hexPaint(LABEL_MUTED, `  ·  ${m.mode}`, color) : ""
      }`,
    );
    const todoTail = m.currentTodo ? `  now ${m.currentTodo}` : "";
    missionBody.push(
      `${hexPaint(LABEL_MUTED, "to-dos   ", color)}${renderProgressBar({
        done: m.todos.done,
        total: m.todos.total,
        width: barWidth,
        color,
      })}${hexPaint(HELMET_OUTLINE, todoTail, color)}`,
    );
    if (m.queue) {
      const tail = m.queue.status ? `  ${m.queue.status}` : "";
      missionBody.push(
        `${hexPaint(LABEL_MUTED, "plans    ", color)}${renderProgressBar({
          done: m.queue.done,
          total: m.queue.total,
          width: barWidth,
          color,
        })}${hexPaint(HELMET_OUTLINE, tail, color)}`,
      );
    }
    if (m.nextTodo) missionBody.push(labeled("next     ", m.nextTodo, color));
  }
  if (view.gate) {
    const g = view.gate;
    const head = g.detection === "fallback" ? `${g.askId} (prose fallback)` : g.askId;
    missionBody.push(
      `${hexPaint(LABEL_MUTED, "gate     ", color)}${hexPaint(STATUS_WARN, head, color)}${hexPaint(
        LABEL_MUTED,
        "  ·  number or label replies; empty, skip, cancel or Ctrl-C stops",
        color,
      )}`,
    );
    g.labels.forEach((label, i) => {
      missionBody.push(hexPaint(HELMET_OUTLINE, `         ${i + 1}. ${label}`, color));
    });
    missionBody.push(`         ${view.gate.input.render(inner - 9, color)}`);
  }

  const checklistBody =
    view.checklist.length === 0
      ? [muted("no queue", color)]
      : view.checklist.slice(0, LIVE_CHECKLIST_CAP).map((row) => {
          const markOf =
            row.state === "done"
              ? SPACE_MARKS.star
              : row.state === "current"
                ? "▶"
                : SPACE_MARKS.tick;
          const hex =
            row.state === "done"
              ? STATUS_OK
              : row.state === "current"
                ? HELMET_ACCENT
                : LABEL_MUTED;
          return hexPaint(hex, `${markOf} ${row.label}`, color);
        });

  const c = view.crew;
  const crewLine1 = [
    c.backend ?? "agent",
    c.pid !== undefined ? `pid ${c.pid}` : "no pid",
    c.phase,
    formatElapsed(now - c.startedAt),
    c.costUsd !== undefined ? `$${c.costUsd.toFixed(c.costUsd < 0.1 ? 4 : 2)}` : null,
    c.turns !== undefined ? `${c.turns} turn${c.turns === 1 ? "" : "s"}` : null,
    `${c.toolCalls} tool call${c.toolCalls === 1 ? "" : "s"}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(` ${SPACE_MARKS.tick} `);
  const crewBody = [hexPaint(HELMET_OUTLINE, crewLine1, color)];
  if (c.currentTool) {
    crewBody.push(
      `${hexPaint(LABEL_MUTED, "tool  ", color)}${hexPaint(HELMET_ACCENT, `${c.currentTool.name} ${SPACE_MARKS.tick} ${c.currentTool.summary}`, color)}`,
    );
  } else if (c.lastResult) {
    crewBody.push(
      `${hexPaint(LABEL_MUTED, "last  ", color)}${hexPaint(c.lastResult.ok ? STATUS_OK : STATUS_ERR, `result ${c.lastResult.status}`, color)}`,
    );
  }
  if (c.rateLimit) {
    crewBody.push(
      `${hexPaint(LABEL_MUTED, "limit ", color)}${hexPaint(c.rateLimit.severe ? STATUS_ERR : STATUS_WARN, c.rateLimit.line, color)}`,
    );
  }
  if (c.logPath) crewBody.push(labeled("log   ", c.logPath, color, LABEL_MUTED));

  // Height budget: header, Mission, Flight Log frame, Checklist, Crew Monitor,
  // footer. A short terminal drops the Checklist panel first, then trims the
  // Crew Monitor to its first line, so the frame never exceeds `rows`.
  let checklist: string[] | null = checklistBody;
  let crew = crewBody;
  const fixed = () =>
    1 +
    (missionBody.length + 2) +
    2 +
    (checklist ? checklist.length + 2 : 0) +
    (crew.length + 2) +
    1;
  if (fixed() + LIVE_MIN_LOG_ROWS > rows) checklist = null;
  if (fixed() + LIVE_MIN_LOG_ROWS > rows) crew = crew.slice(0, 1);
  const logRows = Math.max(1, Math.min(LIVE_MAX_LOG_ROWS, rows - fixed()));
  const viewport = view.flightLog.viewport(logRows);
  const flightBody = viewport.lines.map((line) =>
    hexPaint(liveLineHex(line.kind), line.text, color),
  );
  if (flightBody.length === 0) flightBody.push(muted("waiting for the agent stream", color));
  const flightTitle =
    viewport.above > 0 || viewport.below > 0
      ? `Flight Log ${SPACE_MARKS.tick} ${viewport.above} above${viewport.below > 0 ? ` ${SPACE_MARKS.tick} ${viewport.below} below` : ""}`
      : "Flight Log";

  const panels = [
    ...box("Mission", missionBody, columns, color),
    ...box(flightTitle, flightBody, columns, color),
    ...(checklist ? box("Checklist", checklist, columns, color) : []),
    ...box("Crew Monitor", crew, columns, color),
  ];
  const footer = muted(
    view.gate
      ? "Third surface · live feed · Enter sends the reply · Ctrl-C stops the run"
      : "Third surface · live feed · q / Ctrl-C stops the run · log keeps the full NDJSON",
    color,
  );
  return [header, ...panels, footer].join("\n");
}
