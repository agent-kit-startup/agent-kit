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
