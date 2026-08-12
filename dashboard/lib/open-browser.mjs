/**
 * Shared Mission Control browser open helper.
 *
 * Preference resolution (highest wins):
 *   1. env MISSION_CONTROL_PREFERRED_BROWSER
 *   2. config missionControl.preferredBrowser (passed in by caller)
 *   3. OS default handler (null preferred)
 *
 * Skips open when MISSION_CONTROL_NO_OPEN=1.
 * Never opens more than one process per call (preferred may fall back once).
 *
 * Trust boundary: preferredBrowser is an app/binary *name*, not a path or
 * shell expression. Values with path separators or shell metacharacters are
 * rejected and treated as OS default.
 *
 * ADR: .cursor/memory/decisions/2026-08-11_mission-control-preferred-browser.md
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { platform as osPlatform } from "node:os";

/** Sentinel values that mean "use OS default" (and slash-only Ask). */
export const OS_DEFAULT_TOKENS = new Set(["", "default", "os", "ask"]);

/**
 * Reject path separators, absolute/relative path forms, and shell metacharacters.
 * Allowed examples: "Google Chrome", "firefox", "msedge", "Brave Browser".
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isSafePreferredBrowser(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return false;
  if (/[/\\]/.test(s)) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional reject of C0/DEL in browser names
  if (/[\0-\x1f\x7f]/.test(s)) return false;
  if (/[$`;&|<>(){}[\]!*?#~"'%^=,+]/.test(s)) return false;
  if (s.includes(":")) return false;
  if (/^-/.test(s)) return false;
  return true;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function shouldSkipOpen(env = process.env) {
  return env.MISSION_CONTROL_NO_OPEN === "1";
}

/**
 * @param {unknown} value
 * @returns {string | null} trimmed app/binary name, or null for OS default
 */
export function normalizePreferredBrowser(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || OS_DEFAULT_TOKENS.has(s.toLowerCase())) return null;
  if (!isSafePreferredBrowser(s)) return null;
  return s;
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, configValue?: unknown }} [opts]
 * @returns {string | null}
 */
export function resolvePreferredBrowser(opts = {}) {
  const env = opts.env ?? process.env;
  const fromEnv = env.MISSION_CONTROL_PREFERRED_BROWSER;
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return normalizePreferredBrowser(fromEnv);
  }
  return normalizePreferredBrowser(opts.configValue);
}

/**
 * Read missionControl.preferredBrowser from a context config.json path.
 * Missing/invalid file → null (OS default). Does not create the file.
 *
 * @param {string} configPath
 * @param {{ readFileSync?: typeof readFileSync }} [fsHooks]
 * @returns {unknown}
 */
export function readPreferredBrowserFromConfig(configPath, fsHooks = {}) {
  const read = fsHooks.readFileSync ?? readFileSync;
  try {
    const raw = read(configPath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const mc = data.missionControl;
    if (!mc || typeof mc !== "object" || Array.isArray(mc)) return null;
    return mc.preferredBrowser ?? null;
  } catch {
    return null;
  }
}

/**
 * Build an argv for a single open attempt (hermetic: no spawn).
 *
 * @param {{
 *   url: string,
 *   preferred?: string | null,
 *   platform?: NodeJS.Platform,
 * }} opts
 * @returns {{ command: string, args: string[] } | null}
 */
export function buildOpenBrowserCommand(opts) {
  const url = opts.url;
  if (typeof url !== "string" || !url.trim()) return null;
  const preferred = normalizePreferredBrowser(opts.preferred ?? null);
  const os = opts.platform ?? osPlatform();

  if (os === "darwin") {
    if (preferred) {
      return { command: "open", args: ["-a", preferred, url] };
    }
    return { command: "open", args: [url] };
  }

  if (os === "win32") {
    if (preferred) {
      // `start` treats the first quoted arg as window title; pass empty title.
      return { command: "cmd", args: ["/c", "start", "", preferred, url] };
    }
    return { command: "cmd", args: ["/c", "start", "", url] };
  }

  // Linux / other: preferred is a binary or command name; else xdg-open.
  if (preferred) {
    return { command: preferred, args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}

/**
 * @param {import("node:child_process").ChildProcess | { on?: Function, unref?: Function } | null | undefined} child
 */
function attachErrorSwallow(child) {
  if (child && typeof child.on === "function") {
    child.on("error", () => {
      /* prevent unhandled 'error' (ENOENT) from killing the launcher */
    });
  }
  if (child && typeof child.unref === "function") {
    child.unref();
  }
}

/**
 * Open one browser for the URL. Returns whether a process was spawned.
 * When a preferred open fails, falls back once to the OS default opener.
 *
 * @param {string} url
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   preferred?: string | null,
 *   configValue?: unknown,
 *   platform?: NodeJS.Platform,
 *   spawnFn?: typeof spawn,
 *   spawnSyncFn?: typeof spawnSync,
 * }} [options]
 * @returns {{ opened: boolean, reason?: string, command?: string, args?: string[] }}
 */
export function openBrowser(url, options = {}) {
  const env = options.env ?? process.env;
  if (shouldSkipOpen(env)) {
    return { opened: false, reason: "no-open" };
  }

  const preferred =
    options.preferred !== undefined
      ? normalizePreferredBrowser(options.preferred)
      : resolvePreferredBrowser({ env, configValue: options.configValue });

  const platform = options.platform ?? osPlatform();
  const spawnFn = options.spawnFn ?? spawn;
  const spawnSyncFn = options.spawnSyncFn;

  /**
   * @param {{ command: string, args: string[] }} built
   * @returns {{ opened: boolean, reason?: string, command: string, args: string[] }}
   */
  function runDetached(built) {
    try {
      const child = spawnFn(built.command, built.args, { detached: true, stdio: "ignore" });
      attachErrorSwallow(child);
      return { opened: true, command: built.command, args: built.args };
    } catch {
      return {
        opened: false,
        reason: "spawn-failed",
        command: built.command,
        args: built.args,
      };
    }
  }

  /**
   * Preferred open: detect failure before claiming success, then caller may fall back.
   * Hermetic tests that only inject spawnFn use the detached path (throw = fail).
   *
   * @param {{ command: string, args: string[] }} built
   * @returns {{ opened: boolean, reason?: string, command: string, args: string[] }}
   */
  function runPreferred(built) {
    if (options.spawnFn && !spawnSyncFn) {
      return runDetached(built);
    }

    const sync = spawnSyncFn ?? spawnSync;

    if (platform !== "darwin" && platform !== "win32") {
      // Long-lived browser binaries: probe PATH, then detach (do not spawnSync the app).
      const probe = sync("which", [built.command], { encoding: "utf8" });
      if (probe.error || (typeof probe.status === "number" && probe.status !== 0)) {
        return {
          opened: false,
          reason: "spawn-failed",
          command: built.command,
          args: built.args,
        };
      }
      return runDetached(built);
    }

    // darwin `open` / win32 `cmd /c start` exit quickly.
    try {
      const result = sync(built.command, built.args, {
        encoding: "utf8",
        windowsHide: true,
      });
      if (result.error || (typeof result.status === "number" && result.status !== 0)) {
        return {
          opened: false,
          reason: "spawn-failed",
          command: built.command,
          args: built.args,
        };
      }
      return { opened: true, command: built.command, args: built.args };
    } catch {
      return {
        opened: false,
        reason: "spawn-failed",
        command: built.command,
        args: built.args,
      };
    }
  }

  const built = buildOpenBrowserCommand({
    url,
    preferred,
    platform,
  });
  if (!built) {
    return { opened: false, reason: "invalid-url" };
  }

  if (!preferred) {
    // Same failure detection as preferred opens (probe / spawnSync) so OS-default
    // missing handlers are not reported as opened:true.
    return runPreferred(built);
  }

  const prefResult = runPreferred(built);
  if (prefResult.opened) {
    return prefResult;
  }

  const fallback = buildOpenBrowserCommand({
    url,
    preferred: null,
    platform,
  });
  if (!fallback) {
    return { opened: false, reason: "invalid-url" };
  }
  const fb = runPreferred(fallback);
  if (fb.opened) {
    return {
      opened: true,
      command: fb.command,
      args: fb.args,
      reason: "preferred-fallback",
    };
  }
  return {
    opened: false,
    reason: "spawn-failed",
    command: built.command,
    args: built.args,
  };
}
