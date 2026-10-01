/**
 * Ask a running Mission Control listener which workspace it serves.
 *
 * `/api/identity` answers without building a snapshot. A listener started by an
 * older kit has no such route (HTTP error or a non-JSON page), so fall back once
 * to the legacy `/dashboard-data.json` probe; otherwise an update would treat
 * its own old server as a foreign process. A timeout never falls back.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CURL_HTTP_ERROR = 22; // curl -f: server answered with status >= 400

/** @param {unknown} root */
function normalizeRoot(root) {
  return typeof root === "string" && root.trim() ? resolve(root.trim()) : null;
}

/**
 * @param {string} baseUrl e.g. `http://127.0.0.1:4242`
 * @param {string} [query] e.g. `?token=…` (already encoded)
 * @param {{ run?: typeof execFileSync }} [deps]
 * @returns {string | null}
 */
export function probeListenerRoot(baseUrl, query = "", deps = {}) {
  const run = deps.run ?? execFileSync;
  let raw;
  try {
    raw = run("curl", ["-sf", `${baseUrl}/api/identity${query}`], {
      encoding: "utf8",
      timeout: 2000,
    });
  } catch (err) {
    if (/** @type {{ status?: number }} */ (err)?.status !== CURL_HTTP_ERROR) return null;
    return legacyRoot(run, baseUrl, query);
  }
  try {
    return normalizeRoot(JSON.parse(raw)?.repoRoot);
  } catch {
    return legacyRoot(run, baseUrl, query);
  }
}

/** @param {typeof execFileSync} run @param {string} baseUrl @param {string} query */
function legacyRoot(run, baseUrl, query) {
  try {
    const raw = run("curl", ["-sf", `${baseUrl}/dashboard-data.json${query}`], {
      encoding: "utf8",
      timeout: 8000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return normalizeRoot(JSON.parse(raw)?.system?.repoRoot);
  } catch {
    return null;
  }
}
