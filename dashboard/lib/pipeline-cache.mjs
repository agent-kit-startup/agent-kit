/**
 * Cross-snapshot cache for the DevOps pipeline signal (`gh run list`).
 *
 * Mirrors the AGENT_KIT_PREV_INVENTORY hand-off: serve.mjs keeps the last
 * `devops.pipeline` it saw and passes it back via AGENT_KIT_PREV_PIPELINE, so
 * dashboard-data.mjs skips the network call while that result is fresh.
 * Only results carrying `fetchedAt` (gh was actually attempted) are cacheable;
 * a `reason: "budget"` miss never sticks.
 */

export const PIPELINE_CACHE_ENV = "AGENT_KIT_PREV_PIPELINE";
export const PIPELINE_CACHE_TTL_MS = 60_000;

/**
 * @param {unknown} pipeline
 * @returns {boolean}
 */
function isCacheablePipeline(pipeline) {
  return (
    !!pipeline &&
    typeof pipeline === "object" &&
    !Array.isArray(pipeline) &&
    typeof pipeline.available === "boolean" &&
    Array.isArray(pipeline.runs) &&
    typeof pipeline.fetchedAt === "string" &&
    Number.isFinite(Date.parse(pipeline.fetchedAt))
  );
}

/**
 * Cached pipeline from the env blob when younger than `ttlMs`, else null.
 * @param {string | undefined} raw
 * @param {number} nowMs
 * @param {number} [ttlMs]
 * @returns {object | null}
 */
export function readCachedPipeline(raw, nowMs, ttlMs = PIPELINE_CACHE_TTL_MS) {
  if (!raw || typeof raw !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isCacheablePipeline(parsed)) return null;
  const age = nowMs - Date.parse(parsed.fetchedAt);
  return age >= 0 && age < ttlMs ? parsed : null;
}

/**
 * Env blob for the next snapshot from a parsed snapshot, or null to keep the prior one.
 * @param {unknown} snapshot
 * @returns {string | null}
 */
export function pipelineCacheJsonFromSnapshot(snapshot) {
  const pipeline = snapshot?.devops?.pipeline;
  return isCacheablePipeline(pipeline) ? JSON.stringify(pipeline) : null;
}
