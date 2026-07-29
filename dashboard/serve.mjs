#!/usr/bin/env node
// dashboard/serve.mjs
// Server for the Startup Kit Dashboard
// - Serves dashboard HTML
// - Generates dashboard-data.json on each request
// - SSE endpoint for live push updates

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, watch, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HOST,
  REPO_ROOT_ENV,
  allowlistConfig,
  applyCorsHeaders,
  authorizeMissionControlRequest,
  broadcastAuthCookieHeader,
  isAllowedOrigin,
  isLoopbackAddress,
  listLanIPv4Addresses,
  mergeConfigAllowlist,
  resolveBroadcastAuth,
  resolveContextConfigPath,
  resolveDashboardStatic,
  resolveSnapshotRepoRoot,
  validateConfigWriteBody,
} from "./lib/guards.mjs";
import {
  PERIODIC_REFRESH_MS,
  WATCH_DEBOUNCE_MS,
  createTrailingDebounce,
  resolveAgentTranscriptsWatchPath,
  resolveWatchPaths,
} from "./lib/live-refresh.mjs";
import { buildInventoryBaseline } from "./lib/semantic-model.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Kit tree that owns `dashboard/` static assets and serve.mjs. */
const KIT_ROOT = join(__dirname, "..");
/** Workspace Mission Control snapshots (plans, HANDOFF, git). Defaults to KIT_ROOT. */
const ROOT = resolveSnapshotRepoRoot(process.env, KIT_ROOT);
const DASHBOARD_DIR = __dirname;
const authResolved = resolveBroadcastAuth(process.env);
if (!authResolved.ok) {
  console.error(`[ERROR] ${authResolved.error}`);
  process.exit(1);
}
const HOST = authResolved.host;
const PORT = Number.parseInt(process.env.PORT || "3333", 10);
const TOKEN_REQUIRED = authResolved.tokenRequired;
const AUTH_TOKEN = authResolved.token;
const DASHBOARD_REAL = realpathSync(DASHBOARD_DIR);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const dataScript = join(__dirname, "dashboard-data.mjs");

/** Compact inventory baseline fed back into the next data-script run via env. */
let previousInventoryJson = null;

/**
 * @param {string} payload
 * @returns {string|null}
 */
function inventoryBaselineJsonFromPayload(payload) {
  try {
    const data = JSON.parse(payload);
    if (!data || data.error) return null;
    return JSON.stringify(
      buildInventoryBaseline({
        agents: data.agents,
        skills: data.skills,
        commands: data.commands,
        memory: data.memory,
      }),
    );
  } catch {
    return null;
  }
}

function setCorsHeaders(req, res) {
  applyCorsHeaders(req, res, PORT);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<string>}
 */
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 64 * 1024;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {object} payload
 */
function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/**
 * Narrow allowlisted merge-write for `.cursor/context/config.json`.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handleConfigWrite(req, res) {
  const remote = req.socket?.remoteAddress;
  if (!isLoopbackAddress(remote)) {
    sendJson(res, 403, { error: "loopback only" });
    return;
  }
  const origin = req.headers?.origin;
  if (origin && !isAllowedOrigin(origin, PORT)) {
    sendJson(res, 403, { error: "origin not allowed" });
    return;
  }

  let rawBody;
  try {
    rawBody = await readRequestBody(req);
  } catch (err) {
    sendJson(res, 413, { error: err?.message || "body read failed" });
    return;
  }

  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    sendJson(res, 400, { error: "invalid JSON" });
    return;
  }

  const validated = validateConfigWriteBody(body);
  if (!validated.ok) {
    sendJson(res, 400, { error: validated.error });
    return;
  }

  const locked = resolveContextConfigPath(ROOT, { existsSync, realpathSync, mkdirSync });
  if (!locked.ok) {
    sendJson(res, 500, { error: locked.error });
    return;
  }

  let existing = {};
  if (existsSync(locked.path)) {
    try {
      existing = JSON.parse(readFileSync(locked.path, "utf8"));
      if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        sendJson(res, 500, { error: "existing config is not an object" });
        return;
      }
    } catch {
      sendJson(res, 500, { error: "existing config parse error" });
      return;
    }
  }

  const merged = mergeConfigAllowlist(existing, validated.patch);
  try {
    writeFileSync(locked.path, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  } catch (err) {
    sendJson(res, 500, { error: err?.message || "write failed" });
    return;
  }

  cachedPayload = null;
  cachedAt = 0;
  scheduleBroadcast();

  sendJson(res, 200, { ok: true, config: allowlistConfig(merged) });
}

function resolveStaticPath(pathname) {
  return resolveDashboardStatic(pathname, {
    dashboardDir: DASHBOARD_DIR,
    dashboardReal: DASHBOARD_REAL,
    existsSync,
    realpathSync,
  });
}

// SSE clients
const sseClients = new Set();

// Short TTL cache + single-flight so concurrent HTTP/SSE requests do not
// stack child processes. Generation is async so heartbeats and accepts stay live.
const CACHE_TTL_MS = 2000;
let cachedPayload = null;
let cachedAt = 0;
/** @type {Promise<string> | null} */
let inFlight = null;

function errorPayload(message) {
  // Every collection the panel reads must be present, or the render throws
  // and a snapshot failure surfaces as "Render Failed" instead of an
  // empty panel.
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    version: "error",
    error: message,
    plans: [],
    system: {},
    agents: [],
    commands: [],
    skills: [],
    memory: {},
    git: {},
    terminals: [],
    processes: [],
    health: { status: "error", checks: [] },
    missionControl: null,
  });
}

// Cold snapshot on a busy dogfood repo can exceed 15s; killing the child
// yields health:error and a Degraded badge with empty cockpit panels.
// Override with AGENT_KIT_DASHBOARD_DATA_TIMEOUT_MS (ms) when needed.
const DATA_SCRIPT_TIMEOUT_MS = (() => {
  const raw = process.env.AGENT_KIT_DASHBOARD_DATA_TIMEOUT_MS;
  const n = raw != null && raw !== "" ? Number(raw) : 60_000;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
})();

function runDataScript() {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      // Pin snapshot root for the child even if the parent cwd differs.
      [REPO_ROOT_ENV]: ROOT,
      // Empty string = cold start (dashboard-data treats falsy as no previous).
      AGENT_KIT_PREV_INVENTORY: previousInventoryJson || "",
    };
    execFile(
      process.execPath,
      [dataScript],
      {
        cwd: ROOT,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: DATA_SCRIPT_TIMEOUT_MS,
        env,
      },
      (err, stdout) => {
        if (err) {
          const timedOut = err.killed || err.signal === "SIGTERM";
          const message = timedOut
            ? `dashboard-data.mjs timed out after ${DATA_SCRIPT_TIMEOUT_MS}ms (set AGENT_KIT_DASHBOARD_DATA_TIMEOUT_MS to raise)`
            : err.message;
          resolve(errorPayload(message));
          return;
        }
        const baseline = inventoryBaselineJsonFromPayload(stdout);
        if (baseline) previousInventoryJson = baseline;
        resolve(stdout);
      },
    );
  });
}

/**
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<string>}
 */
async function generateData({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedPayload && now - cachedAt < CACHE_TTL_MS) {
    return cachedPayload;
  }
  if (inFlight) {
    const payload = await inFlight;
    if (!force) return payload;
    if (cachedPayload && Date.now() - cachedAt < CACHE_TTL_MS) {
      return cachedPayload;
    }
  }
  inFlight = runDataScript()
    .then((payload) => {
      cachedPayload = payload;
      cachedAt = Date.now();
      return payload;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * SSE data fields are line-oriented: only lines prefixed with `data:` become
 * event.data. Pretty-printed JSON (newlines) would deliver a broken `{` fragment
 * and the browser client would silently drop every push. Always emit one line.
 * @param {string} data
 */
function toSseDataLine(data) {
  try {
    return JSON.stringify(JSON.parse(data));
  } catch {
    return String(data).replace(/\r?\n/g, " ");
  }
}

function writeSseData(res, data) {
  res.write(`data: ${toSseDataLine(data)}\n\n`);
}

function broadcast(data) {
  const msg = `data: ${toSseDataLine(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

let lastBroadcastAt = 0;

/** Fresh snapshot + push. Skips work when nobody is listening. */
async function flushBroadcast() {
  if (sseClients.size === 0) return;
  const data = await generateData({ force: true });
  lastBroadcastAt = Date.now();
  broadcast(data);
}

// Watch bursts coalesce; maxWait guarantees a flush during continuous writes.
const scheduleBroadcast = createTrailingDebounce(
  () => {
    void flushBroadcast();
  },
  WATCH_DEBOUNCE_MS,
  { maxWait: PERIODIC_REFRESH_MS },
);

// Watch every in-repo snapshot source (full `.cursor` tree + package + data script).
const watchPaths = resolveWatchPaths(ROOT, __dirname);
// External: agent transcripts (Field Report prompts). Outside SNAPSHOT_REPO_SOURCE_RELS;
// without this watch, prompt rows wait on PERIODIC_REFRESH_MS alone.
const agentTranscriptsWatch = resolveAgentTranscriptsWatchPath(ROOT);
const allWatchPaths = [...watchPaths, agentTranscriptsWatch];

for (const p of allWatchPaths) {
  if (!existsSync(p)) {
    console.warn(`[watch] skip missing path: ${p}`);
    continue;
  }
  try {
    watch(p, { recursive: true }, () => {
      scheduleBroadcast();
    });
  } catch (err) {
    console.warn(`[watch] failed for ${p}: ${err?.message ? err.message : err}`);
  }
}

// Git / terminals / processes do not touch watched files; keep SSE clients fresh.
// Call flushBroadcast directly (not via trailing debounce) so watch-event storms
// cannot starve the periodic cadence.
setInterval(() => {
  if (sseClients.size === 0) return;
  if (Date.now() - lastBroadcastAt < PERIODIC_REFRESH_MS) return;
  void flushBroadcast();
}, PERIODIC_REFRESH_MS);

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  setCorsHeaders(req, res);

  if (path === "/api/config" && req.method === "OPTIONS") {
    const origin = req.headers?.origin;
    if (origin && isAllowedOrigin(origin, PORT)) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "PUT, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin",
      });
    } else {
      res.writeHead(204);
    }
    res.end();
    return;
  }

  if (path === "/api/config" && (req.method === "PUT" || req.method === "PATCH")) {
    // Config mutations stay loopback-only (token does not unlock writes from LAN).
    void handleConfigWrite(req, res);
    return;
  }

  const auth = authorizeMissionControlRequest(req, url, {
    tokenRequired: TOKEN_REQUIRED,
    expectedToken: AUTH_TOKEN,
  });
  if (!auth.ok) {
    sendJson(res, auth.status || 401, { error: auth.error || "unauthorized" });
    return;
  }
  if (auth.viaQuery && AUTH_TOKEN) {
    res.setHeader("Set-Cookie", broadcastAuthCookieHeader(AUTH_TOKEN));
  }

  // SSE endpoint
  if (path === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    sseClients.add(res);
    const clientAddr = req.socket.remoteAddress || "unknown";
    console.log(`[SSE] Client connected: ${clientAddr} (${sseClients.size} clients)`);

    // Prefer warm cache so connect does not block the event loop; refresh after.
    if (cachedPayload) {
      try {
        writeSseData(res, cachedPayload);
      } catch {
        // client gone
      }
      if (Date.now() - cachedAt >= CACHE_TTL_MS) {
        void flushBroadcast();
      }
    } else {
      void generateData().then((data) => {
        try {
          writeSseData(res, data);
        } catch {
          // client gone
        }
      });
    }

    req.on("close", () => {
      sseClients.delete(res);
      console.log(
        `[SSE] Client disconnected: ${clientAddr} (${sseClients.size} clients remaining)`,
      );
    });

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write(":heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 30000);

    req.on("close", () => clearInterval(heartbeat));
    return;
  }

  // Data endpoint
  if (path === "/dashboard-data.json" || path === "/api/data") {
    void generateData().then((data) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    });
    return;
  }

  const staticPath = resolveStaticPath(path);
  if (!staticPath) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = extname(staticPath);
  const contentType = MIME[ext] || "application/octet-stream";
  const content = readFileSync(staticPath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
});

server.listen(PORT, HOST, () => {
  const loopback = HOST === DEFAULT_HOST || HOST === "localhost" || HOST === "::1";
  if (!loopback) {
    console.warn(
      `[WARN] Mission Control broadcast mode on ${HOST}:${PORT}. Token gate is required; config writes stay loopback-only.`,
    );
  }

  console.log("\n  Mission Control\n");
  if (loopback) {
    const url = `http://127.0.0.1:${PORT}`;
    console.log(`  Local:   ${url}`);
    console.log(`  Data:    ${url}/dashboard-data.json`);
    console.log(`  Events:  ${url}/api/events (SSE)`);
    console.log(`  Config:  ${url}/api/config (PUT/PATCH, loopback)`);
  } else {
    const lan = listLanIPv4Addresses();
    const tokenQ = AUTH_TOKEN ? `?token=${encodeURIComponent(AUTH_TOKEN)}` : "";
    console.log(`  Bind:    ${HOST}:${PORT} (token-gated)`);
    console.log(`  Local:   http://127.0.0.1:${PORT}/${tokenQ}`);
    if (lan.length === 0) {
      console.log("  LAN:     (no non-internal IPv4 found; check Wi-Fi / Ethernet)");
    } else {
      for (const ip of lan) {
        console.log(`  LAN:     http://${ip}:${PORT}/${tokenQ}`);
      }
    }
    console.log("  Token:   printed once above in each LAN URL (MISSION_CONTROL_TOKEN)");
    console.log("  Config:  PUT/PATCH /api/config remains loopback-only");
    console.log("  Firewall: allow inbound TCP on this port for your LAN profile if needed");
  }
  console.log(`  Snapshot: ${ROOT}`);
  if (ROOT !== KIT_ROOT) {
    console.log(`  Kit:     ${KIT_ROOT}`);
  }
  console.log("\n  Open in Cursor Simple Browser or your browser.\n");
  console.log("  Press Ctrl+C to stop.\n");
});
