/**
 * Cosmetic Mission Kit / BYO share URLs for dashboard-broadcast.
 * Fragment-only payloads (never sent to Hostinger access logs).
 * ADR: .cursor/memory/decisions/2026-08-11_mission-control-broadcast-url-mask.md
 */

/** Live Hostinger path uses the `.html` artifact; extensionless `/mc/open` may 404 until a host alias exists. */
export const DEFAULT_SHARE_BASE = "https://missionkit.io/mc/open.html";
export const SHARE_BASE_ENV = "MISSION_CONTROL_SHARE_BASE";
export const SHARE_TTL_ENV = "MISSION_CONTROL_SHARE_TTL_SEC";
export const SHARE_SHOW_LAN_ENV = "MISSION_CONTROL_SHARE_SHOW_LAN";
export const DEFAULT_SHARE_TTL_SEC = 86_400;

/**
 * True when hostname is loopback, link-local, or RFC1918 private (IPv4) / ULA (IPv6).
 * Used by share-target validation (open redirect harden).
 * @param {string} hostname
 * @returns {boolean}
 */
export function isPrivateOrLoopbackHostname(hostname) {
  const host = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  // IPv4 dotted quad
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    const d = Number(m[4]);
    if ([a, b, c, d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10/8
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 169 && b === 254) return true; // link-local
    return false;
  }
  // IPv6 ULA fc00::/7 and link-local fe80::/10
  if (host.includes(":")) {
    if (host.startsWith("fc") || host.startsWith("fd")) return true;
    if (
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validate a decoded share target URL (LAN Mission Control with optional ?token=).
 * @param {string} url
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function validateBroadcastShareTarget(url) {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return { ok: false, error: "invalid-target" };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "invalid-target" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "invalid-target" };
  }
  if (!isPrivateOrLoopbackHostname(parsed.hostname)) {
    return { ok: false, error: "non-private-target" };
  }
  return { ok: true, url: raw };
}

/**
 * Normalize and validate a share page base. Rejects non-HTTPS (except loopback http for local preview).
 * @param {string} raw
 * @returns {{ ok: true, base: string } | { ok: false, error: string }}
 */
export function normalizeShareBase(raw) {
  const trimmed = String(raw || "")
    .trim()
    .replace(/#.*$/, "")
    .replace(/\/$/, "");
  if (!trimmed) return { ok: false, error: "empty-base" };
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid-base" };
  }
  const host = parsed.hostname.toLowerCase();
  const loopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  if (parsed.protocol === "https:") {
    return { ok: true, base: trimmed };
  }
  if (parsed.protocol === "http:" && loopback) {
    return { ok: true, base: trimmed };
  }
  return { ok: false, error: "non-https-base" };
}

/**
 * GET /open.html and /open are the public cosmetic share-resolver shell under broadcast bind.
 * All other methods/paths keep the normal token gate.
 * @param {string} method
 * @param {string} pathname
 * @returns {boolean}
 */
export function isPublicBroadcastShareShell(method, pathname) {
  return method === "GET" && (pathname === "/open.html" || pathname === "/open");
}

/**
 * @param {boolean} tokenRequired
 * @param {string} method
 * @param {string} pathname
 * @returns {boolean}
 */
export function shareShellTokenRequired(tokenRequired, method, pathname) {
  return Boolean(tokenRequired) && !isPublicBroadcastShareShell(method, pathname);
}

/**
 * Resolve share page base URL. Empty / "0" / "off" / "false" disables masking.
 * Non-HTTPS BYO bases (except loopback http) are rejected → masking off (with stderr warn when available).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function resolveShareBase(env = process.env) {
  const raw = env?.[SHARE_BASE_ENV];
  if (raw === undefined || raw === null) return DEFAULT_SHARE_BASE;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "0" || lower === "off" || lower === "false" || lower === "none") return null;
  const normalized = normalizeShareBase(trimmed);
  if (!normalized.ok) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(
        `[broadcast-share] ${SHARE_BASE_ENV} rejected (${normalized.error}); printing LAN URL only. Use HTTPS (or loopback http) or set off.`,
      );
    }
    return null;
  }
  return normalized.base;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function resolveShareTtlSec(env = process.env) {
  const raw = env?.[SHARE_TTL_ENV];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return DEFAULT_SHARE_TTL_SEC;
  }
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SHARE_TTL_SEC;
  return n;
}

/**
 * When false, starter omits secondary LAN/Local URL lines (share + token only).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function resolveShareShowLan(env = process.env) {
  const raw = env?.[SHARE_SHOW_LAN_ENV];
  if (raw === undefined || raw === null || String(raw).trim() === "") return true;
  const lower = String(raw).trim().toLowerCase();
  return !(lower === "0" || lower === "off" || lower === "false" || lower === "no");
}

/**
 * @param {string} lanUrl full http URL including ?token=
 * @param {{ ttlSec?: number, nowSec?: number }} [opts]
 * @returns {string} fragment without leading '#'
 */
export function encodeBroadcastSharePayload(lanUrl, opts = {}) {
  const url = typeof lanUrl === "string" ? lanUrl.trim() : "";
  const target = validateBroadcastShareTarget(url);
  if (!target.ok) {
    throw new Error(`encodeBroadcastSharePayload: ${target.error}`);
  }
  const ttlSec = opts.ttlSec ?? DEFAULT_SHARE_TTL_SEC;
  /** @type {{ v: number, u: string, e?: number }} */
  const body = { v: 1, u: target.url };
  if (ttlSec > 0) {
    const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
    body.e = now + ttlSec;
  }
  return `v1.${Buffer.from(JSON.stringify(body), "utf8").toString("base64url")}`;
}

/**
 * @param {string} lanUrl
 * @param {{ base?: string | null, ttlSec?: number, nowSec?: number }} [opts]
 * @returns {string | null}
 */
export function buildBroadcastShareUrl(lanUrl, opts = {}) {
  const base = opts.base === undefined ? DEFAULT_SHARE_BASE : opts.base;
  if (!base) return null;
  const cleaned = String(base).replace(/#.*$/, "").replace(/\/$/, "");
  const frag = encodeBroadcastSharePayload(lanUrl, opts);
  return `${cleaned}#${frag}`;
}

/**
 * @param {string} fragment hash with or without leading '#'
 * @param {{ nowSec?: number }} [opts]
 * @returns
 *   | { ok: true, url: string, expiresAt: number | null }
 *   | { ok: false, error: string }
 */
export function decodeBroadcastShareFragment(fragment, opts = {}) {
  const raw = String(fragment || "")
    .replace(/^#/, "")
    .trim();
  if (!raw) return { ok: false, error: "missing-fragment" };
  const m = /^v1\.([A-Za-z0-9_-]+)$/.exec(raw);
  if (!m) return { ok: false, error: "unsupported-version" };
  let parsed;
  try {
    const json = Buffer.from(m[1], "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "invalid-payload" };
  }
  if (!parsed || typeof parsed !== "object" || parsed.v !== 1) {
    return { ok: false, error: "unsupported-version" };
  }
  const url = typeof parsed.u === "string" ? parsed.u.trim() : "";
  const target = validateBroadcastShareTarget(url);
  if (!target.ok) return { ok: false, error: target.error };
  let expiresAt = null;
  if (parsed.e !== undefined && parsed.e !== null) {
    const e = Number(parsed.e);
    if (!Number.isFinite(e)) return { ok: false, error: "invalid-expiry" };
    expiresAt = e;
    const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
    if (now > e) return { ok: false, error: "expired" };
  }
  return { ok: true, url: target.url, expiresAt };
}
