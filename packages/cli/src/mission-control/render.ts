/**
 * ASCII space-vintage renderer for the four Mission Control TUI panels.
 * Tokens and motion/color gates come from the visual kit (no parallel palette).
 */

import { gray, trueColor } from "kolorist";
import {
  HELMET_ACCENT,
  HELMET_FILL,
  HELMET_OUTLINE,
  LABEL_MUTED,
  SPACE_MARKS,
  type WelcomeRenderOptions,
  shouldUseVisualMotion,
  shouldUseWelcomeColor,
  spinnerFrame,
  withKoloristColor,
  wrapNarrow,
} from "../welcome/visual-kit.js";
import type { McTuiView } from "./view.js";

export { HELMET_ACCENT, HELMET_FILL, HELMET_OUTLINE, LABEL_MUTED };

const DEFAULT_COLUMNS = 80;
const MIN_COLUMNS = 40;
const INNER_PAD = 2;

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
  if (!color) return text;
  return withKoloristColor(() => gray(text));
}

function box(title: string, bodyLines: string[], width: number, color: boolean): string[] {
  const inner = Math.max(8, width - 2);
  const label = ` ${title} `;
  const dashCount = Math.max(1, inner - label.length);
  const top = `┌${label}${"─".repeat(dashCount)}┐`;
  const bottom = `└${"─".repeat(inner)}┘`;
  const paintedTop = hexPaint(HELMET_FILL, top, color);
  const paintedBottom = hexPaint(HELMET_OUTLINE, bottom, color);
  const rows = bodyLines.map((line) => {
    const clipped = line.length > inner - INNER_PAD ? line.slice(0, inner - INNER_PAD) : line;
    const pad = " ".repeat(Math.max(0, inner - INNER_PAD - clipped.length));
    const content = ` ${clipped}${pad} `;
    return `${hexPaint(HELMET_OUTLINE, "│", color)}${content}${hexPaint(HELMET_OUTLINE, "│", color)}`;
  });
  return [paintedTop, ...rows, paintedBottom];
}

function lineOrQuiet(text: string | null, fallback: string): string {
  const trimmed = text?.trim();
  return trimmed ? trimmed : fallback;
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
    ? [wrapNarrow(view.error, columns - 4).split("\n")[0] ?? view.error]
    : [
        `status  ${view.mission.status}${view.mission.mode ? `  ·  ${view.mission.mode}` : ""}`,
        `plan    ${lineOrQuiet(view.mission.planFile, "none")}`,
        `todos   ${view.mission.progressLabel}`,
        `now     ${lineOrQuiet(view.mission.currentTodo, "none")}`,
        `next    ${lineOrQuiet(view.mission.nextTodo, "none")}`,
      ];

  const nowLabel = view.flightLog.now
    ? `NOW ${view.flightLog.nowKind ? `(${view.flightLog.nowKind})` : ""}  ${view.flightLog.now}`
    : "NOW  All clear";
  const flightBody = [
    nowLabel,
    ...(view.flightLog.warnings.length > 0 ? view.flightLog.warnings.map((w) => `warn  ${w}`) : []),
    ...(view.flightLog.earlier.length > 0
      ? view.flightLog.earlier.map((t) => `Earlier  ${t}`)
      : [muted("Earlier  none", color)]),
  ];

  const checklistBody =
    view.checklist.length === 0
      ? [muted("no open plans", color)]
      : view.checklist.map((row) => {
          const todo = row.currentTodo ? `  ·  ${row.currentTodo}` : "";
          return `${row.file}  ${row.lifecycle}  ${row.progressLabel}${todo}`;
        });

  const crewBody =
    view.crewMonitor.length === 0
      ? [muted("quiet", color)]
      : view.crewMonitor.map((row) => `${row.kind}  ${row.label}`);

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
