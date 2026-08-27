/**
 * Terminal refresh loop for the Mission Control TUI.
 * Interval SoT: dashboard/lib/live-refresh.mjs PERIODIC_REFRESH_MS.
 */

import { type McTuiRenderOptions, renderMcTui, shouldLiveRefresh } from "./render.js";
import { PERIODIC_REFRESH_MS } from "./snapshot.js";
import type { McTuiView } from "./view.js";

const CLEAR_HOME = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export type McTuiLoopHooks = {
  write: (chunk: string) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  now?: () => number;
};

export type McTuiLoopHandle = {
  stop: () => void;
};

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

  const paint = async (clear: boolean) => {
    const view = await opts.loadView();
    const frame = renderMcTui(view, {
      ...opts.renderOpts,
      stdoutIsTTY: opts.stdoutIsTTY,
      frameIndex,
    });
    frameIndex += 1;
    opts.hooks.write(clear ? `${CLEAR_HOME}${frame}\n` : `${frame}\n`);
  };

  await paint(false);
  if (!live) return null;

  opts.hooks.write(HIDE_CURSOR);
  const intervalMs = opts.intervalMs ?? PERIODIC_REFRESH_MS;
  const setInt = opts.hooks.setIntervalFn ?? setInterval;
  const clearInt = opts.hooks.clearIntervalFn ?? clearInterval;
  const timer = setInt(() => {
    void paint(true);
  }, intervalMs);

  const stop = () => {
    clearInt(timer);
    opts.hooks.write(SHOW_CURSOR);
  };
  return { stop };
}
