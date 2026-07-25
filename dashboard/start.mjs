#!/usr/bin/env node
/**
 * Terminal counterpart to the `/dashboard` slash command.
 *
 * Detects a listener on PORT (default 3333), detach-starts `serve.mjs` when
 * needed (double-fork / setsid so the process survives the shell), waits until
 * HTTP 200, prints the URL, and opens the default browser when possible.
 *
 * Foreground serve for debugging remains: `npm run start:dashboard`.
 */

import { spawn, execFileSync, execSync } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SERVE = join(__dirname, "serve.mjs");
const LOG = process.env.MISSION_CONTROL_LOG || "/tmp/mission-control.log";
const PORT = parseInt(process.env.PORT || "3333", 10);
const HOST = process.env.HOST || "127.0.0.1";
const DISPLAY_HOST = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
const URL = `http://${DISPLAY_HOST}:${PORT}/`;
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 250;

function probeHttp() {
  try {
    const code = execFileSync(
      "curl",
      ["-sf", "-o", "/dev/null", "-w", "%{http_code}", URL],
      { encoding: "utf8", timeout: 3000 },
    ).trim();
    return code === "200";
  } catch {
    return false;
  }
}

function listeningPids() {
  try {
    const out = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8", timeout: 3000 },
    ).trim();
    return out ? out.split(/\n+/).filter(Boolean) : [];
  } catch {
    return [];
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

  if (hasSetsid()) {
    const out = openSync(LOG, "a");
    const child = spawn("setsid", ["node", SERVE], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", out, out],
      env: process.env,
    });
    child.unref();
    return;
  }

  // macOS and other hosts without setsid: Perl double-fork + setsid().
  const rootEsc = ROOT.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const serveEsc = SERVE.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const logEsc = LOG.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const perl = [
    "use POSIX qw(setsid);",
    "exit if fork;",
    "setsid();",
    "exit if fork;",
    'open(STDIN,"<","/dev/null");',
    `open(STDOUT,">","${logEsc}");`,
    'open(STDERR,">&STDOUT");',
    `chdir("${rootEsc}");`,
    `exec("node","${serveEsc}");`,
  ].join(" ");

  const child = spawn("perl", ["-e", perl], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env: process.env,
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

function openBrowser(url) {
  const os = platform();
  try {
    if (os === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    if (os === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const already = probeHttp() || listeningPids().length > 0;
  if (!already) {
    console.log(`Starting Mission Control on ${URL}…`);
    detachStart();
    const ready = await waitReady();
    if (!ready) {
      console.error(
        `Mission Control did not answer ${URL} within ${READY_TIMEOUT_MS}ms.`,
      );
      console.error(`Check the log: ${LOG}`);
      process.exit(1);
    }
  } else {
    console.log(`Mission Control already listening at ${URL}`);
  }

  console.log(URL);
  if (process.env.MISSION_CONTROL_NO_OPEN === "1") {
    return;
  }
  if (openBrowser(URL)) {
    console.log(
      "Opened in the default browser. In Cursor, Simple Browser or /dashboard also works.",
    );
  } else {
    console.log(
      "Open that URL in a browser (Cursor: Simple Browser, or run /dashboard in chat).",
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
