// dashboard/lib/guards.mjs
// Pure helpers for Mission Control snapshot redaction and serve lockdown (testable).

import { randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

export const DEFAULT_HOST = "127.0.0.1";
/** Env key for the opt-in LAN broadcast session token. */
export const BROADCAST_TOKEN_ENV = "MISSION_CONTROL_TOKEN";
/** Minimum token length (refuse empty / weak). */
export const BROADCAST_TOKEN_MIN_LEN = 16;
/** Cookie name for same-origin broadcast auth after `?token=` boot. */
export const BROADCAST_TOKEN_COOKIE = "mc_token";

export const MAX_STRING = {
  branch: 64,
  lastCommit: 120,
  terminalCwd: 200,
  terminalCommand: 120,
  processCommand: 80,
};

export const MAX_GIT_FILES = 50;
export const MAX_GIT_PATH = 240;

/** Repo-relative path safe to join onto a trusted root (no traversal / schemes). */
export function isSafeRepoRelativePath(relPath) {
  if (typeof relPath !== "string") return false;
  const p = relPath.trim().replace(/\\/g, "/");
  if (!p || p.length > MAX_GIT_PATH) return false;
  if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) return false;
  if (p.includes("\0") || p.includes("://")) return false;
  const parts = p.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  return true;
}

export function resolveBindHost(envHost) {
  return envHost || DEFAULT_HOST;
}

/**
 * True when the listen host is loopback (not a LAN / all-interfaces bind).
 * @param {string | undefined | null} host
 */
export function isLoopbackBindHost(host) {
  if (!host || typeof host !== "string") return true;
  const h = host.trim().toLowerCase();
  return h === DEFAULT_HOST || h === "localhost" || h === "::1";
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeAuthToken(raw) {
  if (raw == null) return "";
  return String(raw).trim();
}

/**
 * @param {unknown} token
 */
export function isValidBroadcastToken(token) {
  return normalizeAuthToken(token).length >= BROADCAST_TOKEN_MIN_LEN;
}

/** Cryptographically random token suitable for MISSION_CONTROL_TOKEN. */
export function generateBroadcastToken() {
  return randomBytes(24).toString("base64url");
}

/**
 * Timing-safe equality for UTF-8 token strings.
 * @param {unknown} a
 * @param {unknown} b
 */
export function tokensMatch(a, b) {
  const left = Buffer.from(normalizeAuthToken(a), "utf8");
  const right = Buffer.from(normalizeAuthToken(b), "utf8");
  if (left.length === 0 || right.length === 0) return false;
  if (left.length !== right.length) {
    const pad = Buffer.alloc(left.length || 1);
    timingSafeEqual(pad, pad);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Resolve bind + token gate for Mission Control serve.
 * Non-loopback bind requires a valid MISSION_CONTROL_TOKEN (no warn-only 0.0.0.0).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns
 *   | { ok: true, host: string, tokenRequired: boolean, token: string | null, broadcast: boolean }
 *   | { ok: false, error: string }
 */
export function resolveBroadcastAuth(env = process.env) {
  const host = resolveBindHost(env?.HOST);
  const loopback = isLoopbackBindHost(host);
  const token = normalizeAuthToken(env?.[BROADCAST_TOKEN_ENV]);
  if (!loopback) {
    if (!isValidBroadcastToken(token)) {
      return {
        ok: false,
        error: `Non-loopback bind (${host}) requires ${BROADCAST_TOKEN_ENV} (min ${BROADCAST_TOKEN_MIN_LEN} chars). Use /dashboard-broadcast or agent-kit dashboard-broadcast.`,
      };
    }
    return { ok: true, host, tokenRequired: true, token, broadcast: true };
  }
  return { ok: true, host, tokenRequired: false, token: null, broadcast: false };
}

/**
 * Extract session token from Authorization, header, query, or cookie.
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 * @param {URL} url
 */
export function extractRequestToken(req, url) {
  const headers = req?.headers || {};
  const authRaw = headers.authorization;
  const auth = Array.isArray(authRaw) ? authRaw[0] : authRaw;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const hdrRaw = headers["x-mission-control-token"];
  const hdr = Array.isArray(hdrRaw) ? hdrRaw[0] : hdrRaw;
  if (typeof hdr === "string" && hdr.trim()) return hdr.trim();

  const q = url?.searchParams?.get("token");
  if (q) return q.trim();

  const cookieRaw = headers.cookie;
  const cookie = Array.isArray(cookieRaw) ? cookieRaw[0] : cookieRaw;
  if (typeof cookie === "string") {
    const m = new RegExp(`(?:^|;\\s*)${BROADCAST_TOKEN_COOKIE}=([^;]+)`).exec(cookie);
    if (m?.[1]) {
      try {
        return decodeURIComponent(m[1].trim());
      } catch {
        return m[1].trim();
      }
    }
  }
  return "";
}

/**
 * Authorize a Mission Control HTTP request when token gate is on.
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 * @param {URL} url
 * @param {{ tokenRequired: boolean, expectedToken: string | null }} opts
 */
export function authorizeMissionControlRequest(req, url, opts) {
  if (!opts?.tokenRequired) return { ok: true, viaQuery: false };
  const expected = normalizeAuthToken(opts.expectedToken);
  if (!isValidBroadcastToken(expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const provided = extractRequestToken(req, url);
  if (!tokensMatch(provided, expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const viaQuery = Boolean(url?.searchParams?.get("token"));
  return { ok: true, viaQuery };
}

/**
 * Set-Cookie header value for broadcast token (HttpOnly, SameSite=Strict).
 * @param {string} token
 */
export function broadcastAuthCookieHeader(token) {
  const t = normalizeAuthToken(token);
  return `${BROADCAST_TOKEN_COOKIE}=${encodeURIComponent(t)}; Path=/; HttpOnly; SameSite=Strict`;
}

/**
 * Non-internal IPv4 addresses for printing LAN URLs (excludes loopback).
 * @returns {string[]}
 */
export function listLanIPv4Addresses() {
  const nets = networkInterfaces();
  const out = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      const family = net.family;
      const v4 = family === "IPv4" || family === 4;
      if (!v4 || net.internal) continue;
      if (net.address && !out.includes(net.address)) out.push(net.address);
    }
  }
  return out;
}

export function truncateStr(value, maxLen) {
  if (value == null) return value;
  const s = String(value);
  return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
}

/** Parse `git status --short` into bounded file entries (paths only, no contents). */
export function parseGitStatusShort(output) {
  if (!output || !String(output).trim()) {
    return { files: [], total: 0, truncated: false };
  }
  const lines = String(output)
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0);
  const files = [];
  let truncated = false;

  for (const line of lines) {
    if (files.length >= MAX_GIT_FILES) {
      truncated = true;
      break;
    }
    if (line.length < 3) continue;

    const status = line.slice(0, 2);
    const rest = line.slice(2).trimStart();
    if (!rest) continue;

    let path = rest;
    let oldPath = null;
    if (rest.includes(" -> ")) {
      const arrowIdx = rest.indexOf(" -> ");
      oldPath = rest.slice(0, arrowIdx).trim();
      path = rest.slice(arrowIdx + 4).trim() || oldPath;
    }

    const untracked = status === "??" || status[0] === "?" || status[1] === "?";
    const staged = !untracked && status[0] !== " " && status[0] !== "?";
    const unstaged = !untracked && status[1] !== " " && status[1] !== "?";

    const entry = {
      path: truncateStr(path, MAX_GIT_PATH),
      status,
      staged,
      unstaged,
      untracked,
    };
    if (oldPath) {
      entry.oldPath = truncateStr(oldPath, MAX_GIT_PATH);
      entry.renamed =
        status[0] === "R" || status[1] === "R" || status[0] === "C" || status[1] === "C";
    }

    files.push(entry);
  }

  return { files, total: lines.length, truncated };
}

/** Repo-relative path for session prefs written by Mission Control Config. */
export const CONTEXT_CONFIG_REL = ".cursor/context/config.json";

/** Builtin Agent Persona ids accepted by the Config write API. */
export const CONFIG_PERSONA_IDS = Object.freeze(["autopilot", "night-shift", "ghost-runner"]);

/** Mode keys under agentPersona.modes that Config may edit. */
export const CONFIG_PERSONA_MODES = Object.freeze(["continue-plan", "run-plan", "cli-run-plan"]);

/** Allowed externalPlanReview.backend values. */
export const CONFIG_REVIEW_BACKENDS = Object.freeze(["claude"]);

/** Allowed externalPlanReview.mode values (audits arming path). */
export const CONFIG_REVIEW_MODES = Object.freeze(["paste", "autonomous"]);

/** Allowed externalPlanReview.preflight values (audits pre-flight on plan-run commands). */
export const CONFIG_REVIEW_PREFLIGHT = Object.freeze(["off", "warn", "block"]);

/**
 * True when the remote address is loopback (IPv4, IPv6, or IPv4-mapped IPv6).
 * @param {string | undefined | null} addr
 */
export function isLoopbackAddress(addr) {
  if (!addr || typeof addr !== "string") return false;
  const a = addr.trim().toLowerCase();
  if (a === "127.0.0.1" || a === "::1" || a === "localhost") return true;
  if (a.startsWith("::ffff:")) {
    const v4 = a.slice("::ffff:".length);
    return v4 === "127.0.0.1" || v4.startsWith("127.");
  }
  return a.startsWith("127.");
}

/**
 * Resolve and lock the session config path under repoRoot.
 * @param {string} repoRoot
 * @param {{ existsSync?: Function, realpathSync?: Function, mkdirSync?: Function }} [fsHooks]
 * @returns {{ ok: true, path: string } | { ok: false, error: string }}
 */
export function resolveContextConfigPath(repoRoot, fsHooks = {}) {
  const exists = fsHooks.existsSync;
  const realpath = fsHooks.realpathSync;
  const mkdir = fsHooks.mkdirSync;
  if (typeof repoRoot !== "string" || !repoRoot) {
    return { ok: false, error: "invalid repo root" };
  }
  const abs = resolve(repoRoot, CONTEXT_CONFIG_REL);
  const contextDir = resolve(repoRoot, ".cursor", "context");
  const absNorm = abs.replace(/\\/g, "/");
  if (!absNorm.endsWith("/.cursor/context/config.json")) {
    return { ok: false, error: "path escape" };
  }
  try {
    if (typeof mkdir === "function" && typeof exists === "function" && !exists(contextDir)) {
      mkdir(contextDir, { recursive: true });
    }
    if (typeof realpath === "function" && typeof exists === "function" && exists(abs)) {
      const fileReal = String(realpath(abs)).replace(/\\/g, "/");
      const rootReal = String(realpath(repoRoot)).replace(/\\/g, "/");
      if (!fileReal.startsWith(`${rootReal}/`)) {
        return { ok: false, error: "path escape" };
      }
      if (!fileReal.endsWith("/.cursor/context/config.json")) {
        return { ok: false, error: "path escape" };
      }
      return { ok: true, path: realpath(abs) };
    }
  } catch {
    return { ok: false, error: "path escape" };
  }
  return { ok: true, path: abs };
}

/**
 * Validate a Config write body. Unknown top-level keys are rejected.
 * @param {unknown} body
 * @returns {{ ok: true, patch: object } | { ok: false, error: string }}
 */
export function validateConfigWriteBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const allowedTop = new Set([
    "autoHandoff",
    "interTickCooldownMs",
    "externalPlanReview",
    "fieldReportReviewCadence",
    "agentPersona",
    "updateCheck",
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedTop.has(key)) {
      return { ok: false, error: `unknown key: ${key}` };
    }
  }

  /** @type {Record<string, unknown>} */
  const patch = {};

  if ("autoHandoff" in body) {
    if (typeof body.autoHandoff !== "boolean") {
      return { ok: false, error: "autoHandoff must be boolean" };
    }
    patch.autoHandoff = body.autoHandoff;
  }

  if ("interTickCooldownMs" in body) {
    const n = body.interTickCooldownMs;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 3_600_000) {
      return { ok: false, error: "interTickCooldownMs must be an integer 0..3600000" };
    }
    patch.interTickCooldownMs = n;
  }

  if ("fieldReportReviewCadence" in body) {
    const frc = body.fieldReportReviewCadence;
    if (!frc || typeof frc !== "object" || Array.isArray(frc)) {
      return { ok: false, error: "fieldReportReviewCadence must be an object" };
    }
    const frcAllowed = new Set(["enabled", "tickThreshold"]);
    for (const key of Object.keys(frc)) {
      if (!frcAllowed.has(key)) {
        return { ok: false, error: `unknown fieldReportReviewCadence key: ${key}` };
      }
    }
    /** @type {Record<string, unknown>} */
    const frcPatch = {};
    if ("enabled" in frc) {
      if (typeof frc.enabled !== "boolean") {
        return { ok: false, error: "fieldReportReviewCadence.enabled must be boolean" };
      }
      frcPatch.enabled = frc.enabled;
    }
    if ("tickThreshold" in frc) {
      const n = frc.tickThreshold;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 100) {
        return {
          ok: false,
          error: "fieldReportReviewCadence.tickThreshold must be an integer 1..100",
        };
      }
      frcPatch.tickThreshold = n;
    }
    if (Object.keys(frcPatch).length > 0) {
      patch.fieldReportReviewCadence = frcPatch;
    }
  }

  if ("externalPlanReview" in body) {
    const epr = body.externalPlanReview;
    if (!epr || typeof epr !== "object" || Array.isArray(epr)) {
      return { ok: false, error: "externalPlanReview must be an object" };
    }
    const eprAllowed = new Set([
      "enabled",
      "backend",
      "autoRemediate",
      "offerOnExhausted",
      "mode",
      "midBatchAudits",
      "preflight",
    ]);
    for (const key of Object.keys(epr)) {
      if (!eprAllowed.has(key)) {
        return { ok: false, error: `unknown externalPlanReview key: ${key}` };
      }
    }
    /** @type {Record<string, unknown>} */
    const eprPatch = {};
    if ("enabled" in epr) {
      if (typeof epr.enabled !== "boolean") {
        return { ok: false, error: "externalPlanReview.enabled must be boolean" };
      }
      eprPatch.enabled = epr.enabled;
    }
    if ("backend" in epr) {
      if (typeof epr.backend !== "string" || !CONFIG_REVIEW_BACKENDS.includes(epr.backend)) {
        return { ok: false, error: "externalPlanReview.backend must be a known backend" };
      }
      eprPatch.backend = epr.backend;
    }
    if ("autoRemediate" in epr) {
      if (typeof epr.autoRemediate !== "boolean") {
        return { ok: false, error: "externalPlanReview.autoRemediate must be boolean" };
      }
      eprPatch.autoRemediate = epr.autoRemediate;
    }
    if ("offerOnExhausted" in epr) {
      if (typeof epr.offerOnExhausted !== "boolean") {
        return { ok: false, error: "externalPlanReview.offerOnExhausted must be boolean" };
      }
      eprPatch.offerOnExhausted = epr.offerOnExhausted;
    }
    if ("mode" in epr) {
      if (typeof epr.mode !== "string" || !CONFIG_REVIEW_MODES.includes(epr.mode)) {
        return { ok: false, error: "externalPlanReview.mode must be paste or autonomous" };
      }
      eprPatch.mode = epr.mode;
    }
    if ("midBatchAudits" in epr) {
      if (typeof epr.midBatchAudits !== "boolean") {
        return { ok: false, error: "externalPlanReview.midBatchAudits must be boolean" };
      }
      eprPatch.midBatchAudits = epr.midBatchAudits;
    }
    if ("preflight" in epr) {
      if (typeof epr.preflight !== "string" || !CONFIG_REVIEW_PREFLIGHT.includes(epr.preflight)) {
        return { ok: false, error: "externalPlanReview.preflight must be off, warn, or block" };
      }
      eprPatch.preflight = epr.preflight;
    }
    if (Object.keys(eprPatch).length > 0) {
      patch.externalPlanReview = eprPatch;
    }
  }

  if ("agentPersona" in body) {
    const ap = body.agentPersona;
    if (!ap || typeof ap !== "object" || Array.isArray(ap)) {
      return { ok: false, error: "agentPersona must be an object" };
    }
    const apAllowed = new Set(["default", "modes"]);
    for (const key of Object.keys(ap)) {
      if (!apAllowed.has(key)) {
        return { ok: false, error: `unknown agentPersona key: ${key}` };
      }
    }
    /** @type {Record<string, unknown>} */
    const apPatch = {};
    if ("default" in ap) {
      if (typeof ap.default !== "string" || !CONFIG_PERSONA_IDS.includes(ap.default)) {
        return { ok: false, error: "agentPersona.default must be a builtin persona id" };
      }
      apPatch.default = ap.default;
    }
    if ("modes" in ap) {
      const modes = ap.modes;
      if (!modes || typeof modes !== "object" || Array.isArray(modes)) {
        return { ok: false, error: "agentPersona.modes must be an object" };
      }
      /** @type {Record<string, string>} */
      const modesPatch = {};
      for (const [mode, persona] of Object.entries(modes)) {
        if (!CONFIG_PERSONA_MODES.includes(mode)) {
          return { ok: false, error: `unknown agentPersona.modes key: ${mode}` };
        }
        if (typeof persona !== "string" || !CONFIG_PERSONA_IDS.includes(persona)) {
          return { ok: false, error: `agentPersona.modes.${mode} must be a builtin persona id` };
        }
        modesPatch[mode] = persona;
      }
      if (Object.keys(modesPatch).length > 0) {
        apPatch.modes = modesPatch;
      }
    }
    if (Object.keys(apPatch).length > 0) {
      patch.agentPersona = apPatch;
    }
  }

  if ("updateCheck" in body) {
    const uc = body.updateCheck;
    if (!uc || typeof uc !== "object" || Array.isArray(uc)) {
      return { ok: false, error: "updateCheck must be an object" };
    }
    // lastCheckedAt is stamped by CLI/hooks; updateApply.auto is never writable via MC.
    const ucAllowed = new Set(["enabled", "intervalDays"]);
    for (const key of Object.keys(uc)) {
      if (!ucAllowed.has(key)) {
        return { ok: false, error: `unknown updateCheck key: ${key}` };
      }
    }
    /** @type {Record<string, unknown>} */
    const ucPatch = {};
    if ("enabled" in uc) {
      if (typeof uc.enabled !== "boolean") {
        return { ok: false, error: "updateCheck.enabled must be boolean" };
      }
      ucPatch.enabled = uc.enabled;
    }
    if ("intervalDays" in uc) {
      const n = uc.intervalDays;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 365) {
        return { ok: false, error: "updateCheck.intervalDays must be an integer 1..365" };
      }
      ucPatch.intervalDays = n;
    }
    if (Object.keys(ucPatch).length > 0) {
      patch.updateCheck = ucPatch;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "no editable fields in body" };
  }
  return { ok: true, patch };
}

/**
 * Merge an allowlisted patch into existing config without wiping other nests.
 * @param {object} existing
 * @param {object} patch
 */
export function mergeConfigAllowlist(existing, patch) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  if ("autoHandoff" in patch) base.autoHandoff = patch.autoHandoff;
  if ("interTickCooldownMs" in patch) base.interTickCooldownMs = patch.interTickCooldownMs;
  if (patch.fieldReportReviewCadence && typeof patch.fieldReportReviewCadence === "object") {
    const prev =
      base.fieldReportReviewCadence && typeof base.fieldReportReviewCadence === "object"
        ? { ...base.fieldReportReviewCadence }
        : {};
    base.fieldReportReviewCadence = { ...prev, ...patch.fieldReportReviewCadence };
  }
  if (patch.externalPlanReview && typeof patch.externalPlanReview === "object") {
    const prev =
      base.externalPlanReview && typeof base.externalPlanReview === "object"
        ? { ...base.externalPlanReview }
        : {};
    base.externalPlanReview = { ...prev, ...patch.externalPlanReview };
  }
  if (patch.agentPersona && typeof patch.agentPersona === "object") {
    const prev =
      base.agentPersona && typeof base.agentPersona === "object" ? { ...base.agentPersona } : {};
    const next = { ...prev };
    if ("default" in patch.agentPersona) next.default = patch.agentPersona.default;
    if (patch.agentPersona.modes && typeof patch.agentPersona.modes === "object") {
      const prevModes =
        prev.modes && typeof prev.modes === "object" && !Array.isArray(prev.modes)
          ? { ...prev.modes }
          : {};
      next.modes = { ...prevModes, ...patch.agentPersona.modes };
    }
    base.agentPersona = next;
  }
  if (patch.updateCheck && typeof patch.updateCheck === "object") {
    const prev =
      base.updateCheck && typeof base.updateCheck === "object" ? { ...base.updateCheck } : {};
    base.updateCheck = { ...prev, ...patch.updateCheck };
  }
  return base;
}

/** Export only safe, UI-relevant config fields (no full nested onboarding checks). */
export function allowlistConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "invalid" };
  }
  const summary = {};
  if (typeof raw.onboarded === "boolean") summary.onboarded = raw.onboarded;
  if (typeof raw.autoHandoff === "boolean") summary.autoHandoff = raw.autoHandoff;
  if (typeof raw.interTickCooldownMs === "number") {
    summary.interTickCooldownMs = raw.interTickCooldownMs;
  }
  if (raw.fieldReportReviewCadence && typeof raw.fieldReportReviewCadence === "object") {
    const frc = {};
    if (typeof raw.fieldReportReviewCadence.enabled === "boolean") {
      frc.enabled = raw.fieldReportReviewCadence.enabled;
    }
    if (typeof raw.fieldReportReviewCadence.tickThreshold === "number") {
      frc.tickThreshold = raw.fieldReportReviewCadence.tickThreshold;
    }
    if (Object.keys(frc).length > 0) summary.fieldReportReviewCadence = frc;
  }
  if (raw.updateCheck && typeof raw.updateCheck === "object") {
    const uc = {};
    if (typeof raw.updateCheck.enabled === "boolean") uc.enabled = raw.updateCheck.enabled;
    if (typeof raw.updateCheck.intervalDays === "number") {
      uc.intervalDays = raw.updateCheck.intervalDays;
    }
    if (Object.keys(uc).length > 0) summary.updateCheck = uc;
  }
  if (raw.onboarding && typeof raw.onboarding === "object") {
    summary.onboarding = {
      status: typeof raw.onboarding.status === "string" ? raw.onboarding.status : "unknown",
      contractVersion: raw.onboarding.contractVersion,
    };
  }
  if (raw.externalPlanReview && typeof raw.externalPlanReview === "object") {
    const epr = { enabled: !!raw.externalPlanReview.enabled };
    if (typeof raw.externalPlanReview.backend === "string") {
      epr.backend = truncateStr(raw.externalPlanReview.backend, 64);
    }
    if (typeof raw.externalPlanReview.autoRemediate === "boolean") {
      epr.autoRemediate = raw.externalPlanReview.autoRemediate;
    }
    if (typeof raw.externalPlanReview.offerOnExhausted === "boolean") {
      epr.offerOnExhausted = raw.externalPlanReview.offerOnExhausted;
    }
    if (typeof raw.externalPlanReview.mode === "string") {
      epr.mode = truncateStr(raw.externalPlanReview.mode, 32);
    }
    if (typeof raw.externalPlanReview.midBatchAudits === "boolean") {
      epr.midBatchAudits = raw.externalPlanReview.midBatchAudits;
    }
    if (typeof raw.externalPlanReview.preflight === "string") {
      epr.preflight = truncateStr(raw.externalPlanReview.preflight, 16);
    }
    summary.externalPlanReview = epr;
  }
  if (raw.agentPersona && typeof raw.agentPersona === "object") {
    const modes = {};
    if (raw.agentPersona.modes && typeof raw.agentPersona.modes === "object") {
      for (const [mode, persona] of Object.entries(raw.agentPersona.modes)) {
        modes[mode] = truncateStr(persona, 64);
      }
    }
    summary.agentPersona = {
      default: truncateStr(raw.agentPersona.default, 64),
      modes,
    };
  } else if (raw.workspaceSkin && typeof raw.workspaceSkin === "object") {
    // Legacy key: surface as agentPersona for Mission Control consumers.
    const modes = {};
    if (raw.workspaceSkin.modes && typeof raw.workspaceSkin.modes === "object") {
      for (const [mode, persona] of Object.entries(raw.workspaceSkin.modes)) {
        modes[mode] = truncateStr(persona, 64);
      }
    }
    summary.agentPersona = {
      default: truncateStr(raw.workspaceSkin.default, 64),
      modes,
    };
  }
  return summary;
}

export function isAllowedOrigin(origin, port) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const resolvedPort = url.port || (url.protocol === "https:" ? "443" : "80");
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      resolvedPort === String(port)
    );
  } catch {
    return false;
  }
}

export function applyCorsHeaders(req, res, port) {
  const origin = req.headers?.origin;
  if (isAllowedOrigin(origin, port)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    return true;
  }
  return false;
}

export function isUnderDashboard(resolvedPath, dashboardReal) {
  return resolvedPath === dashboardReal || resolvedPath.startsWith(`${dashboardReal}/`);
}

/**
 * Resolve a static pathname to an absolute file under dashboardReal, or null if blocked.
 * fs hooks default to node:fs for production; tests may inject mocks.
 */
export function resolveDashboardStatic(
  pathname,
  { dashboardDir, dashboardReal, existsSync, realpathSync },
) {
  let rel = pathname;
  if (rel === "/" || rel === "") {
    rel = "/dashboard.html";
  }

  if (!rel.startsWith("/") || rel.includes("..") || rel.includes("\\")) {
    return null;
  }

  for (const segment of rel.split("/").filter(Boolean)) {
    if (segment.startsWith(".")) {
      return null;
    }
  }

  const candidate = resolve(dashboardDir, `.${rel}`);
  if (!isUnderDashboard(candidate, dashboardReal)) {
    return null;
  }

  if (!existsSync(candidate)) {
    return null;
  }

  try {
    const fileReal = realpathSync(candidate);
    if (!isUnderDashboard(fileReal, dashboardReal)) {
      return null;
    }
    return fileReal;
  } catch {
    return null;
  }
}
