/**
 * Outcome ledger (ADR 2026-10-23 colony-game-canon-outcome-ledger-art-policy,
 * points 2-6): a product-neutral record of verified outcomes the kit already
 * writes down. Mission Control folds it on every snapshot and exposes a
 * read-only summary as `outcomeLedger`; a host (the Colony cockpit) reads the
 * same field. The game layer spends nothing here: player choices live in the
 * renderer (browser localStorage), earned totals live only in this ledger.
 *
 * Rules the fold enforces:
 * - Idempotent by event identity. Every entry carries a stable key (plan +
 *   to-do id, tag name, CI run id, review report + head SHA, test run HEAD).
 *   Folding the same inputs twice adds nothing; an entry already earned is
 *   never rewritten or removed, so a pruned source (old loop logs, a capped
 *   run list) never takes a reward back, and re-opening then re-closing a
 *   to-do earns nothing new.
 * - Anti-Goodhart. Only outcomes are inputs. Lines of code, commits, diff size,
 *   keystrokes, token volume, wall-clock time and tick counts are never read,
 *   so they cannot be rewarded.
 * - Lazy. Nothing here ticks: the file holds source-derived timestamps only,
 *   and the flow signal is computed from mission timing on each read.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const OUTCOME_LEDGER_REL = ".cursor/context/outcome-ledger.json";
export const TEST_RESULTS_REL = ".cursor/context/test-results.json";
export const REPOSITORY_PROFILE_REL = ".cursor/agent-kit.config.json";
export const OUTCOME_LEDGER_VERSION = 1;
/** Bound on stored entries; past it new entries are dropped, old ones kept. */
export const MAX_LEDGER_ENTRIES = 50_000;
/** Newest test runs kept in test-results.json. */
export const MAX_TEST_RESULTS = 200;
/** Newest earned entries exposed on the snapshot. */
export const MAX_RECENT_ENTRIES = 20;
const MAX_LABEL = 120;
const MAX_COMMAND_CHARS = 200;
const MAX_COMMANDS = 5;

/** Resource tiers (ADR point 5). */
export const OUTCOME_KINDS = Object.freeze({
  todo: "logic",
  test: "logic",
  ci: "compute",
  releaseCut: "compute",
  plan: "rare",
  review: "rare",
  releasePublished: "rare",
});

const SAFE_PART_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,159}$/;
const TAG_RE = /^v[0-9A-Za-z][0-9A-Za-z._+-]{0,62}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const RUN_ID_RE = /^[0-9]{1,20}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const FULL_REVIEW_HEAD_RE = /^## Full review\b[^\n]*?\bHEAD\b[^\n]{0,24}?\b([0-9a-f]{7,40})\b/gm;
const TODO_RE = /^\s*-\s+id:\s*(\S+)\s*\n\s*content:\s*"(?:.+)"\s*\n\s*status:\s*(\S+)/gm;

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const safePart = (v) => (typeof v === "string" && SAFE_PART_RE.test(v) ? v : null);
const isoOrNull = (v) => (typeof v === "string" && ISO_RE.test(v.trim()) ? v.trim() : null);

function cap(text, max = MAX_LABEL) {
  const s = String(text ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Empty ledger (fresh install). */
export function emptyOutcomeLedger() {
  return { version: OUTCOME_LEDGER_VERSION, entries: {}, sources: {} };
}

/**
 * Parse the persisted ledger. Malformed entries and a wrong version are
 * dropped, never thrown. An entry of a kind this engine does not know (a
 * newer engine wrote it) is kept as is and not counted, so an older engine
 * never erases it on the next write.
 * @param {unknown} raw
 */
export function parseOutcomeLedger(raw) {
  const out = emptyOutcomeLedger();
  if (!isRecord(raw) || raw.version !== OUTCOME_LEDGER_VERSION || !isRecord(raw.entries)) {
    return out;
  }
  // Fingerprints (size + mtime) of large, rarely changing sources already
  // folded, so they are not re-read on every snapshot. Source-derived only.
  if (isRecord(raw.sources)) {
    for (const [name, stamp] of Object.entries(raw.sources)) {
      if (safePart(name) && typeof stamp === "string" && stamp.length <= 64) {
        out.sources[name] = stamp;
      }
    }
  }
  for (const [key, entry] of Object.entries(raw.entries)) {
    if (typeof key !== "string" || key.length > 400 || !isRecord(entry)) continue;
    if (typeof entry.kind !== "string" || !SAFE_PART_RE.test(entry.kind)) continue;
    out.entries[key] = {
      kind: entry.kind,
      resource: OUTCOME_KINDS[entry.kind] ?? null,
      at: isoOrNull(entry.at),
      label: cap(entry.label),
    };
  }
  return out;
}

/**
 * Whether a raw ledger file can be folded into: absent, or this version.
 * A corrupt file or another version is left untouched (never overwritten).
 */
export function isFoldableOutcomeLedger(raw) {
  return (
    raw === undefined ||
    (isRecord(raw) && raw.version === OUTCOME_LEDGER_VERSION && isRecord(raw.entries))
  );
}

/** Stable JSON (sorted keys) so write-on-change never loops the SSE watcher. */
export function serializeOutcomeLedger(ledger) {
  const parsed = parseOutcomeLedger(ledger);
  const entries = {};
  for (const key of Object.keys(parsed.entries).sort()) entries[key] = parsed.entries[key];
  const sources = {};
  for (const key of Object.keys(parsed.sources).sort()) sources[key] = parsed.sources[key];
  return `${JSON.stringify({ version: OUTCOME_LEDGER_VERSION, entries, sources }, null, 2)}\n`;
}

/** Parse plan frontmatter to-dos (same shape dashboard-data.mjs reads). */
export function parsePlanTodos(content) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(String(content ?? ""));
  if (!fm) return [];
  const todos = [];
  for (const m of fm[1].matchAll(TODO_RE)) todos.push({ id: m[1], status: m[2] });
  return todos;
}

/**
 * HEAD SHA of the last "## Full review ... HEAD `<sha>`" heading of a
 * plan-monitor report (the plan-termination review the template asks for).
 * Monitor logs without one are not a review outcome.
 */
export function fullReviewHeadSha(content) {
  let head = null;
  for (const m of String(content ?? "").matchAll(FULL_REVIEW_HEAD_RE)) head = m[1];
  return head;
}

/**
 * Outcome events from already-collected inputs. Pure: no fs, no clock.
 * Every input is optional; an absent source yields no events.
 *
 * @param {object} inputs
 * @param {Array<{file:string, todos:Array<{id:string,status:string}>}>} [inputs.plans] active + archived plans
 * @param {{missions?: Record<string, {stages?: Record<string,{startedAt:string,endedAt:string|null}>}>}} [inputs.timing] mission-timing.json
 * @param {Array<{file:string, reviewedPlanFile:string|null, hasOpenReviewGaps:boolean, fullReviewHead:string|null}>} [inputs.reviews]
 * @param {Array<{name:string, date?:string|null}>} [inputs.tags] local v* tags
 * @param {Array<{id?:number|string|null, conclusion?:string|null, event?:string, workflow?:string, createdAt?:string|null}>} [inputs.ciRuns] (scheduled runs are skipped)
 * @param {boolean} [inputs.reviewsCollected] false when review reports were not read (no plan rewards then)
 * @param {string|null} [inputs.historyRepo] owner/name: only this repository's history-ledger runs count
 * @param {{tag?:string|null, publishedAt?:string|null}|null} [inputs.originRelease]
 * @param {{runs?: Array<{at:string, ok:boolean, head:string|null}>}} [inputs.testResults]
 * @param {unknown} [inputs.historyLedger] docs/evidence/history-ledger.json (factory only)
 * @returns {Array<{key:string, kind:string, resource:string, at:string|null, label:string}>}
 */
export function extractOutcomeEvents(inputs = {}) {
  const events = [];
  const push = (key, kind, at, label) => {
    events.push({ key, kind, resource: OUTCOME_KINDS[kind], at: isoOrNull(at), label: cap(label) });
  };
  const stageEnd = (planFile, todoId) =>
    inputs.timing?.missions?.[planFile]?.stages?.[todoId]?.endedAt ?? null;

  // Reviews first: a plan with an open-gap review is not closed with zero residuals.
  const plansWithOpenGaps = new Set();
  for (const r of Array.isArray(inputs.reviews) ? inputs.reviews : []) {
    if (!isRecord(r)) continue;
    if (r.hasOpenReviewGaps && typeof r.reviewedPlanFile === "string") {
      plansWithOpenGaps.add(r.reviewedPlanFile);
    }
    const file = safePart(r.file);
    const head =
      typeof r.fullReviewHead === "string" && SHA_RE.test(r.fullReviewHead)
        ? r.fullReviewHead
        : null;
    if (!file || !head || r.hasOpenReviewGaps || typeof r.reviewedPlanFile !== "string") continue;
    push(
      `review:${file}:${head}`,
      "review",
      r.modifiedAt ?? null,
      `${r.reviewedPlanFile} @ ${head.slice(0, 8)}`,
    );
  }

  for (const plan of Array.isArray(inputs.plans) ? inputs.plans : []) {
    const file = isRecord(plan) ? safePart(plan.file) : null;
    if (!file?.endsWith(".plan.md")) continue;
    const todos = Array.isArray(plan.todos) ? plan.todos.filter(isRecord) : [];
    let lastEnd = null;
    for (const t of todos) {
      const id = safePart(t.id);
      if (!id || t.status !== "completed") continue;
      const end = isoOrNull(stageEnd(file, id));
      if (end && (!lastEnd || end > lastEnd)) lastEnd = end;
      push(`todo:${file}:${id}`, "todo", end, `${file} · ${id}`);
    }
    const allDone = todos.length > 0 && todos.every((t) => t.status === "completed");
    // "Zero residuals" needs the review reports: when they were not read this
    // time (snapshot budget), the plan waits for the next fold.
    if (allDone && inputs.reviewsCollected !== false && !plansWithOpenGaps.has(file)) {
      push(`plan:${file}`, "plan", lastEnd, file);
    }
  }

  for (const run of Array.isArray(inputs.testResults?.runs) ? inputs.testResults.runs : []) {
    if (!isRecord(run) || run.ok !== true) continue;
    const head = typeof run.head === "string" && SHA_RE.test(run.head) ? run.head : null;
    if (!head) continue;
    push(`test:${head}`, "test", run.at, `tests passed @ ${head.slice(0, 8)}`);
  }

  for (const run of Array.isArray(inputs.ciRuns) ? inputs.ciRuns : []) {
    if (!isRecord(run) || run.conclusion !== "success") continue;
    // A cron run passes with no work behind it: not an outcome.
    if (run.event === "schedule") continue;
    const id = run.id == null ? "" : String(run.id);
    if (!RUN_ID_RE.test(id)) continue;
    push(`ci:${id}`, "ci", run.createdAt, run.workflow || `run ${id}`);
  }

  for (const tag of Array.isArray(inputs.tags) ? inputs.tags : []) {
    const name = isRecord(tag) && typeof tag.name === "string" ? tag.name : null;
    if (!name || !TAG_RE.test(name)) continue;
    push(`release-cut:${name}`, "releaseCut", tag.date ?? null, name);
  }

  const rel = inputs.originRelease;
  if (
    isRecord(rel) &&
    typeof rel.tag === "string" &&
    TAG_RE.test(rel.tag) &&
    isoOrNull(rel.publishedAt)
  ) {
    push(`release-published:${rel.tag}`, "releasePublished", rel.publishedAt, rel.tag);
  }

  events.push(...historyLedgerEvents(inputs.historyLedger, inputs.historyRepo ?? null));
  return events;
}

/** Rows of a history-ledger section as objects (columns + rows table). */
function historyRows(section) {
  if (!isRecord(section) || !Array.isArray(section.columns) || !Array.isArray(section.rows)) {
    return [];
  }
  const cols = section.columns;
  return section.rows
    .filter(Array.isArray)
    .map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

/** Optional factory evidence: published releases and successful workflow runs. */
function historyLedgerEvents(history, repo) {
  if (!isRecord(history) || !isRecord(history.sections)) return [];
  const events = [];
  for (const r of historyRows(history.sections.releases)) {
    const tag = typeof r.tagName === "string" ? r.tagName : null;
    if (!tag || !TAG_RE.test(tag) || !isoOrNull(r.publishedAt)) continue;
    events.push({
      key: `release-published:${tag}`,
      kind: "releasePublished",
      resource: OUTCOME_KINDS.releasePublished,
      at: isoOrNull(r.publishedAt),
      label: tag,
    });
  }
  for (const r of historyRows(history.sections.workflowRuns)) {
    const id = r.databaseId == null ? "" : String(r.databaseId);
    if (r.conclusion !== "success" || r.event === "schedule" || !RUN_ID_RE.test(id)) continue;
    // Runs of another repository (the factory's public mirror) are not this workspace's work.
    if (repo && typeof r.repository === "string" && r.repository !== repo) continue;
    events.push({
      key: `ci:${id}`,
      kind: "ci",
      resource: OUTCOME_KINDS.ci,
      at: isoOrNull(r.createdAt),
      label: `run ${id}`,
    });
  }
  return events;
}

/**
 * Fold events into a ledger. First write wins: an existing key is never
 * changed (except a null `at` filled once), so `fold(fold(L, E), E)` equals `fold(L, E)` and `fold(L, [])`
 * equals `L`. `sources` records fingerprints of folded bulk sources (see
 * parseOutcomeLedger). Returns a new ledger; `added` counts new keys.
 */
export function foldOutcomeLedger(prev, events, sources = {}) {
  const base = parseOutcomeLedger(prev);
  const entries = { ...base.entries };
  let count = Object.keys(entries).length;
  let added = 0;
  for (const ev of Array.isArray(events) ? events : []) {
    if (!isRecord(ev) || typeof ev.key !== "string" || !OUTCOME_KINDS[ev.kind]) continue;
    if (Object.hasOwn(entries, ev.key)) {
      // The only change ever made to an earned entry: a missing time is filled
      // once a source provides it (still idempotent: a set time never moves).
      const at = isoOrNull(ev.at);
      if (entries[ev.key].at === null && at) entries[ev.key] = { ...entries[ev.key], at };
      continue;
    }
    if (count >= MAX_LEDGER_ENTRIES) break;
    entries[ev.key] = {
      kind: ev.kind,
      resource: OUTCOME_KINDS[ev.kind],
      at: isoOrNull(ev.at),
      label: cap(ev.label),
    };
    count += 1;
    added += 1;
  }
  const nextSources = { ...base.sources };
  for (const [name, stamp] of Object.entries(isRecord(sources) ? sources : {})) {
    if (safePart(name) && typeof stamp === "string" && stamp.length <= 64)
      nextSources[name] = stamp;
  }
  return { ledger: { version: OUTCOME_LEDGER_VERSION, entries, sources: nextSources }, added };
}

/**
 * A tick that broke the streak: failed result, a HITL gate, or a stop line
 * (other than the stop that ends an exhausted plan).
 * Run logs are a reason to withhold the flow bonus, never a source of reward.
 */
function isBreakingTick(log) {
  if (!isRecord(log) || log.kind !== "tick") return false;
  if (isRecord(log.result) && log.result.isError === true) return true;
  if (Array.isArray(log.gates) && log.gates.length > 0) return true;
  if (typeof log.sentinel !== "string") return false;
  const line = log.sentinel.trim();
  // A stop because the plan ran out of to-dos ends the mission; it is not a failure.
  return (
    /^LOOP_TICK_RESULT:\s*stop/i.test(line) &&
    !/^LOOP_TICK_RESULT:\s*stop\s*[—-]\s*plan exhausted\b/i.test(line)
  );
}

/**
 * Flow signal (ADR point 6): consecutive to-dos closed in the most recent
 * mission with no failed or stopped tick between them (or after the last
 * close). A raw signal: the overclock threshold and its window are renderer
 * tuning, not ledger state, and nothing here reads the clock.
 *
 * @param {{missions?: object}} timing parsed mission-timing.json
 * @param {Array<object>} runLogs snapshot runLogs rows (any plan: run logs do not name one)
 * @param {Array<{file:string, todos:Array<{id:string,status:string}>}>|null} [plans] when given, only completed to-dos count
 * @returns {{plan:string, streak:number, lastClosedAt:string|null, brokenAt:string|null}|null}
 */
export function deriveFlowSignal(timing, runLogs = [], plans = null) {
  const missions = isRecord(timing?.missions) ? timing.missions : {};
  // A stage ends when the panel saw the to-do stop being current; only the
  // ones whose to-do is completed in the plan count as closes.
  const completed = new Map();
  for (const p of Array.isArray(plans) ? plans : []) {
    if (!isRecord(p) || typeof p.file !== "string" || !Array.isArray(p.todos)) continue;
    completed.set(
      p.file,
      new Set(p.todos.filter((t) => isRecord(t) && t.status === "completed").map((t) => t.id)),
    );
  }
  let best = null;
  for (const [plan, mission] of Object.entries(missions)) {
    if (!isRecord(mission) || mission.frozenAt || !isRecord(mission.stages)) continue;
    const done = plans ? (completed.get(plan) ?? new Set()) : null;
    const ends = Object.entries(mission.stages)
      .filter(([todoId]) => !done || done.has(todoId))
      .map(([, s]) => (isRecord(s) ? isoOrNull(s.endedAt) : null))
      .filter(Boolean)
      .sort();
    if (ends.length === 0) continue;
    const last = ends[ends.length - 1];
    if (!best || last > best.ends[best.ends.length - 1]) best = { plan, ends };
  }
  if (!best) return null;
  const breaks = (Array.isArray(runLogs) ? runLogs : [])
    .filter(isBreakingTick)
    .map((l) => isoOrNull(l.updatedAt))
    .filter(Boolean)
    .sort();
  const ends = best.ends;
  const lastClosedAt = ends[ends.length - 1];
  const after = breaks.filter((b) => b > lastClosedAt);
  if (after.length > 0) {
    return { plan: best.plan, streak: 0, lastClosedAt, brokenAt: after[after.length - 1] };
  }
  let streak = 1;
  let brokenAt = null;
  for (let i = ends.length - 1; i > 0; i -= 1) {
    const between = breaks.filter((b) => b > ends[i - 1] && b <= ends[i]);
    if (between.length > 0) {
      brokenAt = between[between.length - 1];
      break;
    }
    streak += 1;
  }
  return { plan: best.plan, streak, lastClosedAt, brokenAt };
}

/**
 * Read-only snapshot field from a ledger: totals per resource, counts per
 * kind, the newest entries (capped) and the flow signal.
 */
export function summarizeOutcomeLedger(ledger, extras = {}) {
  const parsed = parseOutcomeLedger(ledger);
  const totals = { logic: 0, compute: 0, rare: 0 };
  const byKind = Object.fromEntries(Object.keys(OUTCOME_KINDS).map((k) => [k, 0]));
  const rows = [];
  for (const [key, e] of Object.entries(parsed.entries)) {
    if (!e.resource) continue; // a kind from a newer engine: kept, not counted
    totals[e.resource] += 1;
    byKind[e.kind] += 1;
    rows.push({ key, ...e });
  }
  rows.sort((a, b) => {
    const at = a.at ?? "";
    const bt = b.at ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return {
    available: extras.available !== false,
    reason: extras.available === false ? (extras.reason ?? "unreadable") : null,
    version: OUTCOME_LEDGER_VERSION,
    path: OUTCOME_LEDGER_REL,
    entries: rows.length,
    totals,
    byKind,
    recent: rows.slice(0, MAX_RECENT_ENTRIES),
    flow: extras.flow ?? null,
    tests: extras.tests ?? { configured: false, lastRun: null },
  };
}

/** Empty snapshot field (default, and the budget-miss shape). */
export function emptyOutcomeLedgerSummary(reason = null) {
  return summarizeOutcomeLedger(emptyOutcomeLedger(), {
    available: reason == null,
    reason,
  });
}

// --- fs helpers (callers: dashboard-data.mjs, `agent-kit outcome-ledger`) ---

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Write atomically, and only when the bytes change. Returns true when written. */
function writeIfChanged(path, text) {
  let prev = null;
  if (existsSync(path)) {
    try {
      prev = readFileSync(path, "utf-8");
    } catch {
      prev = null;
    }
  }
  if (prev === text) return false;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text, "utf-8");
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
  return true;
}

export function readOutcomeLedger(root) {
  return readOutcomeLedgerFile(root).ledger;
}

/**
 * The persisted ledger plus whether a fold may write over it. An unreadable
 * file or another version is never overwritten (an engine downgrade or a
 * corrupt file must not erase what was earned).
 */
export function readOutcomeLedgerFile(root) {
  const path = join(root, OUTCOME_LEDGER_REL);
  if (!existsSync(path)) return { ledger: emptyOutcomeLedger(), foldable: true };
  const raw = readJson(path);
  const foldable = raw !== null && isFoldableOutcomeLedger(raw);
  return { ledger: foldable ? parseOutcomeLedger(raw) : emptyOutcomeLedger(), foldable };
}

export function persistOutcomeLedger(root, ledger) {
  const path = join(root, OUTCOME_LEDGER_REL);
  const parsed = parseOutcomeLedger(ledger);
  // A fresh install with nothing earned yet leaves no file behind.
  if (Object.keys(parsed.entries).length === 0 && !existsSync(path)) return false;
  return writeIfChanged(path, serializeOutcomeLedger(parsed));
}

/** Parse test-results.json: `{version: 1, runs: [{at, ok, exitCode, head, commands}]}`. */
export function parseTestResults(raw) {
  const runs = [];
  if (isRecord(raw) && raw.version === 1 && Array.isArray(raw.runs)) {
    for (const r of raw.runs) {
      if (!isRecord(r) || typeof r.ok !== "boolean" || !isoOrNull(r.at)) continue;
      runs.push({
        at: isoOrNull(r.at),
        ok: r.ok,
        exitCode: Number.isInteger(r.exitCode) ? r.exitCode : null,
        head: typeof r.head === "string" && SHA_RE.test(r.head) ? r.head : null,
        commands: Array.isArray(r.commands)
          ? r.commands
              .filter((c) => typeof c === "string")
              .slice(0, MAX_COMMANDS)
              .map((c) => cap(c, MAX_COMMAND_CHARS))
          : [],
      });
    }
  }
  return { version: 1, runs: runs.slice(-MAX_TEST_RESULTS) };
}

export function readTestResults(root) {
  return parseTestResults(readJson(join(root, TEST_RESULTS_REL)));
}

/** Append one run, keeping the newest MAX_TEST_RESULTS. */
export function appendTestResult(root, run) {
  const current = readTestResults(root);
  const next = parseTestResults({ version: 1, runs: [...current.runs, run] });
  writeIfChanged(join(root, TEST_RESULTS_REL), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * The repo's own test commands from the repository profile
 * (`.cursor/agent-kit.config.json#stack.testCommands`, written by the scanner
 * or confirmed by the operator). Never guessed: no profile, no commands.
 */
export function readProfileTestCommands(root) {
  const profile = readJson(join(root, REPOSITORY_PROFILE_REL));
  const list = isRecord(profile) && isRecord(profile.stack) ? profile.stack.testCommands : null;
  return Array.isArray(list)
    ? list.filter((c) => typeof c === "string" && c.trim()).slice(0, MAX_COMMANDS)
    : [];
}

/** Test collector status for the snapshot field. */
export function testCollectorStatus(root, testResults) {
  const runs = testResults?.runs ?? [];
  const last = runs.length > 0 ? runs[runs.length - 1] : null;
  return {
    configured: readProfileTestCommands(root).length > 0,
    lastRun: last ? { at: last.at, ok: last.ok, head: last.head } : null,
  };
}

/**
 * Run the profile's test commands in order (stop at the first failure) and
 * record the pass/fail outcome keyed by HEAD. Records only the outcome, never
 * a count of tests or assertions.
 * @returns {{status: "no-commands"} | {status: "recorded", run: object}}
 */
export function runAndRecordTests(root, opts = {}) {
  const commands = opts.commands ?? readProfileTestCommands(root);
  if (commands.length === 0) return { status: "no-commands" };
  const spawn = opts.spawn ?? spawnSync;
  let exitCode = 0;
  for (const command of commands) {
    if (typeof opts.onCommand === "function") opts.onCommand(command);
    const res = spawn(command, { cwd: root, shell: true, stdio: opts.stdio ?? "inherit" });
    exitCode = typeof res.status === "number" ? res.status : 1;
    if (exitCode !== 0) break;
  }
  const headRes = spawn("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" });
  const head = String(headRes?.stdout ?? "").trim();
  const run = {
    at: (opts.now ?? new Date()).toISOString(),
    ok: exitCode === 0,
    exitCode,
    head: SHA_RE.test(head) ? head : null,
    commands,
  };
  appendTestResult(root, run);
  return { status: "recorded", run };
}
