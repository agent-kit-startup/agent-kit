#!/usr/bin/env node
/**
 * Terminal counterpart to `/dashboard-broadcast`.
 *
 * Opt-in LAN bind: HOST=0.0.0.0 (or explicit non-loopback), requires
 * MISSION_CONTROL_TOKEN (generated when unset), detach-starts serve.mjs,
 * prints LAN URL(s) with token. Does not weaken loopback `/dashboard`.
 */

import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBroadcastShareUrl,
  resolveShareBase,
  resolveShareShowLan,
  resolveShareTtlSec,
} from "./lib/broadcast-share.mjs";
import {
  BROADCAST_TOKEN_ENV,
  escapePerlDoubleQuoted,
  generateBroadcastToken,
  isLoopbackBindHost,
  isValidBroadcastToken,
  listLanIPv4Addresses,
  normalizeAuthToken,
  resolveBindHost,
  resolveContextConfigPath,
  resolveSnapshotRepoRoot,
} from "./lib/guards.mjs";
import { openBrowser, readPreferredBrowserFromConfig } from "./lib/open-browser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = join(__dirname, "..");
/** Workspace snapshots / preference config. Defaults to KIT_ROOT. */
const ROOT = resolveSnapshotRepoRoot(process.env, KIT_ROOT);
const SERVE = join(__dirname, "serve.mjs");
const LOG = process.env.MISSION_CONTROL_LOG || "/tmp/mission-control-broadcast.log";
const PORT = Number.parseInt(process.env.PORT || "3333", 10);
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 250;

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

function urlsForProbe(token) {
  const q = `?token=${encodeURIComponent(token)}`;
  const urls = [`http://127.0.0.1:${PORT}/${q}`];
  for (const ip of listLanIPv4Addresses()) {
    urls.push(`http://${ip}:${PORT}/${q}`);
  }
  return urls;
}

function probeHttp(url) {
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

function listeningPids() {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"], {
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

async function main() {
  const { env, host, token } = resolveBroadcastEnv();
  if (isLoopbackBindHost(host)) {
    console.error(
      "Broadcast refused: bind host resolved to loopback. Set HOST to a non-loopback address.",
    );
    process.exit(1);
  }

  const urls = urlsForProbe(token);
  const primaryLan = listLanIPv4Addresses()[0];
  const displayUrl =
    primaryLan != null
      ? `http://${primaryLan}:${PORT}/?token=${encodeURIComponent(token)}`
      : urls[0];

  const already = listeningPids().length > 0 && urls.some((u) => probeHttp(u));
  if (!already) {
    if (listeningPids().length > 0) {
      console.error(
        `Port ${PORT} is listening but did not accept the broadcast token. Stop the existing Mission Control instance (loopback /dashboard) first, then retry.`,
      );
      console.error(`  kill "$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t)"`);
      process.exit(1);
    }
    console.log(`Starting Mission Control broadcast on ${host}:${PORT}…`);
    detachStart(env);
    const ready = await waitReady(urls);
    if (!ready) {
      console.error(`Mission Control broadcast did not answer within ${READY_TIMEOUT_MS}ms.`);
      console.error(`Check the log: ${LOG}`);
      process.exit(1);
    }
  } else {
    console.log(`Mission Control broadcast already listening on port ${PORT}`);
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
  console.log("  Config writes stay loopback-only. Stop: kill the LISTEN pid on this port.");
  console.log("  Firewall: allow inbound TCP on this port for your LAN profile if needed.");
  console.log("");

  if (process.env.MISSION_CONTROL_NO_OPEN === "1") {
    return;
  }
  let configValue = null;
  const cfg = resolveContextConfigPath(ROOT, { existsSync });
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
