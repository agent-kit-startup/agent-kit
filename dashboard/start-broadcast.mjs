#!/usr/bin/env node
/**
 * Terminal counterpart to `/dashboard-broadcast`.
 *
 * Opt-in LAN bind: HOST=0.0.0.0 (or explicit non-loopback), requires
 * MISSION_CONTROL_TOKEN (generated when unset), detach-starts serve.mjs,
 * prints LAN URL(s) with token. Does not weaken loopback `/dashboard`.
 *
 * Multi-instance: the listen port is the same per-workspace allocation the
 * loopback starter uses (hash of the snapshot root in the 3333-3588 range unless
 * PORT is set). Candidate ports held by this workspace's loopback panel, another
 * workspace, or an unidentified process are skipped - never killed - so a
 * broadcast can come up beside an already-running Mission Control.
 */

import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, openSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBroadcastShareUrl,
  resolveShareBase,
  resolveShareShowLan,
  resolveShareTtlSec,
} from "./lib/broadcast-share.mjs";
import {
  BROADCAST_TOKEN_ENV,
  REPO_ROOT_ENV,
  describeBroadcastListener,
  escapePerlDoubleQuoted,
  generateBroadcastToken,
  isLoopbackBindHost,
  isValidBroadcastToken,
  listLanIPv4Addresses,
  normalizeAuthToken,
  repoRootLogId,
  resolveBindHost,
  resolveBroadcastPort,
  resolveContextConfigPath,
  resolveSnapshotRepoRoot,
} from "./lib/guards.mjs";
import { openBrowser, readPreferredBrowserFromConfig } from "./lib/open-browser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = join(__dirname, "..");
/** Workspace snapshots / preference config. Defaults to KIT_ROOT. */
const ROOT = resolveSnapshotRepoRoot(process.env, KIT_ROOT);
process.title = `Mission Control · ${basename(ROOT) || "workspace"}`;
const SERVE = join(__dirname, "serve.mjs");
const LOG =
  process.env.MISSION_CONTROL_LOG || `/tmp/mission-control-broadcast-${repoRootLogId(ROOT)}.log`;
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 250;

/** Allocated listen port for this run (see resolveBroadcastPort in main). */
let PORT = 0;

function resolveBroadcastEnv() {
  const env = { ...process.env };
  let host = resolveBindHost(env.HOST);
  if (isLoopbackBindHost(host)) {
    host = "0.0.0.0";
  }
  env.HOST = host;

  let token = normalizeAuthToken(env[BROADCAST_TOKEN_ENV]);
  if (!isValidBroadcastToken(token)) {
    token = generateBroadcastToken();
    env[BROADCAST_TOKEN_ENV] = token;
  }
  return { env, host, token };
}

function urlsForProbe(token, port = PORT) {
  const q = `?token=${encodeURIComponent(token)}`;
  const urls = [`http://127.0.0.1:${port}/${q}`];
  for (const ip of listLanIPv4Addresses()) {
    urls.push(`http://${ip}:${port}/${q}`);
  }
  return urls;
}

/** HTTP status code as a string; "000" when the connection failed. */
function httpStatus(url) {
  try {
    return execFileSync(
      "curl",
      ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "3", url],
      { encoding: "utf8", timeout: 5000 },
    ).trim();
  } catch {
    return "000";
  }
}

function probeHttp(url) {
  return httpStatus(url) === "200";
}

/** Snapshot root reported by a listener that accepts our token, else null. */
function snapshotRootAt(port, token) {
  const url = `http://127.0.0.1:${port}/dashboard-data.json?token=${encodeURIComponent(token)}`;
  try {
    const raw = execFileSync("curl", ["-sf", url], {
      encoding: "utf8",
      timeout: 8000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const root = JSON.parse(raw)?.system?.repoRoot;
    return typeof root === "string" && root.trim() ? resolve(root.trim()) : null;
  } catch {
    return null;
  }
}

/**
 * Probe one candidate port for `resolveBroadcastPort`.
 *
 * `lanReachable` is what separates our own broadcast (reusable) from our own
 * loopback panel: a loopback listener needs no token, so it answers `?token=…`
 * with 200 on 127.0.0.1 while staying unreachable on every LAN address.
 */
function probeBroadcastPort(port, token) {
  const q = `?token=${encodeURIComponent(token)}`;
  const loopbackStatus = httpStatus(`http://127.0.0.1:${port}/${q}`);
  const listening = loopbackStatus !== "000" || listeningPids(port).length > 0;
  if (!listening) {
    return { listening: false, repoRoot: null, acceptsToken: false, tokenGated: false };
  }
  const acceptsToken = loopbackStatus === "200";
  if (!acceptsToken) {
    return {
      listening: true,
      repoRoot: null,
      acceptsToken: false,
      tokenGated: loopbackStatus === "401" || loopbackStatus === "403",
    };
  }
  const ips = listLanIPv4Addresses();
  return {
    listening: true,
    repoRoot: snapshotRootAt(port, token),
    acceptsToken: true,
    tokenGated: false,
    lanReachable: ips.length > 0 ? ips.some((ip) => probeHttp(`http://${ip}:${port}/${q}`)) : null,
  };
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

function hasSetsid() {
  try {
    execSync("command -v setsid >/dev/null 2>&1", { shell: true });
    return true;
  } catch {
    return false;
  }
}

function detachStart(env) {
  if (!existsSync(SERVE)) {
    throw new Error(`Missing server entry: ${SERVE}`);
  }

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

  // Escape @/$ so scoped package paths (node_modules/@scope/...) survive Perl qq.
  const rootEsc = escapePerlDoubleQuoted(KIT_ROOT);
  const serveEsc = escapePerlDoubleQuoted(SERVE);
  const logEsc = escapePerlDoubleQuoted(LOG);
  const hostEsc = escapePerlDoubleQuoted(String(env.HOST));
  const tokenEsc = escapePerlDoubleQuoted(String(env[BROADCAST_TOKEN_ENV]));
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
    `$ENV{HOST}="${hostEsc}";`,
    `$ENV{${BROADCAST_TOKEN_ENV}}="${tokenEsc}";`,
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

async function waitReady(urls) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const url of urls) {
      if (probeHttp(url)) return url;
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  return null;
}

/**
 * Preflight: name every candidate port we walked past. Nothing here is killed —
 * a busy port means another Mission Control (ours or someone else's) keeps
 * running and broadcast lands on the next free per-workspace port.
 */
function reportSkipped(skipped) {
  if (!skipped || skipped.length === 0) return;
  console.log("Ports already held (left running):");
  for (const entry of skipped) {
    console.log(`  ${describeBroadcastListener(entry.kind, entry)}`);
  }
  if (skipped.some((entry) => entry.kind === "token-gated")) {
    console.log(
      `  Export ${BROADCAST_TOKEN_ENV} with an existing broadcast's token to reuse it instead of starting another.`,
    );
  }
}

/** Recovery text for a port we may not take. Never a blind kill of a foreign listener. */
function recoveryLines(kind, port) {
  switch (kind) {
    case "self-other-mode":
      return [
        `  That listener is this workspace (${ROOT}). Stop it yourself if you want this exact port:`,
        `    kill "$(lsof -nP -iTCP:${port} -sTCP:LISTEN -t)"`,
        "  Or retry with PORT unset: broadcast will take a free per-workspace port and leave it running.",
      ];
    case "foreign":
      return [
        "  Leave that workspace's Mission Control running. Retry with PORT unset to take a free per-workspace port.",
      ];
    case "token-gated":
      return [
        `  Export ${BROADCAST_TOKEN_ENV} with that instance's token to reuse it, or retry with PORT unset.`,
      ];
    case "exhausted":
      return [
        "  Every candidate port in this workspace's range is held by an instance that is not ours to stop.",
        "  Stop one of your own Mission Control instances, or set PORT to a port you know is free.",
      ];
    default:
      return [
        "  Leave that process alone. Retry with PORT unset to take a free per-workspace port.",
      ];
  }
}

function reportRefusal(err) {
  console.error(err instanceof Error ? err.message : String(err));
  const info = err?.broadcast;
  if (!info) return;
  if (info.kind === "exhausted" && info.skipped?.length) {
    console.error("Ports checked (all left running):");
    for (const entry of info.skipped.slice(0, 8)) {
      console.error(`  ${describeBroadcastListener(entry.kind, entry)}`);
    }
  }
  for (const line of recoveryLines(info.kind, info.port)) {
    console.error(line);
  }
}

async function main() {
  const { env, host, token } = resolveBroadcastEnv();
  if (isLoopbackBindHost(host)) {
    console.error(
      "Broadcast refused: bind host resolved to loopback. Set HOST to a non-loopback address.",
    );
    process.exit(1);
  }

  let allocation;
  try {
    allocation = resolveBroadcastPort({
      repoRoot: ROOT,
      envPort: process.env.PORT,
      probe: (port) => probeBroadcastPort(port, token),
    });
  } catch (err) {
    reportRefusal(err);
    process.exit(1);
  }

  reportSkipped(allocation.skipped);

  PORT = allocation.port;
  // Pin the allocation for this process and the detached server.
  process.env.PORT = String(PORT);
  env.PORT = String(PORT);
  env[REPO_ROOT_ENV] = ROOT;

  const urls = urlsForProbe(token);
  const primaryLan = listLanIPv4Addresses()[0];
  const displayUrl =
    primaryLan != null
      ? `http://${primaryLan}:${PORT}/?token=${encodeURIComponent(token)}`
      : urls[0];

  if (allocation.reuse) {
    console.log(`Mission Control broadcast already listening on port ${PORT} for ${ROOT}`);
  } else {
    console.log(`Starting Mission Control broadcast on ${host}:${PORT}…`);
    detachStart(env);
    const ready = await waitReady(urls);
    if (!ready) {
      console.error(`Mission Control broadcast did not answer within ${READY_TIMEOUT_MS}ms.`);
      console.error(`Check the log: ${LOG}`);
      process.exit(1);
    }
  }

  const shareBase = resolveShareBase(process.env);
  let shareUrl = null;
  if (shareBase != null) {
    try {
      shareUrl = buildBroadcastShareUrl(displayUrl, {
        base: shareBase,
        ttlSec: resolveShareTtlSec(process.env),
      });
    } catch (err) {
      // Non-RFC1918 primary LAN (Tailscale 100.64/10, public/DMZ) cannot encode into
      // the share fragment allowlist — degrade to LAN/token print instead of exit 1.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Share URL skipped (${msg}). Printing LAN/token only.`);
      shareUrl = null;
    }
  }
  const showLan = resolveShareShowLan(process.env);
  const openTarget = shareUrl || displayUrl;

  console.log("");
  console.log("  Mission Control (LAN broadcast)");
  console.log(`  Bind:  ${host}:${PORT}`);
  if (shareUrl) {
    console.log(`  Share: ${shareUrl}`);
  }
  console.log(`  Token: ${token}`);
  if (showLan || !shareUrl) {
    for (const ip of listLanIPv4Addresses()) {
      console.log(`  LAN:   http://${ip}:${PORT}/?token=${encodeURIComponent(token)}`);
    }
    console.log(`  Local: http://127.0.0.1:${PORT}/?token=${encodeURIComponent(token)}`);
  }
  if (shareUrl) {
    console.log(
      "  Share is a cosmetic Mission Kit (or BYO) link; phone must still reach this LAN.",
    );
  }
  console.log(`  Root:  ${ROOT}`);
  console.log(
    "  Config writes stay loopback-only. Stop this workspace only: kill the LISTEN pid on this port.",
  );
  console.log("  Firewall: allow inbound TCP on this port for your LAN profile if needed.");
  console.log("");

  if (process.env.MISSION_CONTROL_NO_OPEN === "1") {
    return;
  }
  let configValue = null;
  const cfg = resolveContextConfigPath(ROOT, { existsSync, realpathSync });
  if (cfg.ok) {
    configValue = readPreferredBrowserFromConfig(cfg.path);
  }
  const result = openBrowser(openTarget, { configValue });
  if (result.opened) {
    if (result.reason === "preferred-fallback") {
      console.log(
        shareUrl
          ? "Preferred browser failed; opened share URL with the OS default."
          : "Preferred browser failed; opened primary URL with the OS default.",
      );
    } else {
      console.log(
        shareUrl
          ? "Opened share URL in the preferred browser (or OS default)."
          : "Opened primary URL in the preferred browser (or OS default).",
      );
    }
  } else if (result.reason !== "no-open") {
    console.log(
      shareUrl
        ? "Open the Share URL above on your phone/tablet browser."
        : "Open a LAN URL above on your phone/tablet browser.",
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
