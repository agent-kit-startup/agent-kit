/**
 * Terminal refresh loop for the Mission Control TUI.
 * Interval SoT: dashboard/lib/live-refresh.mjs PERIODIC_REFRESH_MS.
 */

import { type McTuiRenderOptions, renderMcTui, shouldLiveRefresh } from "./render.js";
import { PERIODIC_REFRESH_MS } from "./snapshot.js";
import { type McTuiView, buildMcTuiView } from "./view.js";

const CLEAR_HOME = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

/** Minimal stdin surface so tests can inject a fake TTY stream. */
export type McTuiStdin = {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
  pause?: () => void;
  resume?: () => void;
  on: (event: "data", listener: (chunk: string | Buffer) => void) => void;
  off?: (event: "data", listener: (chunk: string | Buffer) => void) => void;
};

export type McTuiLoopHooks = {
  write: (chunk: string) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  now?: () => number;
  stdin?: McTuiStdin;
  exit?: (code: number) => void;
  /**
   * First look at every raw-mode key chunk. Return true when consumed (the
   * quit key is then not checked). Lets the live run route keys to an input
   * line while a gate is open.
   */
  onKey?: (chunk: string | Buffer) => boolean;
  /** Replaces `exit(0)` on the quit key: the loop stops, then this runs. */
  onQuit?: (key: "q" | "Ctrl-C") => void;
};

export type McTuiLoopHandle = {
  stop: () => void;
  /** Paint a frame now (a keystroke, a gate opening) instead of waiting for the interval. */
  repaint: () => Promise<void>;
};

function quitKeyOf(chunk: string | Buffer): "q" | "Ctrl-C" | null {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  if (text === "q" || text === "Q") return "q";
  if (text === "\x03") return "Ctrl-C";
  return null;
}

export async function runMcTuiLoop<V = McTuiView>(opts: {
  loadView: () => Promise<V>;
  /** Frame renderer for the loaded view (default: the four-panel snapshot). */
  render?: (view: V, renderOpts: McTuiRenderOptions) => string;
  once?: boolean;
  stdoutIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  intervalMs?: number;
  renderOpts?: McTuiRenderOptions;
  hooks: McTuiLoopHooks;
}): Promise<McTuiLoopHandle | null> {
  const render =
    opts.render ??
    ((view: V, renderOpts: McTuiRenderOptions) => renderMcTui(view as McTuiView, renderOpts));
  const live = shouldLiveRefresh({
    once: opts.once,
    stdoutIsTTY: opts.stdoutIsTTY,
    env: opts.env,
  });
  let frameIndex = 0;
  let inFlight = false;
  let stopped = false;

  // A paint that was collecting when stop() ran must not write: the caller
  // prints its summary right after stop() and a late clear would wipe it.
  const paint = async (clear: boolean) => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      const view = await opts.loadView();
      if (stopped) return;
      const frame = render(view, {
        ...opts.renderOpts,
        stdoutIsTTY: opts.stdoutIsTTY,
        frameIndex,
      });
      frameIndex += 1;
      opts.hooks.write(clear ? `${CLEAR_HOME}${frame}\n` : `${frame}\n`);
    } catch (err) {
      if (stopped) return;
      const message = err instanceof Error ? err.message : String(err);
      const frame = renderMcTui(buildMcTuiView(null, message), {
        ...opts.renderOpts,
        stdoutIsTTY: opts.stdoutIsTTY,
        frameIndex,
      });
      frameIndex += 1;
      opts.hooks.write(clear ? `${CLEAR_HOME}${frame}\n` : `${frame}\n`);
    } finally {
      inFlight = false;
    }
  };

  await paint(false);
  if (!live) return null;

  opts.hooks.write(HIDE_CURSOR);
  const intervalMs = opts.intervalMs ?? PERIODIC_REFRESH_MS;
  const setInt = opts.hooks.setIntervalFn ?? setInterval;
  const clearInt = opts.hooks.clearIntervalFn ?? clearInterval;
  let timer: ReturnType<typeof setInterval>;
  try {
    timer = setInt(() => {
      void paint(true);
    }, intervalMs);
  } catch (err) {
    opts.hooks.write(SHOW_CURSOR);
    throw err;
  }

  const stdin = opts.hooks.stdin;
  const attachQuit = Boolean(stdin?.isTTY);
  let quitListener: ((chunk: string | Buffer) => void) | undefined;

  const restoreStdin = () => {
    if (!stdin || !attachQuit) return;
    if (quitListener) {
      stdin.off?.("data", quitListener);
      quitListener = undefined;
    }
    try {
      stdin.setRawMode?.(false);
    } catch {
      // stdin may already be destroyed
    }
    stdin.pause?.();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInt(timer);
    restoreStdin();
    opts.hooks.write(SHOW_CURSOR);
  };

  if (attachQuit && stdin) {
    stdin.setRawMode?.(true);
    stdin.resume?.();
    quitListener = (chunk) => {
      if (stopped) return;
      if (opts.hooks.onKey?.(chunk)) return;
      const key = quitKeyOf(chunk);
      if (!key) return;
      stop();
      if (opts.hooks.onQuit) {
        opts.hooks.onQuit(key);
        return;
      }
      const exitFn = opts.hooks.exit ?? ((code: number) => process.exit(code));
      exitFn(0);
    };
    stdin.on("data", quitListener);
  }

  return {
    stop,
    repaint: () => (stopped ? Promise.resolve() : paint(true)),
  };
}
