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
};

export type McTuiLoopHandle = {
  stop: () => void;
};

function isQuitKey(chunk: string | Buffer): boolean {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  return text === "q" || text === "Q" || text === "\x03";
}

export async function runMcTuiLoop(opts: {
  loadView: () => Promise<McTuiView>;
  once?: boolean;
  stdoutIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  intervalMs?: number;
  renderOpts?: McTuiRenderOptions;
  hooks: McTuiLoopHooks;
}): Promise<McTuiLoopHandle | null> {
  const live = shouldLiveRefresh({
    once: opts.once,
    stdoutIsTTY: opts.stdoutIsTTY,
    env: opts.env,
  });
  let frameIndex = 0;
  let inFlight = false;

  const paint = async (clear: boolean) => {
    if (inFlight) return;
    inFlight = true;
    try {
      const view = await opts.loadView();
      const frame = renderMcTui(view, {
        ...opts.renderOpts,
        stdoutIsTTY: opts.stdoutIsTTY,
        frameIndex,
      });
      frameIndex += 1;
      opts.hooks.write(clear ? `${CLEAR_HOME}${frame}\n` : `${frame}\n`);
    } catch (err) {
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
  let stopped = false;

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
      if (!isQuitKey(chunk)) return;
      stop();
      const exitFn = opts.hooks.exit ?? ((code: number) => process.exit(code));
      exitFn(0);
    };
    stdin.on("data", quitListener);
  }

  return { stop };
}
