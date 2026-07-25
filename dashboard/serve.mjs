#!/usr/bin/env node
// dashboard/serve.mjs
// Server for the Startup Kit Dashboard
// - Serves dashboard HTML
// - Generates dashboard-data.json on each request
// - SSE endpoint for live push updates

import { createServer } from 'node:http';
import { readFileSync, existsSync, watch, realpathSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_HOST,
  resolveBindHost,
  applyCorsHeaders,
  resolveDashboardStatic,
} from './lib/guards.mjs';
import {
  WATCH_DEBOUNCE_MS,
  PERIODIC_REFRESH_MS,
  resolveWatchPaths,
  createTrailingDebounce,
} from './lib/live-refresh.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DASHBOARD_DIR = __dirname;
const HOST = resolveBindHost(process.env.HOST);
const PORT = parseInt(process.env.PORT || '3333', 10);
const DASHBOARD_REAL = realpathSync(DASHBOARD_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const dataScript = join(__dirname, 'dashboard-data.mjs');

function setCorsHeaders(req, res) {
  applyCorsHeaders(req, res, PORT);
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
// stack sync child processes and block the event loop for tens of seconds.
const CACHE_TTL_MS = 2000;
let cachedPayload = null;
let cachedAt = 0;
let inFlight = false;

function generateDataSyncUncached() {
  try {
    return execFileSync(process.execPath, [dataScript], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000,
    });
  } catch (e) {
    // Every collection the panel reads must be present, or the render throws
    // and a snapshot failure surfaces as "Render Failed" instead of an
    // empty panel.
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      version: 'error',
      error: e.message,
      plans: [], system: {}, agents: [], commands: [], skills: [],
      memory: {}, git: {}, terminals: [], processes: [],
      health: { status: 'error', checks: [] },
      missionControl: null,
    });
  }
}

function generateDataSync({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedPayload && now - cachedAt < CACHE_TTL_MS) {
    return cachedPayload;
  }
  // Sync generation blocks the event loop; overlapping callers only run after
  // we return, when the cache is warm. Never return a non-JSON sentinel.
  if (inFlight && cachedPayload) {
    return cachedPayload;
  }
  inFlight = true;
  try {
    const payload = generateDataSyncUncached();
    cachedPayload = payload;
    cachedAt = Date.now();
    return payload;
  } finally {
    inFlight = false;
  }
}

function broadcast(data) {
  const msg = `data: ${data}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

let lastBroadcastAt = 0;

const scheduleBroadcast = createTrailingDebounce(() => {
  const data = generateDataSync({ force: true });
  lastBroadcastAt = Date.now();
  broadcast(data);
}, WATCH_DEBOUNCE_MS);

// Watch every in-repo snapshot source (full `.cursor` tree + package + data script).
const watchPaths = resolveWatchPaths(ROOT, __dirname);

for (const p of watchPaths) {
  if (!existsSync(p)) {
    console.warn(`[watch] skip missing path: ${p}`);
    continue;
  }
  try {
    watch(p, { recursive: true }, () => {
      scheduleBroadcast();
    });
  } catch (err) {
    console.warn(`[watch] failed for ${p}: ${err && err.message ? err.message : err}`);
  }
}

// Git / terminals / processes do not touch watched files; keep SSE clients fresh.
setInterval(() => {
  if (sseClients.size === 0) return;
  if (Date.now() - lastBroadcastAt < PERIODIC_REFRESH_MS) return;
  scheduleBroadcast();
}, PERIODIC_REFRESH_MS);

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  setCorsHeaders(req, res);

  // SSE endpoint
  if (path === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial data
    const data = generateDataSync();
    res.write(`data: ${data}\n\n`);

    sseClients.add(res);
    const clientAddr = req.socket.remoteAddress || 'unknown';
    console.log(`[SSE] Client connected: ${clientAddr} (${sseClients.size} clients)`);

    req.on('close', () => {
      sseClients.delete(res);
      console.log(`[SSE] Client disconnected: ${clientAddr} (${sseClients.size} clients remaining)`);
    });

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write(':heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 30000);

    req.on('close', () => clearInterval(heartbeat));
    return;
  }

  // Data endpoint
  if (path === '/dashboard-data.json' || path === '/api/data') {
    const data = generateDataSync();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
    return;
  }

  const staticPath = resolveStaticPath(path);
  if (!staticPath) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = extname(staticPath);
  const contentType = MIME[ext] || 'application/octet-stream';
  const content = readFileSync(staticPath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
});

server.listen(PORT, HOST, () => {
  const loopback = HOST === DEFAULT_HOST || HOST === 'localhost' || HOST === '::1';
  if (!loopback) {
    console.warn(
      `[WARN] Mission Control bound to ${HOST}:${PORT}, not loopback. Do not expose on shared networks.`,
    );
  }

  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  Mission Control\n`);
  console.log(`  Local:   ${url}`);
  console.log(`  Data:    ${url}/dashboard-data.json`);
  console.log(`  Events:  ${url}/api/events (SSE)`);
  console.log(`\n  Open in Cursor Simple Browser or your browser.\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});