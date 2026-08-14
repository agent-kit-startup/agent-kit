#!/usr/bin/env node
/**
 * Terminal counterpart to the `/dashboard` slash command.
 *
 * Allocates a stable per-workspace listen port (hash of snapshot root in the
 * 3333–3588 range unless PORT is set), detach-starts `serve.mjs` when needed,
 * waits until HTTP 200, prints the URL, and opens one preferred browser
 * (or OS default). Never opens more than one browser process.
 *
 * Never kills a listener whose system.repoRoot belongs to another workspace.
 *
 * Snapshot root defaults to this kit tree. Set MISSION_CONTROL_REPO_ROOT to
 * point Mission Control at a consumer workspace while still serving static
 * assets from this checkout.
 *
 * Foreground serve for debugging remains: `npm run start:dashboard`.
 */

import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT_ENV,
  escapePerlDoubleQuoted,
  repoRootLogId,
  resolveContextConfigPath,
  resolveMissionControlPort,
  resolveSnapshotRepoRoot,
  sameRepoRoot,
} from "./lib/guards.mjs";
import { openBrowser, readPreferredBrowserFromConfig } from "./lib/open-browser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = join(__dirname, "..");
const ROOT = resolveSnapshotRepoRoot(process.env, KIT_ROOT);
process.title = `Mission Control · ${basename(ROOT) || "workspace"}`;
const SERVE = join(__dirname, "serve.mjs");
const HOST = process.env.HOST || "127.0.0.1";
const DISPLAY_HOST = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 250;

/** @type {number} */
let PORT;
/** @type {string} */
let URL;
/** @type {string} */
let DATA_URL;
/** @type {string} */
let LOG;

function setPort(port) {
  PORT = port;
  URL = `http://${DISPLAY_HOST}:${PORT}/`;
  DATA_URL = `http://${DISPLAY_HOST}:${PORT}/dashboard-data.json`;
  LOG = process.env.MISSION_CONTROL_LOG || `/tmp/mission-control-${repoRootLogId(ROOT)}.log`;
}

function probeHttp(url = URL) {
  try {
    const code = execFileSync("curl", ["-sf", "-o", "/dev/null", "-w", "%{http_code}", url], {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    return code === "200";
  } catch {
    return false;
  }
}

function listeningPids(port = PORT) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    return out ? out.split(/\n+/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** @returns {string | null} */
function runningSnapshotRoot(port = PORT) {
  const dataUrl = `http://${DISPLAY_HOST}:${port}/dashboard-data.json`;
  try {
    const raw = execFileSync("curl", ["-sf", dataUrl], {
      encoding: "utf8",
      timeout: 8000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const data = JSON.parse(raw);
    const root = data?.system?.repoRoot;
    return typeof root === "string" && root.trim() ? resolve(root.trim()) : null;
  } catch {
    return null;
  }
}

/**
 * @param {number} port
 * @returns {{ listening: boolean, repoRoot: string | null }}
 */
function probePort(port) {
  const pids = listeningPids(port);
  if (pids.length === 0 && !probeHttp(`http://${DISPLAY_HOST}:${port}/`)) {
    return { listening: false, repoRoot: null };
  }
  return { listening: true, repoRoot: runningSnapshotRoot(port) };
}

function killListeners(pids) {
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // already gone
    }
  }
}

function hasSetsid() {
  try {
    execSync("command -v setsid >/dev/null 2>&1", { shell: true });
    return true;
  } catch {
    return false;
  }
}

function detachStart() {
  if (!existsSync(SERVE)) {
    throw new Error(`Missing server entry: ${SERVE}`);
  }

  const env = {
    ...process.env,
    [REPO_ROOT_ENV]: ROOT,
    PORT: String(PORT),
  };

  if (hasSetsid()) {
    const out = openSync(LOG, "a");
    const child = spawn("setsid", ["node", SERVE], {
      cwd: KIT_ROOT,
      detached: true,
      stdio: ["ignore", out, out],
      env,
    });
    child.unref();
    return;
  }

  // macOS and other hosts without setsid: Perl double-fork + setsid().
  // Escape @/$ so scoped package paths (node_modules/@scope/...) survive Perl qq.
  const rootEsc = escapePerlDoubleQuoted(KIT_ROOT);
  const serveEsc = escapePerlDoubleQuoted(SERVE);
  const logEsc = escapePerlDoubleQuoted(LOG);
  const portEsc = escapePerlDoubleQuoted(String(PORT));
  const snapEsc = escapePerlDoubleQuoted(ROOT);
  const perl = [
    "use POSIX qw(setsid);",
    "exit if fork;",
    "setsid();",
    "exit if fork;",
    'open(STDIN,"<","/dev/null");',
    `open(STDOUT,">","${logEsc}");`,
    'open(STDERR,">&STDOUT");',
    `chdir("${rootEsc}");`,
    `$ENV{PORT}="${portEsc}";`,
    `$ENV{${REPO_ROOT_ENV}}="${snapEsc}";`,
    `exec("node","${serveEsc}");`,
  ].join(" ");

  const child = spawn("perl", ["-e", perl], {
    cwd: KIT_ROOT,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
}

async function waitReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (probeHttp()) return true;
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  return false;
}

async function ensureServer() {
  const allocation = resolveMissionControlPort({
    repoRoot: ROOT,
    envPort: process.env.PORT,
    probe: probePort,
  });
  setPort(allocation.port);
  // Pin PORT for this process and children.
  process.env.PORT = String(PORT);

  if (allocation.reuse) {
    console.log(`Mission Control already listening at ${URL}`);
    if (ROOT !== KIT_ROOT) {
      console.log(`Snapshot root: ${ROOT}`);
    }
    return;
  }

  // Own port free (or we are about to bind). If something is listening without
  // a matching repoRoot, resolveMissionControlPort already skipped it — except
  // explicit PORT, which throws. Optional: restart our own stale instance when
  // listening but probe returned matching root with reuse=false (should not happen).
  const pids = listeningPids();
  if (pids.length > 0) {
    const current = runningSnapshotRoot();
    if (sameRepoRoot(current, ROOT)) {
      // Healthy reuse should have been reuse:true; treat as restart of ours only.
      console.log(`Restarting Mission Control for ${ROOT} on port ${PORT}…`);
      killListeners(pids);
      await new Promise((r) => setTimeout(r, 400));
    } else if (current == null) {
      // Explicit PORT path cannot reach here (throws). Hashed path skips unknowns.
      // Defensive: do not kill.
      throw new Error(
        `Port ${PORT} is busy (${pids.join(",")}) and is not this workspace. Refusing to kill.`,
      );
    } else {
      throw new Error(
        `Port ${PORT} is snapshotting ${current}; refusing to kill. Unset PORT or stop that instance.`,
      );
    }
  }

  console.log(`Starting Mission Control on ${URL}…`);
  if (ROOT !== KIT_ROOT) {
    console.log(`Snapshot root: ${ROOT}`);
  }
  detachStart();
  const ready = await waitReady();
  if (!ready) {
    console.error(`Mission Control did not answer ${URL} within ${READY_TIMEOUT_MS}ms.`);
    console.error(`Check the log: ${LOG}`);
    process.exit(1);
  }
}

async function main() {
  process.env[REPO_ROOT_ENV] = ROOT;

  await ensureServer();

  console.log(URL);
  if (process.env.MISSION_CONTROL_NO_OPEN === "1") {
    return;
  }
  let configValue = null;
  const cfg = resolveContextConfigPath(ROOT, { existsSync });
  if (cfg.ok) {
    configValue = readPreferredBrowserFromConfig(cfg.path);
  }
  const result = openBrowser(URL, { configValue });
  if (result.opened) {
    if (result.reason === "preferred-fallback") {
      console.log(
        "Preferred browser failed; opened with the OS default. In Cursor, Simple Browser or /dashboard also works.",
      );
    } else {
      console.log(
        "Opened in the preferred browser (or OS default). In Cursor, Simple Browser or /dashboard also works.",
      );
    }
  } else if (result.reason !== "no-open") {
    console.log("Open that URL in a browser (Cursor: Simple Browser, or run /dashboard in chat).");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
