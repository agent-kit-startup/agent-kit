/**
 * Shared CLI visual-kit primitives (frames, marks, tips, motion gate).
 * Welcome helmet ASCII stays in screen.ts; this module does not replace it.
 */

import { cyan, gray, options as koloristOptions } from "kolorist";

/** Helmet outline / primary text: MC `--text-primary` / landing logo stroke. */
export const HELMET_OUTLINE = "#e2e8f0";
/** Deep brand blue: landing logo gradient mid. */
export const HELMET_FILL = "#0C8DEB";
/** Aqua accent: landing logo gradient late stops. */
export const HELMET_ACCENT = "#00D0E7";
/** Muted labels: MC `--text-secondary`. */
export const LABEL_MUTED = "#8899aa";

/** Braille spinner frames (no ora). */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Small space marks. Full helmet art remains `HELMET_ASCII` in screen.ts. */
export const SPACE_MARKS = {
  star: "✦",
  tick: "·",
  diamond: "✧",
  visor: "( )",
} as const;

/** Rotating Mission Kit tips. No secrets, tokens, or absolute home paths. */
export const KIT_TIPS = [
  "Try agent-kit doctor for repository readiness.",
  "HITL gates stay in Cursor slash commands.",
  "/run-plan never promotes to production.",
  "Mission Control is the dashboard, not the CLI name.",
  "NO_COLOR and CI keep this output static.",
  "agent-kit --help groups SETUP, MISSION, DASHBOARD, INTEGRITY.",
] as const;

export interface WelcomeRenderOptions {
  version?: string;
  /** Force color on/off; when omitted, derive from env + TTY. */
  color?: boolean;
  stdoutIsTTY?: boolean;
}

/** Whether welcome / root help should emit ANSI (respects NO_COLOR / CI / non-TTY). */
export function shouldUseWelcomeColor(opts: WelcomeRenderOptions = {}): boolean {
  if (opts.color === false) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.NODE_DISABLE_COLORS) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.CI != null && process.env.CI !== "") return false;
  if (opts.color === true) return true;
  const tty = opts.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  return tty;
}

/** Frames and spinners: color gate plus optional reduced-motion. */
export function shouldUseVisualMotion(opts: WelcomeRenderOptions = {}): boolean {
  if (process.env.AGENT_KIT_REDUCED_MOTION === "1") return false;
  return shouldUseWelcomeColor(opts);
}

export function spinnerFrame(index: number): string {
  const n = SPINNER_FRAMES.length;
  return SPINNER_FRAMES[((index % n) + n) % n] ?? SPINNER_FRAMES[0];
}

export function tipAt(index: number): string {
  const n = KIT_TIPS.length;
  return KIT_TIPS[((index % n) + n) % n] ?? KIT_TIPS[0];
}

/** Word-wrap to a column budget. Width below 8 collapses to 8. */
export function wrapNarrow(text: string, columns: number): string {
  const width = Math.max(8, Number.isFinite(columns) ? Math.floor(columns) : 80);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += width) {
        const chunk = word.slice(i, i + width);
        if (i + width >= word.length) current = chunk;
        else lines.push(chunk);
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

export interface ProgressLineOptions {
  frameIndex: number;
  tipIndex: number;
  columns?: number;
  label?: string;
  motion?: boolean;
  color?: boolean;
}

/** One progress row: spinner or static mark, optional label, rotating tip. */
export function renderProgressLine(opts: ProgressLineOptions): string {
  const motion = opts.motion ?? shouldUseVisualMotion();
  const color = opts.color ?? shouldUseWelcomeColor();
  const mark = motion ? spinnerFrame(opts.frameIndex) : SPACE_MARKS.tick;
  const tip = tipAt(opts.tipIndex);
  const label = opts.label?.trim() ?? "";
  const raw = label ? `${mark} ${label} ${SPACE_MARKS.star} ${tip}` : `${mark} ${tip}`;
  const cols = opts.columns ?? process.stdout.columns ?? 80;
  const wrapped = wrapNarrow(raw, cols);
  if (!color) return wrapped;
  const prevEnabled = koloristOptions.enabled;
  koloristOptions.enabled = true;
  try {
    return wrapped
      .split("\n")
      .map((line, i) => (i === 0 ? cyan(line) : gray(line)))
      .join("\n");
  } finally {
    koloristOptions.enabled = prevEnabled;
  }
}

export interface TtySpinnerOptions {
  write?: (chunk: string) => void;
  columns?: () => number;
  motion?: boolean;
  color?: boolean;
  intervalMs?: number;
  now?: () => number;
}

/**
 * Lightweight TTY spinner. No-op interval when motion is off (one static line).
 * Callers must `stop()` to clear the interval.
 */
export class TtySpinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private startedAt = 0;
  private label = "";
  private readonly write: (chunk: string) => void;
  private readonly columns: () => number;
  private readonly motion: boolean;
  private readonly color: boolean;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(opts: TtySpinnerOptions = {}) {
    this.write = opts.write ?? ((chunk) => process.stdout.write(chunk));
    this.columns = opts.columns ?? (() => process.stdout.columns ?? 80);
    this.motion = opts.motion ?? shouldUseVisualMotion();
    this.color = opts.color ?? shouldUseWelcomeColor();
    this.intervalMs = opts.intervalMs ?? 80;
    this.now = opts.now ?? (() => Date.now());
  }

  start(label = ""): void {
    this.stop();
    this.label = label;
    this.frame = 0;
    this.startedAt = this.now();
    this.paint(false);
    if (!this.motion) return;
    this.timer = setInterval(() => {
      this.frame += 1;
      this.paint(true);
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(finalLine?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.motion) this.write("\r\u001b[K");
    if (finalLine) this.write(`${finalLine}\n`);
  }

  private paint(overwrite: boolean): void {
    const elapsed = this.now() - this.startedAt;
    const tipIndex = Math.floor(elapsed / 4000);
    const line =
      renderProgressLine({
        frameIndex: this.frame,
        tipIndex,
        columns: this.columns(),
        label: this.label,
        motion: this.motion,
        color: this.color,
      }).split("\n")[0] ?? "";
    if (overwrite && this.motion) this.write(`\r\u001b[K${line}`);
    else if (this.motion) this.write(line);
    else this.write(`${line}\n`);
  }
}

/** Run `fn` with a TTY spinner; always stops, including on throw. No-op when motion is off. */
export async function withCliProgress<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: TtySpinnerOptions,
): Promise<T> {
  const motion = opts?.motion ?? shouldUseVisualMotion();
  if (!motion) {
    return fn();
  }
  const spinner = new TtySpinner({ ...opts, motion: true });
  spinner.start(label);
  try {
    const result = await fn();
    spinner.stop();
    return result;
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
