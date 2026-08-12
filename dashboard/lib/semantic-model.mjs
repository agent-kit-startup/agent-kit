// dashboard/lib/semantic-model.mjs
// Pure Mission Control view-model helpers (testable; no fs/git I/O).

import { truncateStr } from "./guards.mjs";
import { TRIAGE_HEADING_RE, hasTriageHeading } from "./triage-heading.mjs";

/** Durable triage heading SoT (shared with CLI `monitors --untriaged`). */
export { TRIAGE_HEADING_RE, hasTriageHeading };

export const MAX_ACTIVITY = 28;
export const MAX_ATTENTION = 15;
export const MAX_SEMANTIC_LABEL = 200;
/** First-line chat identifying snippet shown on unanswered-prompt rows. */
export const MAX_CHAT_SNIPPET = 80;
export const MAX_GIT_ACTIVITY = 15;
/** Cap for agents/skills/commands/memory inventory delta events per snapshot. */
export const MAX_INVENTORY_ACTIVITY = 12;
/** Bound inventory names in labels (escapeHtml still applied at render). */
export const MAX_INVENTORY_NAME = 60;
/** Crew Monitor hero feed display cap (denser than the prior ~8–9 sparse rows).
 * Exposed on buildMissionControlView as monitorFeedCap for dashboard.html
 * (HTML cannot import this ESM module). */
export const MONITOR_FEED_CAP = 20;
/** Cap agent_step rows emitted per active plan for the denser Crew feed. */
export const MONITOR_AGENT_STEP_EMIT_CAP = 12;

/** Cap subagent-run rows emitted per snapshot (fs scan bounds live in dashboard-data.mjs). */
export const MONITOR_SUBAGENT_EMIT_CAP = 8;
/** Cap plan_review pointer rows emitted per snapshot. */
export const MONITOR_PLAN_REVIEW_EMIT_CAP = 4;

/**
 * Monitor hero curated subset over the semantic activity stream.
 * Live agent steps: run_plan / handoff / delivery plus agent_step (Task/orchestrator
 * to-do steps), subagent (Task worker lifecycle) and plan_review (background
 * mid-batch review pointers). plan_progress milestones stay on Activity / Checklist.
 * Activity (Phase 2) is the superset; inventory kinds are excluded here.
 */
export const MONITOR_ACTIVITY_KINDS = Object.freeze([
  "run_plan",
  "handoff",
  "delivery",
  "agent_step",
  "subagent",
  "plan_review",
]);

/**
 * Canonical resume guidance for unanswered agent-prompt Copy chat id controls
 * (tooltip / aria). Not rendered in the prompt card body.
 * Must not claim the panel opens a chat, file, or editor.
 * dashboard.html cannot import this ESM module; it mirrors the same string as
 * `PROMPT_RESUME_GUIDANCE` for `copyActionTitle('…', 'pastChatPicker')`.
 * field-report-prompts.test.ts asserts the HTML mirror matches this export.
 * See .cursor/memory/decisions/2026-07-25_mission-control-field-report-source-contract.md.
 */
export const PROMPT_RESUME_GUIDANCE =
  "Copy the chat id, paste it into the past-chat picker to resume, then answer the pending question.";

// Cap for agent prompts merged into the Field Report attention stack.
export const MAX_AGENT_PROMPTS = 8;

// Max external review reports surfaced in Field Report. Aligned with
// MAX_REPORT_FILES in dashboard-data.mjs so the surfacing cap never truncates
// below what the snapshot already read. External review is post-hoc, so most
// rows land as review debt; a low cap silently drops that owed triage.
export const MAX_EXTERNAL_REPORTS = 20;

// Max readiness advisories merged into the Field Report attention stack.
// Historical name kept; plan-state NOTES no longer emit here (Checklist cards).
export const MAX_CHECKLIST_NOTES = 15;

/**
 * External review reports are `.cursor/memory/plan-monitor-<slug>.md`. */
export const EXTERNAL_REPORT_FILE_RE = /^plan-monitor-(.+)\.md$/;

/**
 * Local Field Report dismissals store (IDs only). Valid attention ids that
 * `/field-report-resolve` may append: External reviews, agent prompts, and
 * activity cadence warnings.
 * Plan-state and HANDOFF ids are not dismiss targets on this surface.
 */
export const FIELD_REPORT_ATTENTION_ID_RE =
  /^attention:(?:prompt:[A-Za-z0-9._-]+|report:[A-Za-z0-9._-]+|cadence:[A-Za-z0-9._-]+)$/;

/** `**Plan:** [`name.plan.md`](../plans/name.plan.md)` in the report header. */
const REPORT_REVIEWED_PLAN_RE = /^\*\*Plan:\*\*\s*\[`([^`]+)`\]/m;

/**
 * Exact `*.plan.md` basename tokens. Used for Field Report lifecycle clear
 * from pending-question text; no fuzzy product-area matching.
 */
const PLAN_FILE_REF_RE = /\b([A-Za-z0-9._-]+\.plan\.md)\b/gi;

/**
 * Lifecycles that clear a prompt or demote an External-review row from the
 * blocking Field Report stack. `backlog` and live states never qualify.
 * `archived` covers plan files moved to `.cursor/plans/archive/`.
 */
const TERMINAL_FIELD_REPORT_LIFECYCLES = new Set(["completed", "parked", "archived"]);

/** True when `id` is a dismissable Field Report attention id. */
export function isFieldReportAttentionId(id) {
  return typeof id === "string" && FIELD_REPORT_ATTENTION_ID_RE.test(id);
}

/**
 * Extract exact `*.plan.md` basenames from pending-question (or similar) text.
 * Prefer false negatives: unmatched or missing refs yield an empty list.
 * @param {unknown} text
 * @returns {string[]}
 */
export function extractPlanFileRefs(text) {
  if (typeof text !== "string" || !text) return [];
  const ids = [];
  const seen = new Set();
  for (const match of text.matchAll(PLAN_FILE_REF_RE)) {
    const base = String(match[1] || "")
      .split("/")
      .pop()
      .trim();
    if (!base || seen.has(base)) continue;
    seen.add(base);
    ids.push(base);
  }
  return ids;
}

/**
 * Resolve a plan file's lifecycle from inventory + HANDOFF.
 * Missing plan records are `unknown` (never treated as terminal), except when
 * the file is present under `.cursor/plans/archive/`: archiving is routine
 * hygiene, not a missing plan, so it resolves as the terminal `archived`.
 * @param {string} planFile
 * @param {object[]} plans
 * @param {object|null} handoff
 * @param {string[]} [archivedPlanFiles] - `*.plan.md` names found in the archive
 * @returns {'executing'|'awaiting_user'|'parked'|'backlog'|'incomplete'|'completed'|'archived'|'unknown'}
 */
export function resolvePlanLifecycle(planFile, plans, handoff, archivedPlanFiles = []) {
  const key = String(planFile || "")
    .split("/")
    .pop()
    .trim();
  if (!key || !/\.plan\.md$/i.test(key)) return "unknown";
  const plan = (plans || []).find((p) => {
    const pf = planFileKey(p);
    return pf === key || pf.toLowerCase() === key.toLowerCase();
  });
  if (!plan) {
    const archived = (archivedPlanFiles || []).some((f) => {
      const base = String(f || "")
        .split("/")
        .pop()
        .trim();
      return base === key || base.toLowerCase() === key.toLowerCase();
    });
    return archived ? "archived" : "unknown";
  }
  // FR-SAC-02: a record with zero parsed to-dos is not reliable terminal
  // evidence for attention clearing (malformed or unsupported frontmatter can
  // yield an empty inventory). Treat it as unknown so a live prompt or report
  // is never hidden on a parse failure. Attention clear needs positive terminal
  // proof, which requires at least one parsed to-do.
  if (todoStats(plan).total === 0) return "unknown";
  return classifyPlan(plan, handoff);
}

/** True when lifecycle clears/demotes Field Report rows (completed, parked, or archived). */
export function isPlanLifecycleTerminal(lifecycle) {
  return TERMINAL_FIELD_REPORT_LIFECYCLES.has(lifecycle);
}

/**
 * Prompt lifecycle clear: every exact `*.plan.md` ref in the pending question
 * is terminal. No refs, or any active/backlog/unknown ref, keeps the row.
 * Does not replace the strong user-answer clear in `detectAwaitingPrompt`.
 * @param {unknown} pendingLabel
 * @param {object[]} plans
 * @param {object|null} handoff
 */
/**
 * Snapshot auto-clear for prompts: true when every exact `*.plan.md` ref in the
 * pending label is terminal in plan+HANDOFF. Intentionally narrower than
 * `/field-report-resolve` subject_resolved (HANDOFF/backlog/parked named
 * evidence). Prefer false negatives here; broader dismiss stays on the resolve
 * claim-check path. See source-contract ADR "Prompt subject-resolved".
 * @param {string} pendingLabel
 * @param {object[]} plans
 * @param {object|null} handoff
 */
export function isPromptClearedByPlanLifecycle(pendingLabel, plans, handoff) {
  const refs = extractPlanFileRefs(pendingLabel);
  if (refs.length === 0) return false;
  return refs.every((ref) => isPlanLifecycleTerminal(resolvePlanLifecycle(ref, plans, handoff)));
}

/**
 * Report demotion classifier (not triage): true when the reviewed plan is
 * terminal in plan+HANDOFF. A missing reviewed-plan header or unknown lifecycle
 * returns false. This is a classify signal, not an exclude flag:
 * `buildExternalReportItems` uses it to put a row in the `debt` group (true) or
 * the `blocking` group (false); it never removes the row. Must not set or imply
 * `isReportTriaged` (triage remains the hard hide).
 * @param {{ reviewedPlanFile?: string|null }} report
 * @param {object[]} plans
 * @param {object|null} handoff
 * @param {string[]} [archivedPlanFiles] - `*.plan.md` names found in the archive
 */
export function isReportDemotedByPlanLifecycle(report, plans, handoff, archivedPlanFiles = []) {
  const reviewed = report?.reviewedPlanFile;
  if (typeof reviewed !== "string" || !reviewed.trim()) return false;
  return isPlanLifecycleTerminal(resolvePlanLifecycle(reviewed, plans, handoff, archivedPlanFiles));
}

/**
 * Copy-only resolve action for one or more Field Report attention ids. Pastes
 * into chat; the agent turn writes the dismissals store. Never mutates the
 * repo from the panel. Accepts `attention:report:<slug>`,
 * `attention:prompt:<chatId>`, and `attention:cadence:<windowId>`.
 * @param {string|string[]} attentionIdOrIds
 */
export function fieldReportResolveAction(attentionIdOrIds) {
  const raw = Array.isArray(attentionIdOrIds) ? attentionIdOrIds : [attentionIdOrIds];
  const ids = [];
  const seen = new Set();
  for (const id of raw) {
    if (!isFieldReportAttentionId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return null;
  const bulk = ids.length > 1;
  return {
    type: "copy",
    target: `/field-report-resolve ${ids.join(" ")}`,
    label: bulk ? "Copy resolve command for all" : "Copy resolve command",
    subject: bulk ? "bulk resolve command" : "resolve command",
    pasteDestination: "chatInput",
  };
}

/**
 * Copy-only Review-all action for Field Report attention items with open gaps.
 * Produces `/plan-review-triage` with gap-filtered report paths in the same
 * order as buildExternalReportItems (blocking first, then debt). Skips items
 * with `hasOpenReviewGaps === false`. Returns null when empty or no paths.
 * @param {object[]} items - rendered attention items (buildExternalReportItems output)
 */
export function fieldReportTriageAllAction(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const paths = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item.sourcePath !== "string") continue;
    // Gap-aware: omit clean / no-open-residual rows (Review all, not every path).
    if (item.hasOpenReviewGaps === false) continue;
    const path = item.sourcePath.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  if (paths.length === 0) return null;
  return {
    type: "copy",
    target: `/plan-review-triage ${paths.join(" ")}`,
    label: "Copy review command for all",
    subject: "gap-aware review command for all",
    pasteDestination: "chatInput",
  };
}

/** Alias: Review all is the product name for the gap-filtered bulk CTA. */
export const fieldReportReviewAllAction = fieldReportTriageAllAction;

/**
 * Parse `.cursor/context/field-report-dismissals.json`. Missing or malformed
 * input yields an empty list (never throws). Keeps IDs only; drops unknown
 * fields so conversation content cannot ride along.
 * @param {unknown} raw
 * @returns {{ dismissals: { id: string, at?: string, reason?: string }[] }}
 */
export function parseFieldReportDismissals(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { dismissals: [] };
  }
  const list = Array.isArray(/** @type {{ dismissals?: unknown }} */ (raw).dismissals)
    ? /** @type {{ dismissals: unknown[] }} */ (raw).dismissals
    : [];
  const dismissals = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!isFieldReportAttentionId(id) || seen.has(id)) continue;
    seen.add(id);
    /** @type {{ id: string, at?: string, reason?: string }} */
    const row = { id };
    if (typeof entry.at === "string" && entry.at.trim()) {
      row.at = entry.at.trim();
    }
    if (typeof entry.reason === "string" && entry.reason.trim()) {
      row.reason = truncateStr(entry.reason.trim(), 120);
    }
    dismissals.push(row);
  }
  return { dismissals };
}

/** Attention ids from a parsed dismissals document. */
export function dismissedAttentionIds(parsed) {
  return (parsed?.dismissals || []).map((d) => d.id).filter(Boolean);
}

/** Relative path of the gitignored mission timing ledger (local observation). */
export const MISSION_TIMING_LEDGER_REL = ".cursor/context/mission-timing.json";

/** Empty v1 ledger. */
export function emptyMissionTimingLedger() {
  return { version: 1, missions: {} };
}

/**
 * Parse `.cursor/context/mission-timing.json`. Missing or malformed input
 * yields an empty ledger (never throws).
 * @param {unknown} raw
 */
export function parseMissionTimingLedger(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyMissionTimingLedger();
  }
  const missionsIn = /** @type {{ missions?: unknown }} */ (raw).missions;
  if (!missionsIn || typeof missionsIn !== "object" || Array.isArray(missionsIn)) {
    return emptyMissionTimingLedger();
  }
  /** @type {Record<string, { startedAt: string, frozenAt: string | null, stages: Record<string, { startedAt: string, endedAt: string | null }> }>} */
  const missions = {};
  for (const [planFile, entry] of Object.entries(missionsIn)) {
    if (typeof planFile !== "string" || !planFile.endsWith(".plan.md")) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const startedAt =
      typeof entry.startedAt === "string" && entry.startedAt.trim() ? entry.startedAt.trim() : null;
    if (!startedAt) continue;
    const frozenAt =
      typeof entry.frozenAt === "string" && entry.frozenAt.trim() ? entry.frozenAt.trim() : null;
    /** @type {Record<string, { startedAt: string, endedAt: string | null }>} */
    const stages = {};
    const stagesIn = entry.stages;
    if (stagesIn && typeof stagesIn === "object" && !Array.isArray(stagesIn)) {
      for (const [todoId, stage] of Object.entries(stagesIn)) {
        if (typeof todoId !== "string" || !todoId.trim()) continue;
        if (!stage || typeof stage !== "object" || Array.isArray(stage)) continue;
        const stageStart =
          typeof stage.startedAt === "string" && stage.startedAt.trim()
            ? stage.startedAt.trim()
            : null;
        if (!stageStart) continue;
        const endedAt =
          typeof stage.endedAt === "string" && stage.endedAt.trim() ? stage.endedAt.trim() : null;
        stages[todoId.trim()] = { startedAt: stageStart, endedAt };
      }
    }
    missions[planFile] = { startedAt, frozenAt, stages };
  }
  return { version: 1, missions };
}

/**
 * Stable JSON for ledger write-on-change (avoid SSE refresh loops).
 * @param {{ version?: number, missions?: Record<string, unknown> }} ledger
 */
export function serializeMissionTimingLedger(ledger) {
  const parsed = parseMissionTimingLedger(ledger);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/** Relative path of the gitignored Flight Log history ledger (past Gaps). */
export const FLIGHT_LOG_LEDGER_REL = ".cursor/context/flight-log.json";

/** Max past Gaps entries retained in the Flight Log ledger. */
export const FLIGHT_LOG_PAST_CAP = 15;

/** Empty v1 Flight Log ledger. */
export function emptyFlightLogLedger() {
  return { version: 1, lastCurrent: null, past: [], flightKey: null };
}

/**
 * Stable flight identity for wipe-on-new-flight (ADR flight boundary).
 * Plan basename (or `none`); under `run-plan-all`, prefix with ordered queue id
 * so a fresh queue start is a boundary even if the first plan matches.
 * @param {object|null|undefined} handoff - parseHandoffMarkdown-shaped object
 * @returns {string}
 */
export function buildFlightLogFlightKey(handoff) {
  const planRaw = handoff?.plan != null ? String(handoff.plan).split("/").pop().trim() : "";
  const planPart = planRaw && /\.plan\.md$/i.test(planRaw) ? planRaw.toLowerCase() : "none";
  const mode = typeof handoff?.mode === "string" ? handoff.mode : "";
  if (/\brun-plan-all\b/i.test(mode)) {
    const queue = Array.isArray(handoff?.runQueue) ? handoff.runQueue : [];
    const queueId = queue
      .map((p) => String(p).split("/").pop().trim().toLowerCase())
      .filter((base) => /\.plan\.md$/i.test(base))
      .join(",");
    return `queue:${queueId}#${planPart}`;
  }
  return `plan:${planPart}`;
}

/**
 * Parse `.cursor/context/flight-log.json`. Missing or malformed → empty ledger.
 * @param {unknown} raw
 */
export function parseFlightLogLedger(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyFlightLogLedger();
  }
  const lastRaw = /** @type {{ lastCurrent?: unknown }} */ (raw).lastCurrent;
  const lastCurrent = typeof lastRaw === "string" && lastRaw.trim() ? lastRaw.trim() : null;
  const keyRaw = /** @type {{ flightKey?: unknown }} */ (raw).flightKey;
  const flightKey = typeof keyRaw === "string" && keyRaw.trim() ? keyRaw.trim() : null;
  const pastIn = /** @type {{ past?: unknown }} */ (raw).past;
  /** @type {{ text: string, at: string, sourcePath: string }[]} */
  const past = [];
  if (Array.isArray(pastIn)) {
    for (const entry of pastIn) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const text = typeof entry.text === "string" && entry.text.trim() ? entry.text.trim() : null;
      if (!text) continue;
      const at =
        typeof entry.at === "string" && entry.at.trim()
          ? entry.at.trim()
          : new Date(0).toISOString();
      const sourcePath =
        typeof entry.sourcePath === "string" && entry.sourcePath.trim()
          ? entry.sourcePath.trim()
          : ".cursor/HANDOFF.md";
      past.push({ text, at, sourcePath });
      if (past.length >= FLIGHT_LOG_PAST_CAP) break;
    }
  }
  return { version: 1, lastCurrent, past, flightKey };
}

/**
 * Stable JSON for Flight Log write-on-change (avoid SSE refresh loops).
 * @param {{ version?: number, lastCurrent?: string | null, past?: unknown[], flightKey?: string | null }} ledger
 */
export function serializeFlightLogLedger(ledger) {
  const parsed = parseFlightLogLedger(ledger);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * Observe live Gaps vs the history ledger. When Gaps text changes **within the
 * same flight**, append the previous non-empty value to past (dedupe identical
 * consecutive; cap N). On flight-key change (new plan, queue start, or Plan
 * none): wipe past and reset lastCurrent seed so prior-flight rows do not carry.
 * @param {{ version?: number, lastCurrent?: string | null, past?: unknown[], flightKey?: string | null }} ledger
 * @param {string | null | undefined} liveGaps
 * @param {{ nowMs?: number, sourcePath?: string, pastCap?: number, flightKey?: string | null }} [opts]
 */
/**
 * Compose one copy-only Flight Log action per the locked composed-command
 * spec: dynamic label, a paste-ready command (action prompt, then the
 * document path on its own line), and the referenced document path.
 */
function flightLogCopyAction(label, prompt, path) {
  return { label, command: `${prompt}\n${path}`, sourcePath: path };
}

export function observeFlightLog(ledger, liveGaps, opts = {}) {
  const nowMs =
    typeof opts.nowMs === "number" && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const sourcePath =
    typeof opts.sourcePath === "string" && opts.sourcePath.trim()
      ? opts.sourcePath.trim()
      : ".cursor/HANDOFF.md";
  const pastCap =
    typeof opts.pastCap === "number" && opts.pastCap > 0
      ? Math.floor(opts.pastCap)
      : FLIGHT_LOG_PAST_CAP;
  const nextFlightKey =
    typeof opts.flightKey === "string" && opts.flightKey.trim() ? opts.flightKey.trim() : null;
  const prev = parseFlightLogLedger(ledger);
  const current = typeof liveGaps === "string" && liveGaps.trim() ? liveGaps.trim() : null;
  const prevKey = prev.flightKey;
  const flightKey = nextFlightKey ?? prevKey;
  const boundary = Boolean(nextFlightKey) && prevKey !== nextFlightKey;

  /** @type {{ text: string, at: string, sourcePath: string }[]} */
  let past = boundary ? [] : [...prev.past];
  const lastCurrent = boundary ? null : prev.lastCurrent;
  if (!boundary && lastCurrent && lastCurrent !== current) {
    const head = past[0];
    if (!head || head.text !== lastCurrent) {
      past = [{ text: lastCurrent, at: new Date(nowMs).toISOString(), sourcePath }, ...past].slice(
        0,
        pastCap,
      );
    }
  }
  const nextLedger = { version: 1, lastCurrent: current, past, flightKey };
  const pastWithKind = past.map((entry) => ({
    ...entry,
    kind: classifyFlightLogMessageKind(entry.text),
    action: flightLogCopyAction(
      "Copy fix prompt",
      `Act on these earlier residuals:\n${entry.text}`,
      entry.sourcePath || ".cursor/HANDOFF.md",
    ),
  }));
  return {
    ledger: nextLedger,
    flightLog: {
      current,
      currentKind: classifyFlightLogMessageKind(current),
      past: pastWithKind,
      sourcePath,
      currentAction: current
        ? flightLogCopyAction(
            "Copy fix prompt",
            `Act on these open residuals:\n${current}`,
            sourcePath,
          )
        : null,
    },
  };
}

/** Match HANDOFF Mode/Gaps/Instruction API/usage hard-stop (quota). */
const FLIGHT_LOG_API_LIMIT_RE =
  /\bAPI\s*\/\s*usage\s+limit\b|\bAPI\s+usage\s+limit\b|\bSTOPPED:\s*API\b/i;

/** Match orchestrator heads-up prose in Gaps/Instruction (bounded). */
const FLIGHT_LOG_HEADS_UP_RE = /\bheads?\s*-?\s*up\b/i;

/** Cap operator Warnings on Flight Log (scannable lane). */
export const FLIGHT_LOG_WARNINGS_CAP = 5;
/** Cap untriaged external-review rows on Flight Log quiet-state surface. */
export const FLIGHT_LOG_QUIET_OPEN_TRIAGES_CAP = 5;

/**
 * Operator-useful Warnings for Flight Log (read-only projection from HANDOFF).
 * Includes API/usage hard-stop and orchestrator heads-up. Excludes cadence
 * WARNING cards, Review/Resolve CTAs, and Field Report attention kinds.
 * @param {object|null|undefined} handoff - parseHandoffMarkdown result
 * @param {{ cap?: number }} [opts]
 * @returns {{ id: string, kind: 'api_limit'|'orchestrator_heads_up', severity: 'warning', title: string, text: string, sourcePath: string, action: { label: string, command: string, sourcePath: string } }[]}
 */
export function buildFlightLogWarnings(handoff, opts = {}) {
  const cap =
    typeof opts.cap === "number" && opts.cap > 0 ? Math.floor(opts.cap) : FLIGHT_LOG_WARNINGS_CAP;
  if (!handoff || typeof handoff !== "object") return [];

  const mode = typeof handoff.mode === "string" ? handoff.mode : "";
  const gaps = typeof handoff.gaps === "string" ? handoff.gaps : "";
  const instruction = typeof handoff.instruction === "string" ? handoff.instruction : "";
  const blob = `${mode}\n${gaps}\n${instruction}`;
  const sourcePath = ".cursor/HANDOFF.md";
  /** @type {{ id: string, kind: 'api_limit'|'orchestrator_heads_up', severity: 'warning', title: string, text: string, sourcePath: string }[]} */
  const out = [];

  if (FLIGHT_LOG_API_LIMIT_RE.test(blob)) {
    const text =
      (gaps && FLIGHT_LOG_API_LIMIT_RE.test(gaps) ? gaps : null) ||
      (instruction && FLIGHT_LOG_API_LIMIT_RE.test(instruction) ? instruction : null) ||
      (mode && FLIGHT_LOG_API_LIMIT_RE.test(mode) ? mode : null) ||
      "Quota pause. Switch to a named model or wait for reset, then resume.";
    out.push({
      id: "flight-log-warning:api_limit",
      kind: "api_limit",
      severity: "warning",
      title: "Quota pause",
      text: truncateStr(text.trim(), MAX_SEMANTIC_LABEL),
      sourcePath,
      action: flightLogCopyAction(
        "Copy recovery prompt",
        `Resume after this quota pause:\n${truncateStr(text.trim(), MAX_SEMANTIC_LABEL)}`,
        sourcePath,
      ),
    });
  }

  if (FLIGHT_LOG_HEADS_UP_RE.test(blob) && out.length < cap) {
    const text =
      (gaps && FLIGHT_LOG_HEADS_UP_RE.test(gaps) ? gaps : null) ||
      (instruction && FLIGHT_LOG_HEADS_UP_RE.test(instruction) ? instruction : null) ||
      "Something needs a look before the next step.";
    // Avoid duplicating the same body as the API/usage card.
    if (!out.some((w) => w.text === truncateStr(text.trim(), MAX_SEMANTIC_LABEL))) {
      out.push({
        id: "flight-log-warning:orchestrator_heads_up",
        kind: "orchestrator_heads_up",
        severity: "warning",
        title: "Heads up",
        text: truncateStr(text.trim(), MAX_SEMANTIC_LABEL),
        sourcePath,
        action: flightLogCopyAction(
          "Copy follow-up prompt",
          `Act on this heads-up:\n${truncateStr(text.trim(), MAX_SEMANTIC_LABEL)}`,
          sourcePath,
        ),
      });
    }
  }

  return out.slice(0, cap);
}

/**
 * Bounded untriaged external-review rows for Flight Log quiet state.
 * Filters to `kind === "report"` with a non-empty `sourcePath` (no cadence,
 * prompts, readiness, or bulk FR CTAs). Prefer calling with
 * `buildExternalReportItems(...)` output so the quiet lane is not starved by
 * the shared `buildAttentionItems` cap. Callers must not mix these rows into a
 * non-quiet Gaps/Warnings stack.
 * @param {object[]|null|undefined} reportOrAttentionItems
 * @param {{ limit?: number }} [opts]
 * @returns {object[]}
 */
export function listFlightLogQuietOpenTriages(reportOrAttentionItems, opts = {}) {
  const limit =
    typeof opts.limit === "number" && opts.limit > 0
      ? Math.floor(opts.limit)
      : FLIGHT_LOG_QUIET_OPEN_TRIAGES_CAP;
  if (!Array.isArray(reportOrAttentionItems) || reportOrAttentionItems.length === 0) return [];
  const out = [];
  for (const item of reportOrAttentionItems) {
    if (!item || item.kind !== "report") continue;
    if (typeof item.sourcePath !== "string" || !item.sourcePath.trim()) continue;
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Relative path of the gitignored Field Report activity cadence ledger. */
export const FIELD_REPORT_CADENCE_LEDGER_REL = ".cursor/context/field-report-cadence.json";

/** Default cadence config when the key is missing. */
export const DEFAULT_FIELD_REPORT_REVIEW_CADENCE = Object.freeze({
  enabled: true,
  tickThreshold: 3,
});

/** Empty v1 cadence ledger. */
export function emptyCadenceLedger() {
  return {
    version: 1,
    ticksSinceClear: 0,
    lastBatchCompleteAt: null,
    activeWarningId: null,
    windowId: null,
    pendingPlanFiles: [],
  };
}

/**
 * Parse `.cursor/context/field-report-cadence.json`. Missing or malformed
 * input yields an empty ledger (never throws).
 * @param {unknown} raw
 */
export function parseCadenceLedger(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyCadenceLedger();
  }
  const ticksRaw = /** @type {{ ticksSinceClear?: unknown }} */ (raw).ticksSinceClear;
  const ticksSinceClear =
    typeof ticksRaw === "number" && Number.isInteger(ticksRaw) && ticksRaw >= 0
      ? Math.min(ticksRaw, 10_000)
      : 0;
  const lastBatchCompleteAt =
    typeof raw.lastBatchCompleteAt === "string" && raw.lastBatchCompleteAt.trim()
      ? raw.lastBatchCompleteAt.trim()
      : null;
  const windowId =
    typeof raw.windowId === "string" && /^[A-Za-z0-9._-]+$/.test(raw.windowId.trim())
      ? raw.windowId.trim()
      : null;
  let activeWarningId =
    typeof raw.activeWarningId === "string" && raw.activeWarningId.trim()
      ? raw.activeWarningId.trim()
      : null;
  if (activeWarningId && !isFieldReportAttentionId(activeWarningId)) {
    activeWarningId = null;
  }
  if (windowId && !activeWarningId) {
    activeWarningId = `attention:cadence:${windowId}`;
  }
  if (activeWarningId && !windowId) {
    const m = /^attention:cadence:([A-Za-z0-9._-]+)$/.exec(activeWarningId);
    if (m) {
      // keep activeWarningId; window derived below via pending only
    }
  }
  const pendingIn = Array.isArray(raw.pendingPlanFiles) ? raw.pendingPlanFiles : [];
  const pendingPlanFiles = [];
  const seen = new Set();
  for (const entry of pendingIn) {
    if (typeof entry !== "string") continue;
    const base = entry.split("/").pop().trim();
    if (!base || !/\.plan\.md$/i.test(base) || seen.has(base)) continue;
    seen.add(base);
    pendingPlanFiles.push(base);
  }
  const derivedWindow =
    windowId ||
    (activeWarningId
      ? (() => {
          const m = /^attention:cadence:([A-Za-z0-9._-]+)$/.exec(activeWarningId);
          return m ? m[1] : null;
        })()
      : null);
  return {
    version: 1,
    ticksSinceClear,
    lastBatchCompleteAt,
    activeWarningId: derivedWindow ? `attention:cadence:${derivedWindow}` : null,
    windowId: derivedWindow,
    pendingPlanFiles,
  };
}

/**
 * Stable JSON for cadence ledger write-on-change.
 * @param {ReturnType<typeof emptyCadenceLedger>} ledger
 */
export function serializeCadenceLedger(ledger) {
  const parsed = parseCadenceLedger(ledger);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * Parse `fieldReportReviewCadence` from config. Missing → defaults.
 * @param {unknown} rawConfig
 */
export function parseFieldReportReviewCadenceConfig(rawConfig) {
  const defaults = { ...DEFAULT_FIELD_REPORT_REVIEW_CADENCE };
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return defaults;
  }
  const block = /** @type {{ fieldReportReviewCadence?: unknown }} */ (rawConfig)
    .fieldReportReviewCadence;
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return defaults;
  }
  const enabled = typeof block.enabled === "boolean" ? block.enabled : defaults.enabled;
  const thr = block.tickThreshold;
  const tickThreshold =
    typeof thr === "number" && Number.isInteger(thr) && thr >= 1 && thr <= 100
      ? thr
      : defaults.tickThreshold;
  return { enabled, tickThreshold };
}

/**
 * Compact UTC window id: `w-YYYYMMDDHHmmss`.
 * @param {Date|number|string} [now]
 */
export function cadenceWindowIdFromNow(now = Date.now()) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) {
    return `w-${Date.now()}`;
  }
  const p = (n) => String(n).padStart(2, "0");
  return `w-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/**
 * List still-unreviewed work for cadence emit and batch CTAs.
 * Includes untriaged monitors and terminal plans without a matching monitor
 * file (existence). Every report slug enters `monitorSlugs`; triage only gates
 * first-loop inclusion. Does not emit owed attention rows.
 * @returns {{ kind: 'report'|'owed', planFile: string, slug: string, path: string }[]}
 */
export function listUnreviewedReviewTargets(
  plans,
  handoff,
  externalReports = [],
  archivedPlanFiles = [],
) {
  const targets = [];
  const seenPlans = new Set();
  const monitorSlugs = new Set();

  for (const report of externalReports || []) {
    if (!report || !report.file) continue;
    const slug = normalizeSlug(report.slug) || normalizeSlug(report.file);
    if (!slug) continue;
    // Existence for owed exclusion: record every report slug before triage gate.
    monitorSlugs.add(slug);
    if (isReportTriaged(report, plans)) continue;
    const planFile =
      typeof report.reviewedPlanFile === "string" && report.reviewedPlanFile.trim()
        ? report.reviewedPlanFile.trim()
        : `${slug}.plan.md`;
    if (seenPlans.has(planFile)) continue;
    seenPlans.add(planFile);
    targets.push({
      kind: "report",
      planFile,
      slug,
      path: report.path || `.cursor/memory/plan-monitor-${slug}.md`,
    });
  }

  for (const plan of plans || []) {
    const planFile = planFileKey(plan);
    if (!planFile || seenPlans.has(planFile)) continue;
    const lifecycle = resolvePlanLifecycle(planFile, plans, handoff, archivedPlanFiles);
    if (!isPlanLifecycleTerminal(lifecycle)) continue;
    const slug = planFile.replace(/\.plan\.md$/i, "");
    if (!slug || monitorSlugs.has(normalizeSlug(slug))) continue;
    seenPlans.add(planFile);
    targets.push({
      kind: "owed",
      planFile,
      slug,
      path: `.cursor/plans/${planFile}`,
    });
  }

  return targets;
}

/**
 * Batch paste-only launcher covering all still-unreviewed plan basenames.
 * @param {{ planFile: string }[]} targets
 */
export function buildBatchExternalReviewPasteCommand(targets) {
  const files = [];
  const seen = new Set();
  for (const t of targets || []) {
    const base = String(t?.planFile || "")
      .split("/")
      .pop()
      .trim();
    if (!base || !/\.plan\.md$/i.test(base) || seen.has(base)) continue;
    seen.add(base);
    files.push(base);
  }
  if (files.length === 0) return null;
  return `.cursor/scripts/plan-external-review.sh --force --paste-only --batch ${files.join(" ")}`;
}

/**
 * Per-plan interactive paste command (terminal).
 * @param {string} planFile
 */
export function buildPerPlanExternalReviewPasteCommand(planFile) {
  const base = String(planFile || "")
    .split("/")
    .pop()
    .trim();
  if (!base || !/\.plan\.md$/i.test(base)) return null;
  return `.cursor/scripts/plan-external-review.sh --force --interactive ${base}`;
}

/**
 * Apply a completed `/run-plan` tick to the cadence ledger.
 * @param {ReturnType<typeof emptyCadenceLedger>} ledger
 * @param {{ nowIso?: string, unreviewedTargets?: { planFile: string }[], tickThreshold?: number, enabled?: boolean }} opts
 */
export function recordCadenceTickClose(ledger, opts = {}) {
  const next = parseCadenceLedger(ledger);
  if (opts.enabled === false) return next;
  const threshold =
    typeof opts.tickThreshold === "number" && opts.tickThreshold >= 1
      ? opts.tickThreshold
      : DEFAULT_FIELD_REPORT_REVIEW_CADENCE.tickThreshold;
  next.ticksSinceClear += 1;
  const targets = Array.isArray(opts.unreviewedTargets) ? opts.unreviewedTargets : [];
  if (targets.length === 0) return next;
  if (next.ticksSinceClear < threshold && next.activeWarningId) return next;
  if (next.ticksSinceClear < threshold) return next;
  const nowIso = opts.nowIso || new Date().toISOString();
  const windowId = next.windowId || cadenceWindowIdFromNow(nowIso);
  next.windowId = windowId;
  next.activeWarningId = `attention:cadence:${windowId}`;
  next.pendingPlanFiles = targets
    .map((t) =>
      String(t?.planFile || "")
        .split("/")
        .pop()
        .trim(),
    )
    .filter((f) => f && /\.plan\.md$/i.test(f));
  return next;
}

/**
 * Mark `/run-plan-all` queue complete on the cadence ledger.
 * @param {ReturnType<typeof emptyCadenceLedger>} ledger
 * @param {{ nowIso?: string, unreviewedTargets?: { planFile: string }[], enabled?: boolean }} opts
 */
export function recordCadenceBatchComplete(ledger, opts = {}) {
  const next = parseCadenceLedger(ledger);
  if (opts.enabled === false) return next;
  const nowIso = opts.nowIso || new Date().toISOString();
  next.lastBatchCompleteAt = nowIso;
  const targets = Array.isArray(opts.unreviewedTargets) ? opts.unreviewedTargets : [];
  if (targets.length === 0) return next;
  const windowId = cadenceWindowIdFromNow(nowIso);
  next.windowId = windowId;
  next.activeWarningId = `attention:cadence:${windowId}`;
  next.pendingPlanFiles = targets
    .map((t) =>
      String(t?.planFile || "")
        .split("/")
        .pop()
        .trim(),
    )
    .filter((f) => f && /\.plan\.md$/i.test(f));
  return next;
}

/**
 * Clear the active cadence window after subject-resolved or operator hide.
 * @param {ReturnType<typeof emptyCadenceLedger>} ledger
 */
export function clearCadenceWarning(ledger) {
  const next = parseCadenceLedger(ledger);
  next.ticksSinceClear = 0;
  next.activeWarningId = null;
  next.windowId = null;
  next.pendingPlanFiles = [];
  return next;
}

/**
 * Shape one cadence warning attention item, or null when not eligible.
 * @param {ReturnType<typeof emptyCadenceLedger>} ledger
 * @param {{ planFile: string, slug?: string, path?: string, kind?: string }[]} targets
 * @param {{ enabled?: boolean, dismissed?: Set<string> }} [opts]
 */
export function buildCadenceAttentionItem(ledger, targets, opts = {}) {
  if (opts.enabled === false) return null;
  const parsed = parseCadenceLedger(ledger);
  if (!parsed.activeWarningId || !parsed.windowId) return null;
  if (opts.dismissed?.has(parsed.activeWarningId)) return null;
  const liveTargets = Array.isArray(targets) ? targets : [];
  if (liveTargets.length === 0) return null;

  const batchTarget = buildBatchExternalReviewPasteCommand(liveTargets);
  if (!batchTarget) return null;

  const perPlanActions = [];
  for (const t of liveTargets.slice(0, 8)) {
    const cmd = buildPerPlanExternalReviewPasteCommand(t.planFile);
    if (!cmd) continue;
    perPlanActions.push({
      type: "copy",
      target: cmd,
      label: `Copy review: ${String(t.planFile).replace(/\.plan\.md$/i, "")}`,
      subject: `external review ${t.planFile}`,
      pasteDestination: "terminal",
    });
  }

  const count = liveTargets.length;
  return withResolveAction({
    id: parsed.activeWarningId,
    kind: "cadence",
    group: "cadence",
    severity: "warning",
    label: truncateStr(
      `Review cadence: ${count} unreviewed plan${count === 1 ? "" : "s"} after recent run activity`,
      MAX_SEMANTIC_LABEL,
    ),
    sourcePath: FIELD_REPORT_CADENCE_LEDGER_REL,
    modifiedAt: parsed.lastBatchCompleteAt || null,
    progress: null,
    pendingPlanFiles: parsed.pendingPlanFiles.slice(),
    action: {
      type: "copy",
      target: batchTarget,
      label: "Copy batch external review",
      subject: "batch external review",
      pasteDestination: "terminal",
    },
    secondaryActions: perPlanActions,
  });
}

function cloneMissionTimingLedger(ledger) {
  return parseMissionTimingLedger(
    JSON.parse(serializeMissionTimingLedger(ledger || emptyMissionTimingLedger())),
  );
}

/**
 * Attach timing fields to a Current mission (`now`) slice. Idle / missing
 * timing → nulls so the UI can omit chrome.
 * @param {object} now
 * @param {object | null} timing
 */
export function withMissionTiming(now, timing) {
  const base = now && typeof now === "object" ? now : {};
  if (!timing || typeof timing !== "object") {
    return {
      ...base,
      totalElapsedMs: null,
      currentStageElapsedMs: null,
      currentStageId: null,
      stages: null,
      timingStartedAt: null,
      timingFrozenAt: null,
      currentStageStartedAt: null,
    };
  }
  return {
    ...base,
    totalElapsedMs:
      typeof timing.totalElapsedMs === "number" && Number.isFinite(timing.totalElapsedMs)
        ? Math.max(0, Math.floor(timing.totalElapsedMs))
        : null,
    currentStageElapsedMs:
      typeof timing.currentStageElapsedMs === "number" &&
      Number.isFinite(timing.currentStageElapsedMs)
        ? Math.max(0, Math.floor(timing.currentStageElapsedMs))
        : null,
    currentStageId:
      typeof timing.currentStageId === "string" && timing.currentStageId.trim()
        ? timing.currentStageId.trim()
        : null,
    stages: Array.isArray(timing.stages) ? timing.stages : null,
    timingStartedAt:
      typeof timing.startedAt === "string" && timing.startedAt.trim()
        ? timing.startedAt.trim()
        : null,
    timingFrozenAt:
      typeof timing.frozenAt === "string" && timing.frozenAt.trim() ? timing.frozenAt.trim() : null,
    currentStageStartedAt:
      typeof timing.currentStageStartedAt === "string" && timing.currentStageStartedAt.trim()
        ? timing.currentStageStartedAt.trim()
        : null,
  };
}

/**
 * Observe plan/todo transitions into a local timing ledger and emit elapsed
 * fields for Current mission. Idle omits timing. Completed freezes totals.
 * Honesty: durations are approximate when the dashboard missed transitions.
 *
 * @param {object} ledger - parsed ledger
 * @param {object} now - from buildCurrentExecution
 * @param {object} [opts]
 * @param {number} [opts.nowMs]
 * @param {{ id: string, status?: string }[]} [opts.todoItems]
 * @returns {{ ledger: object, timing: object | null }}
 */
export function observeMissionTiming(ledger, now, { nowMs = Date.now(), todoItems = [] } = {}) {
  const next = cloneMissionTimingLedger(ledger);
  if (!now || now.status === "idle" || !now.planFile) {
    return { ledger: next, timing: null };
  }

  const planFile = String(now.planFile);
  const iso = new Date(nowMs).toISOString();
  let mission = next.missions[planFile];
  if (!mission) {
    mission = { startedAt: iso, frozenAt: null, stages: {} };
    next.missions[planFile] = mission;
  } else if (!mission.startedAt) {
    mission.startedAt = iso;
  }

  const currentId =
    now.currentTodo?.id && typeof now.currentTodo.id === "string" ? now.currentTodo.id : null;

  // Close stages that are no longer current.
  for (const [id, stage] of Object.entries(mission.stages)) {
    if (!stage.endedAt && id !== currentId) {
      stage.endedAt = iso;
    }
  }

  if (currentId) {
    if (!mission.stages[currentId]) {
      mission.stages[currentId] = { startedAt: iso, endedAt: null };
    } else if (mission.stages[currentId].endedAt && now.status !== "completed") {
      // Re-opened current step: clear end so live elapsed continues from original start.
      mission.stages[currentId].endedAt = null;
    }
  } else if (now.status === "completed" && now.previousTodo?.id) {
    // Seed terminal step if we never observed it live.
    const lastId = String(now.previousTodo.id);
    if (!mission.stages[lastId]) {
      mission.stages[lastId] = { startedAt: mission.startedAt, endedAt: null };
    }
  }

  if (now.status === "completed") {
    if (!mission.frozenAt) mission.frozenAt = iso;
    for (const stage of Object.values(mission.stages)) {
      if (!stage.endedAt) stage.endedAt = mission.frozenAt;
    }
  } else {
    mission.frozenAt = null;
  }

  const startMs = Date.parse(mission.startedAt);
  const endMs = mission.frozenAt ? Date.parse(mission.frozenAt) : nowMs;
  const totalElapsedMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;

  let currentStageId = currentId;
  if (!currentStageId && now.status === "completed" && now.previousTodo?.id) {
    currentStageId = String(now.previousTodo.id);
  }

  let currentStageElapsedMs = null;
  let currentStageStartedAt = null;
  if (currentStageId && mission.stages[currentStageId]) {
    const st = mission.stages[currentStageId];
    currentStageStartedAt = st.startedAt;
    const stageStart = Date.parse(st.startedAt);
    const stageEnd = st.endedAt ? Date.parse(st.endedAt) : endMs;
    if (Number.isFinite(stageStart) && Number.isFinite(stageEnd)) {
      currentStageElapsedMs = Math.max(0, stageEnd - stageStart);
    }
  }

  const items = Array.isArray(todoItems) ? todoItems : [];
  const stages = [];
  for (const item of items) {
    if (!item?.id || typeof item.id !== "string") continue;
    const st = mission.stages[item.id];
    if (!st) continue;
    const stageStart = Date.parse(st.startedAt);
    const stageEnd = st.endedAt
      ? Date.parse(st.endedAt)
      : mission.frozenAt
        ? Date.parse(mission.frozenAt)
        : nowMs;
    if (!Number.isFinite(stageStart) || !Number.isFinite(stageEnd)) continue;
    stages.push({
      id: item.id,
      elapsedMs: Math.max(0, Math.floor(stageEnd - stageStart)),
      status: item.status || null,
    });
  }

  return {
    ledger: next,
    timing: {
      totalElapsedMs: Math.floor(totalElapsedMs),
      currentStageElapsedMs:
        currentStageElapsedMs == null ? null : Math.floor(currentStageElapsedMs),
      currentStageId,
      stages,
      startedAt: mission.startedAt,
      frozenAt: mission.frozenAt,
      currentStageStartedAt,
    },
  };
}

/** Attach the copy-only resolve CTA when the id is dismissable. */
function withResolveAction(item) {
  if (!item?.id) return item;
  const resolveAction = fieldReportResolveAction(item.id);
  if (!resolveAction) return item;
  return { ...item, resolveAction };
}

/**
 * Names an agent question tool_use inside a transcript entry. Confirmed from
 * real local transcripts: the call is `AskQuestion`. The `ask_question` and
 * `cursor/ask_question` spellings are accepted so the same rule survives the
 * ACP and snake_case surfaces documented for the tool.
 */
export const AGENT_QUESTION_TOOL_RE = /^(ask[_-]?question|cursor\/ask_question)$/i;

const AWAITING_MODE_RE =
  /\b(awaiting|waiting|gate\s*[ab]|gate\s+b|start-project\s+gate|user\s+approval|hitl)\b/i;
const EXECUTING_MODE_RE = /\b(run-plan|in_progress|orchestrated|in-session|tick)\b/i;
/** HANDOFF mode signals that the run stopped / plan is exhausted (not live). */
const STOPPED_EXHAUSTED_MODE_RE = /\b(STOPPED|exhausted|plan exhausted)\b/i;
const MERGE_PR_RE = /^([0-9a-f]{7,40})\s+Merge pull request #(\d+)\b(.*)$/i;
const STAGING_COMMIT_RE = /\b(git staging|\/git-staging|merge.*staging|to staging)\b/i;
/** Conventional branch type prefix (one segment) used when mapping merge branches to plan basenames. */
const BRANCH_TYPE_PREFIX_RE =
  /^(?:feat|fix|docs|test|chore|refactor|update|perf|style|ci|build|revert)\//;
const MERGE_FROM_BRANCH_RE = /\bfrom\s+(\S+)/i;

/**
 * Kit agent identities (`.cursor/agents/<id>.md` basenames). Plan `agent:` must
 * match one of these; plan slugs and Task worker_types are not agent ids.
 */
export const KIT_AGENT_IDS = Object.freeze([
  "cleancode-refactor",
  "clickup-tasks",
  "context-librarian",
  "docs-repo",
  "git-autogit",
  "json-guardian",
  "memory-extractor",
  "n8n-workflows",
  "prompts-agents",
  "security-reviewer",
  "sql-schema",
  "tech-lead",
  "test-suites",
]);

const KIT_AGENT_ID_SET = new Set(KIT_AGENT_IDS);

/**
 * Normalize a plan `agent:` value to a kit agent id, or null when absent/invalid.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeKitAgentId(raw) {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return KIT_AGENT_ID_SET.has(id) ? id : null;
}

/**
 * Extract the feature branch from a merge-PR trailing segment (` from org/branch`).
 * Drops the remote/org segment before the first `/`.
 * @param {string} trailing
 * @returns {string|null}
 */
export function extractMergeBranch(trailing) {
  const m = String(trailing || "").match(MERGE_FROM_BRANCH_RE);
  if (!m) return null;
  const remoteBranch = m[1];
  const slash = remoteBranch.indexOf("/");
  if (slash < 0) return remoteBranch || null;
  const branch = remoteBranch.slice(slash + 1);
  return branch || null;
}

/**
 * Resolve a delivery plan (and its agent) from a merge branch via exact basename match.
 * Never falls back to the active plan. Ambiguity or no match → nulls.
 * @param {string|null|undefined} branch
 * @param {Array<{ file?: string, agent?: string|null }>} [plans]
 * @returns {{ plan: string|null, agent: string|null }}
 */
export function resolveDeliveryAttribution(branch, plans = []) {
  if (!branch) return { plan: null, agent: null };

  const candidates = new Set();
  if (BRANCH_TYPE_PREFIX_RE.test(branch)) {
    candidates.add(branch.replace(BRANCH_TYPE_PREFIX_RE, ""));
  }
  candidates.add(branch.replace(/\//g, "-"));

  /** @type {Map<string, { file: string, agent: string|null }>} */
  const byBasename = new Map();
  for (const p of plans || []) {
    const file = p?.file;
    if (!file || typeof file !== "string") continue;
    const base = file.replace(/\.plan\.md$/i, "");
    if (!base || byBasename.has(base)) continue;
    byBasename.set(base, { file, agent: p.agent || null });
  }

  /** @type {Map<string, { file: string, agent: string|null }>} */
  const matched = new Map();
  for (const c of candidates) {
    const hit = byBasename.get(c);
    if (hit) matched.set(hit.file, hit);
  }
  if (matched.size !== 1) return { plan: null, agent: null };
  const only = matched.values().next().value;
  return { plan: only.file, agent: only.agent };
}

/**
 * Parse Agent Kit HANDOFF.md into structured fields used by Mission Control.
 * @param {string} content
 */
export function parseHandoffMarkdown(content) {
  if (!content || typeof content !== "string") {
    return null;
  }

  const handoff = {};

  // Prefer backticked Plan refs; also accept plain `*.plan.md` (agents often omit
  // backticks). Reject none/n/a and non-plan prose (false-negative policy).
  const planRaw = extractHandoffPlanRef(content);
  if (planRaw) {
    handoff.plan = planRaw;
    handoff.planPath = planRaw.startsWith(".cursor/")
      ? planRaw
      : `.cursor/plans/${planRaw.replace(/^plans\//, "")}`;
  }

  const lastUpdated = content.match(/^- \*\*Last updated:\*\*\s*(.+)$/m);
  if (lastUpdated) handoff.lastUpdated = lastUpdated[1].trim();

  const modeMatch = content.match(/^- \*\*Mode:\*\*\s*(.+)$/m);
  if (modeMatch) handoff.mode = truncateStr(modeMatch[1].trim(), MAX_SEMANTIC_LABEL);

  const phaseMatch = content.match(/^- \*\*Phase completed:\*\*\s*(.+)$/m);
  if (phaseMatch) handoff.phaseCompleted = phaseMatch[1].trim();

  const nextPhaseMatch = content.match(/^- \*\*Next phase:\*\*\s*(.+)$/m);
  if (nextPhaseMatch) handoff.nextPhase = nextPhaseMatch[1].trim();

  const completedMatch = content.match(/^- \*\*Completed to-dos:\*\*\s*(.+)$/m);
  if (completedMatch) handoff.completedTodos = completedMatch[1].trim();

  const nextTodosMatch = content.match(/^- \*\*Next to-dos:\*\*\s*(.+)$/m);
  if (nextTodosMatch) handoff.nextTodos = nextTodosMatch[1].trim();

  const parkedRaw = extractHandoffFieldBlock(content, "Parked plans");
  if (parkedRaw) {
    handoff.parkedPlansRaw = parkedRaw;
    handoff.parkedPlans = parseParkedPlans(parkedRaw);
  } else {
    handoff.parkedPlans = [];
  }

  let backlogRaw = extractHandoffFieldBlock(content, "Backlog plans");
  if (!backlogRaw) backlogRaw = extractHandoffFieldBlock(content, "Backlog");
  if (backlogRaw) {
    handoff.backlogPlansRaw = backlogRaw;
    handoff.backlogPlans = parseParkedPlans(backlogRaw);
  } else {
    handoff.backlogPlans = [];
  }

  // /run-plan-all queue slice (see .cursor/context/templates/handoff.md and
  // 2026-07-26_cockpit-run-plan-all-queue-awareness.md). Presence-based: the
  // parser records what the HANDOFF says; Mode gating happens in the semantic
  // layer. Same false-negative policy as parked/backlog plan refs.
  const runQueueRaw = extractHandoffFieldBlock(content, "Run queue");
  if (runQueueRaw) {
    handoff.runQueueRaw = runQueueRaw;
    handoff.runQueue = parseRunQueue(runQueueRaw);
  } else {
    handoff.runQueue = [];
  }

  const queueCursorMatch = content.match(/^- \*\*Queue cursor:\*\*\s*(.+)$/m);
  if (queueCursorMatch) {
    const cursor = parseQueueCursor(queueCursorMatch[1]);
    handoff.queueCursor = cursor.index;
    handoff.queueCursorPlan = cursor.plan;
  } else {
    handoff.queueCursor = null;
    handoff.queueCursorPlan = null;
  }

  const queueStatusMatch = content.match(/^- \*\*Queue status:\*\*\s*(.+)$/m);
  if (queueStatusMatch) {
    handoff.queueStatus = truncateStr(queueStatusMatch[1].trim(), MAX_SEMANTIC_LABEL);
  }

  const queueOutcomesRaw = extractHandoffFieldBlock(content, "Queue outcomes");
  if (queueOutcomesRaw) {
    handoff.queueOutcomesRaw = queueOutcomesRaw;
    handoff.queueOutcomes = parseQueueOutcomes(queueOutcomesRaw);
  } else {
    handoff.queueOutcomes = {};
  }

  // Gaps: same-line or nested block (`- **Gaps:**` machine field). Empty /
  // none / n/a normalize to null so the cockpit can hide the surface.
  const gapsRaw = extractHandoffFieldBlock(content, "Gaps");
  if (gapsRaw) {
    const gaps = normalizeHandoffGaps(gapsRaw);
    if (gaps) handoff.gaps = gaps;
  }

  const instructionMatch = content.match(/^- \*\*Instruction for the next agent:\*\*\s*(.+)$/m);
  if (instructionMatch) {
    handoff.instruction = truncateStr(instructionMatch[1].trim(), MAX_SEMANTIC_LABEL);
  }

  return Object.keys(handoff).length > 0 ? handoff : null;
}

/**
 * Normalize HANDOFF Gaps text for Mission Control. Treats empty, `none`,
 * `n/a`, `none.` / `none:`-prefixed OK notes, and empty-residual placeholders
 * as absent so OK status does not surface as a yellow Live Gaps debit.
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizeHandoffGaps(raw) {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/^(none|n\/a)$/i.test(text)) return null;
  // OK + pointer anti-pattern: "none. Residuals…", "None: …", "N/A - …", "none (…)"
  if (/^(none|n\/a)\s*[.:,;\/(\-–—…]/i.test(text)) return null;
  // Empty residual placeholders
  if (/^([-–—.…]|empty|no gaps?|cleared|all clear|ok)$/i.test(text)) return null;
  return truncateStr(text, MAX_SEMANTIC_LABEL);
}

/**
 * Flight Log typed notification kinds (ADR 2026-07-27_mc-flight-log-panel).
 * Distinct from Crew Monitor step kinds; shared palette tokens only.
 * @typedef {'ok'|'advice'|'prompt'|'warning'|'residual'} FlightLogMessageKind
 */

/**
 * Classify a Flight Log Gaps/Warning body for palette chrome.
 * Runs heuristics on whitespace-collapsed text **before** display truncation so
 * long Gaps whose only warning/prompt/advice keyword sits past MAX_SEMANTIC_LABEL
 * still match the inline dashboard.html classifier (which does not truncate).
 * @param {string | null | undefined} text
 * @param {{ lane?: 'gaps' | 'warning' }} [opts]
 * @returns {FlightLogMessageKind}
 */
export function classifyFlightLogMessageKind(text, opts = {}) {
  if (opts.lane === "warning") return "warning";
  if (!text || typeof text !== "string") return "ok";
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "ok";
  if (/^(none|n\/a)$/i.test(collapsed)) return "ok";
  if (/^(none|n\/a)\s*[.:,;\/(\-–—…]/i.test(collapsed)) return "ok";
  if (/^([-–—.…]|empty|no gaps?|cleared|all clear|ok)$/i.test(collapsed)) return "ok";
  if (
    /\bAPI\s*\/\s*usage\s+limit\b|\bAPI\s+usage\s+limit\b|\bSTOPPED:\s*API\b/i.test(collapsed) ||
    /\b(hard.?stop|quota\s+pause)\b/i.test(collapsed)
  ) {
    return "warning";
  }
  if (
    /\b(confirm|ask questions|hitl|\bpaste\b|choose\b|approve\b|operator yes)\b/i.test(collapsed)
  ) {
    return "prompt";
  }
  if (/\b(tip:|advice:|consider\b|recommends?\b|recommended\b|prefer\b)/i.test(collapsed)) {
    return "advice";
  }
  return "residual";
}

/**
 * CSS modifier class for Flight Log kind chrome.
 * @param {FlightLogMessageKind | string | null | undefined} kind
 * @returns {string}
 */
export function flightLogKindClass(kind) {
  switch (kind) {
    case "ok":
      return "flight-log-kind-ok";
    case "advice":
    case "prompt":
      return "flight-log-kind-advice";
    case "warning":
      return "flight-log-kind-warning";
    default:
      return "flight-log-kind-residual";
  }
}

/**
 * Parse the ordered `Run queue` block into `*.plan.md` basenames.
 * Accepts the template's bracketed comma list (`[a.plan.md, b.plan.md]`),
 * backticked variants, and nested bullets. Order is preserved; duplicates and
 * anything that is not an exact `*.plan.md` basename are dropped (prefer
 * false negatives over inventing plan refs).
 * @param {string} raw
 * @returns {string[]}
 */
export function parseRunQueue(raw) {
  if (!raw || typeof raw !== "string") return [];
  const text = raw
    .trim()
    .replace(/^\[/, "")
    .replace(/\]\s*$/, "");
  const ids = [];
  const seen = new Set();
  for (const part of text.split(/[,;\n]/)) {
    const cleaned = String(part)
      .replace(/`/g, "")
      .replace(/\(.*?\)/g, "")
      .trim()
      .replace(/^-\s*/, "")
      .replace(/^plans\//, "");
    if (!cleaned || /^none$/i.test(cleaned)) continue;
    const base = cleaned.split("/").pop();
    if (!base || !/\.plan\.md$/i.test(base) || seen.has(base)) continue;
    seen.add(base);
    ids.push(base);
  }
  return ids;
}

/**
 * Parse `Queue cursor` (`N (current: plan-x.plan.md)`). A missing or
 * non-numeric index yields `{ index: null, plan: null }`; the optional
 * `current:` plan ref must be an exact `*.plan.md` basename.
 * @param {string} raw
 * @returns {{ index: number|null, plan: string|null }}
 */
export function parseQueueCursor(raw) {
  const text = String(raw || "").trim();
  const indexMatch = text.match(/^(\d+)\b/);
  const index = indexMatch ? Number(indexMatch[1]) : null;
  let plan = null;
  const currentMatch = text.match(/current:\s*`?([^`()]+?)`?\s*\)/i);
  if (currentMatch) {
    const base = currentMatch[1].trim().split("/").pop();
    if (base && /\.plan\.md$/i.test(base)) plan = base;
  }
  return { index, plan };
}

/**
 * Parse `Queue outcomes` lines (`plan-x.plan.md: completed (notes)`) into a
 * basename → outcome-token map. The outcome is the first word after the colon,
 * lowercased; notes stay in `queueOutcomesRaw`. Lines without an exact
 * `*.plan.md` basename are skipped.
 * @param {string} raw
 * @returns {Record<string, string>}
 */
export function parseQueueOutcomes(raw) {
  if (!raw || typeof raw !== "string") return {};
  /** @type {Record<string, string>} */
  const outcomes = {};
  for (const line of raw.split("\n")) {
    const cleaned = line.replace(/^-\s*/, "").trim();
    if (!cleaned) continue;
    const m = cleaned.match(
      /^`?([A-Za-z0-9._/-]*?[A-Za-z0-9._-]+\.plan\.md)`?\s*:\s*([A-Za-z_-]+)/i,
    );
    if (!m) continue;
    const base = m[1].split("/").pop();
    if (!base || outcomes[base]) continue;
    outcomes[base] = m[2].toLowerCase();
  }
  return outcomes;
}

/**
 * Extract the active plan basename from `- **Plan:** …`.
 * Accepts `- **Plan:** \`file.plan.md\`` or plain `- **Plan:** file.plan.md`.
 * Returns null for missing lines, `none` / `n/a`, or non-`*.plan.md` values.
 * @param {string} content
 * @returns {string|null}
 */
export function extractHandoffPlanRef(content) {
  if (!content || typeof content !== "string") return null;
  const match = content.match(/^- \*\*Plan:\*\*\s*(.+)$/m);
  if (!match) return null;
  let raw = match[1].trim();
  const tick = raw.match(/^`([^`]+)`/);
  if (tick) raw = tick[1].trim();
  if (!raw || /^(none|n\/a)\b/i.test(raw)) return null;
  const baseMatch = raw.match(/([A-Za-z0-9._-]+\.plan\.md)/i);
  if (!baseMatch) return null;
  return baseMatch[1];
}

/**
 * Capture a HANDOFF field as a multi-line block: same-line remainder plus
 * nested bullets, stopping at the next top-level `- **Field:**`.
 * Fallback: `## FieldLabel` heading + following bullets (agents often invent
 * section headings instead of `- **Field:**` machine bullets). Prefer false
 * negatives over inventing plan refs from prose.
 * @param {string} content
 * @param {string} fieldLabel
 * @returns {string|null}
 */
export function extractHandoffFieldBlock(content, fieldLabel) {
  if (!content || typeof content !== "string" || !fieldLabel) return null;
  const escaped = String(fieldLabel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^- \\*\\*${escaped}:\\*\\*\\s*(.*)$`, "m");
  const match = content.match(re);
  if (match) {
    const chunks = [];
    const sameLine = match[1].trim();
    if (sameLine) chunks.push(sameLine);

    const after = content.slice(match.index + match[0].length);
    for (const line of after.split("\n")) {
      if (/^- \*\*[^*:\n]+:\*\*/.test(line)) break;
      if (!line.trim()) continue;
      if (/^\s+\S/.test(line)) {
        chunks.push(line.trim());
        continue;
      }
      break;
    }

    const raw = chunks.join("\n").trim();
    if (raw) return raw;
  }

  // Heading antipattern fallback: ## Backlog plans / ## Parked plans / ## Run queue
  const headingRe = new RegExp(`^##\\s+${escaped}\\s*$`, "m");
  const heading = content.match(headingRe);
  if (!heading) return null;

  const chunks = [];
  const after = content.slice(heading.index + heading[0].length);
  for (const line of after.split("\n")) {
    if (/^##\s+/.test(line)) break;
    if (/^- \*\*[^*:\n]+:\*\*/.test(line)) {
      // Nested machine field under the heading (e.g. ## Run queue then - **Run queue:**)
      // Prefer the field parser path when present; do not double-consume here.
      if (new RegExp(`^- \\*\\*${escaped}:\\*\\*`, "m").test(line)) break;
      break;
    }
    if (!line.trim()) {
      if (chunks.length > 0) break;
      continue;
    }
    if (/^[-*]\s+/.test(line) || /^\s+\S/.test(line)) {
      chunks.push(line.trim());
      continue;
    }
    break;
  }

  const raw = chunks.join("\n").trim();
  return raw || null;
}

/**
 * Extract `*.plan.md` basenames from a HANDOFF plan-reference block.
 * Rejects branch names, memory/monitor paths, and other inline backtick noise.
 */
export function parseParkedPlans(raw) {
  if (!raw || typeof raw !== "string") return [];
  const ids = [];
  const backtick = [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const sources = backtick.length > 0 ? backtick : raw.split(/[,;]/);
  for (const part of sources) {
    const cleaned = String(part)
      .replace(/\(.*?\)/g, "")
      .trim()
      .replace(/^plans\//, "");
    if (!cleaned || /^none$/i.test(cleaned)) continue;
    const base = cleaned.split("/").pop();
    if (!base || !/\.plan\.md$/i.test(base)) continue;
    ids.push(base);
  }
  return [...new Set(ids)];
}

/** Queue outcomes that mean the plan's run is over and cannot be next up. */
const TERMINAL_QUEUE_OUTCOMES = new Set(["completed", "cancelled", "skipped"]);

/** True when HANDOFF Mode names the multi-plan queue mode. */
function modeIsRunPlanAll(mode) {
  return typeof mode === "string" && /\brun-plan-all\b/i.test(mode);
}

/**
 * Build the /run-plan-all queue view from a parsed HANDOFF, or null when the
 * snapshot is not in queue mode (Mode is not run-plan-all, or Run queue is
 * empty). Cursor resolution prefers the explicit in-range index, then the
 * `current:` basename, then the active plan's queue position; unresolvable
 * cursors stay null and yield no next-up plan (false negative over guessing).
 * @param {object|null} handoff
 * @returns {{ queue: string[], cursor: number|null, status: string|null,
 *   outcomes: Record<string, string>, nextUpPlan: string|null }|null}
 */
export function buildRunQueueView(handoff) {
  const queue = Array.isArray(handoff?.runQueue) ? handoff.runQueue : [];
  if (!modeIsRunPlanAll(handoff?.mode) || queue.length === 0) return null;

  let cursor = null;
  if (
    Number.isInteger(handoff.queueCursor) &&
    handoff.queueCursor >= 0 &&
    handoff.queueCursor < queue.length
  ) {
    cursor = handoff.queueCursor;
  }
  if (cursor === null && handoff.queueCursorPlan) {
    const idx = queue.indexOf(handoff.queueCursorPlan);
    if (idx >= 0) cursor = idx;
  }
  if (cursor === null) {
    const idx = queue.indexOf(handoffPlanKey(handoff));
    if (idx >= 0) cursor = idx;
  }

  const outcomes =
    handoff.queueOutcomes && typeof handoff.queueOutcomes === "object" ? handoff.queueOutcomes : {};

  let nextUpPlan = null;
  if (cursor !== null) {
    for (let i = cursor + 1; i < queue.length; i++) {
      if (TERMINAL_QUEUE_OUTCOMES.has(outcomes[queue[i]])) continue;
      nextUpPlan = queue[i];
      break;
    }
  }

  return {
    queue,
    cursor,
    status: handoff.queueStatus || null,
    outcomes,
    nextUpPlan,
  };
}

/**
 * Queue role for one plan, layered on top of lifecycle when the snapshot is in
 * /run-plan-all queue mode. Roles never replace lifecycle (the executing
 * shimmer keys on lifecycle, not on this field).
 * @param {object} plan
 * @param {ReturnType<typeof buildRunQueueView>} runQueueView
 * @returns {'executing'|'next_up'|'queued'|'completed_in_queue'|'none'}
 */
export function planQueueRole(plan, runQueueView) {
  if (!runQueueView) return "none";
  const key = planFileKey(plan);
  const idx = runQueueView.queue.indexOf(key);
  if (idx < 0) return "none";
  if (TERMINAL_QUEUE_OUTCOMES.has(runQueueView.outcomes[key])) return "completed_in_queue";
  const { cursor, nextUpPlan } = runQueueView;
  if (cursor === null) return "queued";
  if (idx === cursor) return "executing";
  if (key === nextUpPlan) return "next_up";
  if (idx > cursor) return "queued";
  // Before the cursor without a terminal outcome: the queue moved past it
  // (blocked/partial); fall back to lifecycle-only presentation.
  return "none";
}

function planFileKey(plan) {
  if (!plan) return "";
  return String(plan.file || plan.path || plan.id || "")
    .split("/")
    .pop()
    .trim();
}

function handoffPlanKey(handoff) {
  if (!handoff?.plan) return "";
  return String(handoff.plan).split("/").pop().trim();
}

function isActivePlan(plan, handoff) {
  const active = handoffPlanKey(handoff);
  if (!active) return false;
  const key = planFileKey(plan);
  if (!key) return false;
  return (
    key === active ||
    key === `${active}.plan.md` ||
    active === key.replace(/\.plan\.md$/, "") ||
    active.includes(key) ||
    key.includes(active.replace(/\.plan\.md$/, ""))
  );
}

function planListedIn(plan, list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  const key = planFileKey(plan);
  const id = String(plan?.id || "");
  return list.some((p) => {
    const base = String(p).split("/").pop();
    return (
      base === key ||
      base === `${id}.plan.md` ||
      base.replace(/\.plan\.md$/, "") === id ||
      key.includes(base.replace(/\.plan\.md$/, ""))
    );
  });
}

function isParkedPlan(plan, handoff) {
  return planListedIn(plan, handoff?.parkedPlans);
}

function isBacklogPlan(plan, handoff) {
  return planListedIn(plan, handoff?.backlogPlans);
}

/** Terminal to-do statuses: work that can no longer be current or next. */
const TERMINAL_TODO_STATUSES = new Set(["completed", "cancelled"]);

function todoStats(plan) {
  const items = plan?.todos?.items || [];
  // When items exist, treat their statuses as SoT for open/in_progress so a
  // stale summary cannot collapse a mission during HANDOFF transitions.
  const fromItems = items.length > 0;
  const completed = fromItems
    ? items.filter((t) => t.status === "completed").length
    : (plan?.todos?.completed ?? 0);
  const inProgress = fromItems
    ? items.filter((t) => t.status === "in_progress").length
    : (plan?.todos?.inProgress ?? 0);
  const pending = fromItems
    ? items.filter((t) => t.status === "pending").length
    : (plan?.todos?.pending ?? 0);
  const cancelled = fromItems ? items.filter((t) => t.status === "cancelled").length : 0;
  const total = fromItems ? items.length : (plan?.todos?.total ?? 0);
  const open = fromItems
    ? items.filter((t) => !TERMINAL_TODO_STATUSES.has(t.status)).length
    : Math.max(0, total - completed - cancelled);
  return { items, total, completed, inProgress, pending, cancelled, open };
}

function modeImpliesAwaiting(mode) {
  return typeof mode === "string" && AWAITING_MODE_RE.test(mode);
}

function modeImpliesStoppedExhausted(mode) {
  return typeof mode === "string" && STOPPED_EXHAUSTED_MODE_RE.test(mode);
}

/**
 * Live run signals. STOPPED/exhausted modes often still mention run-plan or
 * orchestrated; those must not count as executing once the run has stopped.
 */
function modeImpliesExecuting(mode) {
  return (
    typeof mode === "string" && EXECUTING_MODE_RE.test(mode) && !modeImpliesStoppedExhausted(mode)
  );
}

/**
 * Classify a plan lifecycle from HANDOFF + todo evidence.
 * Parked plans with zero open todos present as completed (not PARKED at N/N).
 * Backlog plans (queued by /start-project) are a first-class info lifecycle;
 * zero open todos also present as completed (mirror parked).
 * Active plan: terminal todos (open === 0) are always completed, even when Mode
 * still says run-plan before Final HANDOFF writes STOPPED/exhausted. Open work
 * never classifies as completed (pending/in_progress hold the mission live).
 * @returns {'executing'|'awaiting_user'|'parked'|'backlog'|'incomplete'|'completed'}
 */
export function classifyPlan(plan, handoff) {
  const stats = todoStats(plan);

  if (isParkedPlan(plan, handoff)) {
    if (stats.open === 0) return "completed";
    return "parked";
  }

  if (isBacklogPlan(plan, handoff)) {
    if (stats.open === 0) return "completed";
    return "backlog";
  }

  const active = isActivePlan(plan, handoff);
  const mode = handoff?.mode || "";

  if (active) {
    // Terminal work: hold completed (not idle, not a false executing tick).
    if (stats.open === 0) return "completed";
    // Open work: never completed. Premature STOPPED/exhausted still holds live.
    if (modeImpliesAwaiting(mode) && stats.inProgress === 0) return "awaiting_user";
    if (stats.inProgress > 0 || modeImpliesExecuting(mode)) return "executing";
    return "awaiting_user";
  }

  if (stats.total > 0 && stats.open === 0) return "completed";
  if (stats.open > 0) {
    if (stats.completed > 0 || stats.inProgress > 0) return "incomplete";
    return "backlog";
  }
  return "completed";
}

function pickCurrentTodo(plan, handoff) {
  const items = plan?.todos?.items || [];
  const inProg = items.find((t) => t.status === "in_progress");
  if (inProg) return inProg;

  const nextRaw = handoff?.nextTodos || "";
  const nextId = nextRaw.match(/`?([a-z0-9][\w-]*)`?/i)?.[1];
  if (nextId) {
    // An exhausted HANDOFF often still names the last id it ran. A terminal
    // to-do is not current work, so it must not resurface as the current step.
    const matched = items.find((t) => t.id === nextId);
    if (matched && !TERMINAL_TODO_STATUSES.has(matched.status)) return matched;
  }
  return items.find((t) => t.status === "pending") || null;
}

function pickPreviousTodo(plan, current) {
  const items = plan?.todos?.items || [];
  let end = items.length;
  if (current) {
    const idx = items.findIndex((t) => t.id === current.id);
    if (idx >= 0) end = idx;
  }
  for (let i = end - 1; i >= 0; i--) {
    if (items[i].status === "completed") return items[i];
  }
  return null;
}

function pickNextTodo(plan, current) {
  const items = plan?.todos?.items || [];
  if (!current) {
    return items.find((t) => t.status === "pending" || t.status === "in_progress") || null;
  }
  const idx = items.findIndex((t) => t.id === current.id);
  if (idx >= 0) {
    for (let i = idx + 1; i < items.length; i++) {
      if (items[i].status === "pending" || items[i].status === "in_progress") {
        return items[i];
      }
    }
  }
  return items.find((t) => t.id !== current.id && t.status === "pending") || null;
}

function compactTodo(todo) {
  if (!todo) return null;
  return {
    id: todo.id,
    content: truncateStr(todo.content || "", MAX_SEMANTIC_LABEL),
    status: todo.status,
  };
}

/**
 * Build the "what is happening now" slice.
 *
 * Presentation contract (completed vs idle):
 * - When HANDOFF still names a plan and that plan's to-dos are terminal,
 *   status is `"completed"` and the mission keeps plan identity + N/N progress.
 * - True idle (`status: "idle"`, null plan refs, 0/0 progress) only when
 *   HANDOFF has no plan reference. Completed is never collapsed to idle here.
 *
 * Lifecycle hold (HANDOFF transitions):
 * - Pending or in_progress to-dos never render as completed or idle, even when
 *   Mode already says STOPPED/exhausted (premature Final HANDOFF).
 * - All-terminal to-dos render completed even when Mode still says run-plan
 *   (tick closed to-do status before Final HANDOFF marks exhausted).
 *
 * Terminal step contract (completed missions): no to-do is open, so
 * `currentTodo` and `nextTodo` are null and `previousTodo` carries the last
 * completed to-do. That is the terminal step the panel renders as done; there
 * is no pending step left to announce.
 */
export function buildCurrentExecution(plans, handoff) {
  if (!handoff?.plan) {
    return {
      status: "idle",
      planId: null,
      planFile: null,
      planPath: null,
      mode: null,
      progress: { completed: 0, total: 0 },
      previousTodo: null,
      currentTodo: null,
      nextTodo: null,
      modifiedAt: null,
      sourcePath: ".cursor/HANDOFF.md",
      lifecycle: null,
      nextUpPlan: null,
    };
  }

  const active = (plans || []).find((p) => isActivePlan(p, handoff)) || null;
  const lifecycle = active ? classifyPlan(active, handoff) : null;
  const stats = active ? todoStats(active) : { completed: 0, total: 0, open: 0, inProgress: 0 };
  const currentTodo = active ? pickCurrentTodo(active, handoff) : null;
  const previousTodo = active ? pickPreviousTodo(active, currentTodo) : null;
  const nextTodo = active ? pickNextTodo(active, currentTodo) : null;

  let status = "idle";
  if (lifecycle === "executing") status = "executing";
  else if (lifecycle === "awaiting_user") status = "awaiting_user";
  else if (lifecycle === "completed") status = "completed";
  else if (active && stats.open > 0) status = "awaiting_user";

  // Defense in depth: open work must never collapse to completed or idle.
  if (active && stats.open > 0 && (status === "completed" || status === "idle")) {
    status = stats.inProgress > 0 ? "executing" : "awaiting_user";
  }

  return {
    status,
    planId: active?.id || handoff.plan.replace(/\.plan\.md$/, ""),
    planFile: active?.file || handoffPlanKey(handoff),
    planPath: active?.path || handoff.planPath || null,
    mode: handoff.mode || null,
    // HANDOFF Gaps (stop reasons / residuals). Null when absent or "none".
    gaps: handoff.gaps || null,
    progress: { completed: stats.completed, total: stats.total },
    previousTodo: compactTodo(previousTodo),
    currentTodo: compactTodo(currentTodo),
    nextTodo: compactTodo(nextTodo),
    modifiedAt: active?.modifiedAt || handoff.lastUpdated || null,
    sourcePath: ".cursor/HANDOFF.md",
    lifecycle,
    // Next queue item after the cursor in /run-plan-all mode (basename), or
    // null. The panel uses it only on terminal Next paths; live in-plan Next
    // stays the in-plan to-do.
    nextUpPlan: buildRunQueueView(handoff)?.nextUpPlan ?? null,
  };
}

function activityId(kind, parts) {
  return truncateStr(`${kind}:${parts.filter(Boolean).join(":")}`, 120);
}

/**
 * Format durable git log lines into semantic activity events.
 * @param {string[]} logLines - `git log --oneline` style lines (newest first)
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {Iterable<string>|Set<string>|null} [opts.excludeShas] - SHAs already
 *   covered by a delivery event (merge + absorbed commits); skip those rows
 */
export function formatGitActivity(logLines, { limit = MAX_GIT_ACTIVITY, excludeShas = null } = {}) {
  const exclude =
    excludeShas instanceof Set ? excludeShas : new Set(excludeShas ? [...excludeShas] : []);
  const events = [];
  for (const line of logLines || []) {
    if (events.length >= limit) break;
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;

    const merge = trimmed.match(MERGE_PR_RE);
    if (merge) {
      const sha = merge[1].slice(0, 7);
      if (exclude.has(sha)) continue;
      const pr = merge[2];
      events.push({
        id: activityId("merge", [pr, sha]),
        kind: "merge",
        at: null,
        label: truncateStr(`Merged PR #${pr} → ${sha}.`, MAX_SEMANTIC_LABEL),
        refs: { pr: Number(pr), sha },
      });
      continue;
    }

    const m = trimmed.match(/^([0-9a-f]{7,40})\s+(.+)$/i);
    if (!m) continue;
    const sha = m[1].slice(0, 7);
    if (exclude.has(sha)) continue;
    const message = m[2].trim();
    const kind = STAGING_COMMIT_RE.test(message) ? "staging" : "commit";
    events.push({
      id: activityId(kind, [sha]),
      kind,
      at: null,
      label: truncateStr(
        kind === "staging" ? `Staging ${sha}: ${message}` : `Commit ${sha}: ${message}`,
        MAX_SEMANTIC_LABEL,
      ),
      refs: { sha },
    });
  }
  return events;
}

/** GitHub squash-merge subject suffix (`title (#N)`): one shipped PR in one commit. */
const SQUASH_PR_SUFFIX_RE = /\(#(\d+)\)$/;

/** Conventional Commit type at subject start (scope + breaking `!` optional). */
const CONVENTIONAL_COMMIT_TYPE_RE =
  /^(feat|fix|docs|chore|refactor|style|perf|test|ci|build)(\([^)]*\))?(!)?:\s*/i;

/** Types folded into the Monitor delivery `chore` chip subclass. */
const DELIVERY_CHORE_TYPES = new Set(["chore", "refactor", "style", "perf", "test", "ci", "build"]);

/**
 * Map a delivery brief subject to a Monitor chip subtype.
 * Keep `kind: delivery`; subtypes only drive icon/color.
 * @param {string|null|undefined} subject
 * @param {{ hasPr?: boolean }} [opts]
 * @returns {'feat'|'fix'|'docs'|'chore'|'pr'|'ship'}
 */
export function parseDeliveryCommitType(subject, { hasPr = false } = {}) {
  const text = String(subject || "").trim();
  if (text) {
    const m = text.match(CONVENTIONAL_COMMIT_TYPE_RE);
    if (m) {
      const raw = m[1].toLowerCase();
      if (raw === "feat") return "feat";
      if (raw === "fix") return "fix";
      if (raw === "docs") return "docs";
      if (DELIVERY_CHORE_TYPES.has(raw)) return "chore";
    }
  }
  if (hasPr) return "pr";
  return "ship";
}

/** Strip trailing `(#N)` from a squash subject for brief delivery labels. */
function stripSquashPrSuffix(subject) {
  return String(subject || "")
    .trim()
    .replace(/\s*\(#\d+\)$/, "")
    .trim();
}

/**
 * Coalesce `git log --oneline` lines into delivery events anchored on merges.
 * A `Merge pull request #N` line absorbs the non-merge commits beneath it (the
 * feature commits it merged) until the next delivery anchor, so one shipped
 * unit renders as one delivery event. A squash-merged commit (`title (#N)`) is
 * its own single-commit anchor: it stops absorption so its commit is never
 * attributed to a neighboring merge. Commits above the newest anchor are
 * unshipped and emit nothing here (they stay `commit` rows on the activity
 * stream). Coalescing is purely positional: the oneline format carries no
 * timestamps, so there is no time-window heuristic.
 *
 * Labels include a brief ship subject (squash title without `(#N)`, or the first
 * absorbed feature commit subject) plus PR # and sha. Attribution is resolved
 * per merge branch against plan basenames (never from the active plan); squash
 * lines carry no branch, so they resolve to nulls.
 * @param {string[]} logLines - `git log --oneline` lines (newest first)
 * @param {object} [opts]
 * @param {Array<{ file?: string, agent?: string|null }>} [opts.plans] - snapshot plans for attribution
 * @param {number} [opts.limit] - max delivery events (mirrors other producers)
 */
export function formatDeliveryActivity(logLines, { plans = [], limit = MAX_GIT_ACTIVITY } = {}) {
  const entries = [];
  for (const line of logLines || []) {
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;
    const merge = trimmed.match(MERGE_PR_RE);
    if (merge) {
      entries.push({
        sha: merge[1].slice(0, 7),
        pr: Number(merge[2]),
        kind: "merge",
        branch: extractMergeBranch(merge[3]),
        subject: null,
      });
      continue;
    }
    const m = trimmed.match(/^([0-9a-f]{7,40})\s+(.+)$/i);
    if (!m) continue;
    const fullSubject = m[2].trim();
    const squash = fullSubject.match(SQUASH_PR_SUFFIX_RE);
    entries.push({
      sha: m[1].slice(0, 7),
      pr: squash ? Number(squash[1]) : null,
      kind: squash ? "squash" : "commit",
      branch: null,
      subject: stripSquashPrSuffix(fullSubject),
    });
  }

  // Entries stay newest-first. In this repository's history a merge line is
  // followed by the feature commits it merged, then the next merge or squash.
  const events = [];
  for (let i = 0; i < entries.length; i++) {
    if (events.length >= limit) break;
    const entry = entries[i];
    if (entry.kind === "commit") continue;
    const shas = [entry.sha];
    let brief = entry.kind === "squash" ? entry.subject : null;
    if (entry.kind === "merge") {
      for (let j = i + 1; j < entries.length && entries[j].kind === "commit"; j++) {
        shas.push(entries[j].sha);
        if (!brief && entries[j].subject) brief = entries[j].subject;
      }
    }
    const { plan: planName, agent } = resolveDeliveryAttribution(entry.branch, plans);
    const kitAgent = normalizeKitAgentId(agent);
    const actor = briefActivityActor(kitAgent, { kind: "delivery", plan: planName });
    const prBit = `PR #${entry.pr}`;
    // Verb `merged` (not `shipped`, retired 2026-08-05): the row is derived from
    // a merge/squash entry, and `shipped` implied a prod promote /git-staging
    // never performed.
    const label = brief
      ? `${actor} \u00b7 merged \u00b7 ${brief} \u00b7 ${prBit} \u00b7 ${entry.sha}`
      : `${actor} \u00b7 merged \u00b7 ${prBit} \u00b7 ${entry.sha}`;
    const commitType = parseDeliveryCommitType(brief, { hasPr: entry.pr != null });
    events.push({
      id: activityId("delivery", ["merge", String(entry.pr)]),
      kind: "delivery",
      at: null,
      agent: kitAgent,
      label: truncateStr(label, MAX_SEMANTIC_LABEL),
      // `sha` is the merge/squash commit: copy-only target for Monitor rows.
      // `commitType` drives solid delivery chip subclasses (feat/fix/docs/chore/pr/ship).
      refs: { sha: entry.sha, commits: shas, pr: entry.pr, plan: planName, commitType },
    });
  }

  return events;
}

/**
 * Actor segment for Monitor return-brief labels.
 * Kit agent id, else `Eng` for delivery, else `SQ` when a plan is present
 * (never the full plan filename), else `Eng`.
 *
 * Short display masks from the operator lexicon (2026-08-05): Engineering
 * Manager -> Eng, Squad -> SQ, Platform Engineer -> Eng. `Eng` is a documented
 * collision between the delivery and system fallbacks; the resolution keys
 * (`orchestrator` / `crew` / `system`) and the row's kind glyph stay distinct.
 * ADR: decisions/2026-07-27_crew-monitor-vs-plan-monitor-glossary.md.
 * @param {string|null|undefined} agent
 * @param {{ kind?: string, plan?: string|null }} [opts]
 */
export function briefActivityActor(agent, { kind, plan } = {}) {
  const kit = normalizeKitAgentId(agent);
  if (kit) return kit;
  if (kind === "delivery") return "Eng";
  if (plan) return "SQ";
  return "Eng";
}

/**
 * Collect SHAs a delivery event already represents (merge/squash + absorbed commits).
 * Used to drop superseded raw git rows from the unified Activity stream.
 * @param {Array<{ refs?: { sha?: string, commits?: string[] } }>} deliveryEvents
 * @returns {Set<string>}
 */
export function deliverySupersededShas(deliveryEvents) {
  const shas = new Set();
  for (const ev of deliveryEvents || []) {
    if (ev?.refs?.sha) shas.add(ev.refs.sha);
    for (const c of ev?.refs?.commits || []) {
      if (c) shas.add(c);
    }
  }
  return shas;
}

/**
 * Plan / HANDOFF milestone events (not refresh noise).
 */
export function formatPlanHandoffActivity({ now, handoff, plans }) {
  const events = [];

  // Derive agent from the plan frontmatter when available (kit agent id only).
  const activePlan = (plans || []).find((p) => now && isActivePlan(p, handoff));
  const agentFromPlan = normalizeKitAgentId(activePlan?.agent);

  if (now?.status === "executing" && now.currentTodo) {
    const planRef = now.planFile || handoff?.plan || "plan";
    const actor = briefActivityActor(agentFromPlan, { kind: "run_plan", plan: planRef });
    const fullLabel = `${actor} \u00b7 running \u00b7 ${now.currentTodo.id} \u00b7 ${planRef}`;
    events.push({
      id: activityId("run_plan", [now.planFile, now.currentTodo.id]),
      kind: "run_plan",
      at: now.modifiedAt || null,
      agent: agentFromPlan,
      label: truncateStr(fullLabel, MAX_SEMANTIC_LABEL),
      labelFull: fullLabel,
      sourcePath: now.planPath || null,
      refs: { plan: now.planFile, todo: now.currentTodo.id },
    });
  } else if (now?.status === "awaiting_user") {
    const planRef = now.planFile || handoff?.plan || "plan";
    const actor = briefActivityActor(agentFromPlan, { kind: "handoff", plan: planRef });
    const gate = now.nextTodo?.id ? `next ${now.nextTodo.id}` : "user input";
    const visible = `${actor} \u00b7 awaiting \u00b7 ${gate}`;
    const fullLabel = `${visible} \u00b7 ${planRef}`;
    events.push({
      id: activityId("handoff", [now.planFile, "awaiting"]),
      kind: "handoff",
      at: now.modifiedAt || null,
      agent: agentFromPlan,
      label: truncateStr(visible, MAX_SEMANTIC_LABEL),
      labelFull: fullLabel,
      sourcePath: ".cursor/HANDOFF.md",
      refs: { plan: now.planFile },
    });
  }

  // Denser Crew Monitor: step-by-step for orchestrator/Task to-dos on the active plan.
  if (activePlan && now && (now.status === "executing" || now.status === "awaiting_user")) {
    const planRef = now.planFile || activePlan.file || handoff?.plan || "plan";
    const todos = Array.isArray(activePlan?.todos?.items) ? activePlan.todos.items : [];
    const stepRows = [];
    for (const todo of todos) {
      if (!todo?.id) continue;
      const status = String(todo.status || "").toLowerCase();
      if (status === "completed") {
        stepRows.push({ todo, phase: "done" });
      } else if (status === "in_progress") {
        stepRows.push({ todo, phase: "running" });
      }
    }
    // Prefer the most recent completed/running steps (tail), not the earliest.
    const sliced = stepRows.slice(-MONITOR_AGENT_STEP_EMIT_CAP);
    for (const row of sliced) {
      const actor = briefActivityActor(agentFromPlan, {
        kind: "agent_step",
        plan: planRef,
      });
      const visible = `${actor} \u00b7 ${row.phase} \u00b7 ${row.todo.id}`;
      const fullLabel = `${visible} \u00b7 ${planRef}`;
      events.push({
        id: activityId("agent_step", [planRef, row.todo.id, row.phase]),
        kind: "agent_step",
        at: now.modifiedAt || null,
        agent: agentFromPlan,
        label: truncateStr(visible, MAX_SEMANTIC_LABEL),
        labelFull: fullLabel,
        sourcePath: now.planPath || activePlan.path || null,
        refs: { plan: now.planFile || activePlan.file, todo: row.todo.id, phase: row.phase },
      });
    }
  }

  // Only recent completed or still-open parked plans: avoid flooding activity.
  const completed = (plans || [])
    .filter((plan) => {
      const lifecycle = classifyPlan(plan, handoff);
      return lifecycle === "completed" || lifecycle === "parked";
    })
    .filter((plan) => todoStats(plan).total > 0)
    .sort((a, b) => String(b.modifiedAt || "").localeCompare(String(a.modifiedAt || "")))
    .slice(0, 3);

  for (const plan of completed) {
    const stats = todoStats(plan);
    const lifecycle = classifyPlan(plan, handoff);
    const stillParked = lifecycle === "parked";
    const kitAgent = normalizeKitAgentId(plan.agent);
    const planRef = plan.file || plan.id || "plan";
    const actor = briefActivityActor(kitAgent, { kind: "plan_progress", plan: planRef });
    const verb = stillParked ? "parked" : "done";
    const fullLabel = `${actor} \u00b7 ${verb} \u00b7 ${stats.completed}/${stats.total} \u00b7 ${planRef}`;
    events.push({
      id: activityId("plan_progress", [plan.file, stillParked ? "parked" : "done"]),
      kind: "plan_progress",
      at: plan.modifiedAt || null,
      agent: kitAgent,
      label: truncateStr(fullLabel, MAX_SEMANTIC_LABEL),
      labelFull: fullLabel,
      sourcePath: plan.path || null,
      refs: { plan: plan.file },
    });
  }

  return events;
}

/**
 * Task subagent transcripts are `<uuid>.jsonl` inside a parent chat's
 * `subagents/` directory.
 */
export const SUBAGENT_TRANSCRIPT_FILE_RE = /^([0-9a-fA-F][0-9a-fA-F-]{7,})\.jsonl$/;

/**
 * Worker-prompt fields the kit's own dispatch template declares (see
 * `.cursor/commands/run-plan.md`). Both forms occur in real dispatches: the
 * bare `To-do id: x` of the plain template and the `- **worker_type:** x` of a
 * bulleted orchestrator prompt, so the leading list marker and the markdown
 * emphasis on either side of the colon are optional. The captured value
 * excludes `*` and a backtick so `**explore**` and `` `explore` `` yield
 * `explore` rather than the decoration.
 */
const SUBAGENT_TODO_ID_RE =
  /^[ \t]*(?:[-*][ \t]*)?\**To-?do id\**[ \t]*[:=][ \t]*\**[ \t]*([^\s*`]+)/im;
const SUBAGENT_WORKER_TYPE_RE =
  /^[ \t]*(?:[-*][ \t]*)?\**(?:worker_type(?:[ \t]*\/[ \t]*subagent_type)?|subagent_type)\**[ \t]*[:=][ \t]*\**[ \t]*([^\s*`]+)/im;

/** Plain-text content of a transcript entry (user prompt or assistant reply). */
function subagentEntryText(entry) {
  const content = entry?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const c of content) {
    if (c && c.type === "text" && typeof c.text === "string") parts.push(c.text);
  }
  return parts.join("\n");
}

/**
 * Lifecycle of one Task subagent run, from the two records that carry it: the
 * dispatch prompt (first entry) and the terminal record (last entry).
 *
 * Phase contract: a transcript whose last record is not `turn_ended` is still
 * `running`; `turn_ended` with `status: "success"` is `done`; any other status
 * (including `error`) is `failed`. A transcript that is empty or entirely
 * unparsable yields `null` rather than a phantom running row.
 *
 * The fs half (directory layout, recency window, file/byte caps) lives in
 * `dashboard-data.mjs` next to the agent-prompt scan contract. Transcript paths
 * live under `$HOME`, never in the repo, so no `sourcePath` is emitted.
 *
 * @param {{ id?: string, parentId?: string|null, firstLine?: string, lastLine?: string, modifiedAt?: string|null }} input
 * @returns {{ id: string, parentId: string|null, phase: 'running'|'done'|'failed', todoId: string|null, workerType: string|null, modifiedAt: string|null }|null}
 */
export function parseSubagentRun({
  id,
  parentId = null,
  firstLine = "",
  lastLine = "",
  modifiedAt = null,
} = {}) {
  const runId = String(id || "").trim();
  if (!runId) return null;

  let first = null;
  let last = null;
  try {
    first = firstLine ? JSON.parse(firstLine) : null;
  } catch {
    first = null;
  }
  try {
    last = lastLine ? JSON.parse(lastLine) : null;
  } catch {
    last = null;
  }
  if (!first && !last) return null;

  let phase = "running";
  if (last && last.type === "turn_ended") {
    phase = last.status === "success" ? "done" : "failed";
  }

  const promptText = first && first.role === "user" ? subagentEntryText(first) : "";
  const todoMatch = promptText ? SUBAGENT_TODO_ID_RE.exec(promptText) : null;
  const typeMatch = promptText ? SUBAGENT_WORKER_TYPE_RE.exec(promptText) : null;
  const rawTodo = todoMatch ? todoMatch[1] : null;
  const rawType = typeMatch ? typeMatch[1] : null;
  // The template writes literal placeholders when a field is unset; those are
  // not identities and must not reach a row.
  const placeholder = /^(?:<.*>|none|n\/a|-{1,2})$/i;
  return {
    id: runId,
    parentId: parentId ? String(parentId) : null,
    phase,
    todoId: rawTodo && !placeholder.test(rawTodo) ? rawTodo : null,
    workerType: rawType && !placeholder.test(rawType) ? rawType : null,
    modifiedAt: modifiedAt || null,
  };
}

/**
 * Live Crew Monitor rows for Task subagent runs (start / still running /
 * complete / failed). Newest first; the caller passes an already-bounded list.
 *
 * Deliberately a distinct kind from `agent_step`: `agent_step` is derived from
 * plan to-do status, so a subagent that runs without flipping a to-do would be
 * invisible there and a to-do flipped by hand would be misattributed to a
 * worker. ADR: decisions/2026-07-27_crew-monitor-vs-plan-monitor-glossary.md.
 *
 * @param {object[]} runs - `parseSubagentRun` output
 * @param {{ limit?: number }} [opts]
 */
export function formatSubagentActivity(runs, { limit = MONITOR_SUBAGENT_EMIT_CAP } = {}) {
  const events = [];
  for (const run of runs || []) {
    if (events.length >= limit) break;
    if (!run || !run.id) continue;
    const kitAgent = normalizeKitAgentId(run.workerType);
    // Display actor is the dispatched worker type whenever the prompt declared
    // one: a built-in type such as `explore` is a real worker identity even
    // though it is not a `.cursor/agents/` id. `agent` stays kit-id-only so
    // downstream attribution is unchanged. `Dev` is the operator-lexicon mask
    // for Developer / Full-Stack Developer, used when no type was declared.
    const actor = run.workerType ? truncateStr(String(run.workerType), 24) : "Dev";
    const shortId = String(run.id).slice(0, 8);
    const subject = run.todoId || "task";
    const visible = `${actor} · ${run.phase} · ${subject} · ${shortId}`;
    events.push({
      id: activityId("subagent", [run.id, run.phase]),
      kind: "subagent",
      at: run.modifiedAt || null,
      agent: kitAgent,
      label: truncateStr(visible, MAX_SEMANTIC_LABEL),
      labelFull: visible,
      // Transcripts live outside the repo (under $HOME); no repo path to copy.
      sourcePath: null,
      refs: { subagent: run.id, parent: run.parentId || null, phase: run.phase, todo: run.todoId },
    });
  }
  return events;
}

/**
 * Crew Monitor pointer rows for background mid-batch plan reviews.
 *
 * The operator cannot otherwise see that a review ran: `plan-monitor-*.md` lands
 * silently in `.cursor/memory/` and only surfaces once Flight Log / attention
 * picks it up. These rows say a review exists and whether it is still owed
 * triage. They are pointers only — Flight Log and the attention inbox keep sole
 * ownership of triage state and actions, and a row never marks anything
 * reviewed. Boundary amend recorded in the glossary ADR (2026-08-05).
 *
 * @param {object[]} reports - `parseExternalReport` output
 * @param {object[]} plans - plan records from the snapshot
 * @param {{ limit?: number }} [opts]
 */
export function formatPlanReviewActivity(
  reports,
  plans,
  { limit = MONITOR_PLAN_REVIEW_EMIT_CAP } = {},
) {
  const sorted = (reports || [])
    .filter((r) => r?.file)
    .slice()
    .sort((a, b) => String(b.modifiedAt || "").localeCompare(String(a.modifiedAt || "")));

  const events = [];
  for (const report of sorted) {
    if (events.length >= limit) break;
    const triaged = isReportTriaged(report, plans);
    // `awaiting` reuses the existing gate verb: the review itself has landed,
    // what is outstanding is the operator's triage.
    const verb = triaged ? "done" : "awaiting";
    // `QA` is the operator-lexicon mask for QA Engineer.
    const planRef = report.reviewedPlanFile || `${report.slug}.plan.md`;
    const visible = `QA · ${verb} · review · ${planRef}`;
    events.push({
      id: activityId("plan_review", [report.file, triaged ? "triaged" : "open"]),
      kind: "plan_review",
      at: report.modifiedAt || null,
      agent: null,
      label: truncateStr(visible, MAX_SEMANTIC_LABEL),
      labelFull: visible,
      sourcePath: report.path || null,
      refs: { plan: report.reviewedPlanFile || null, report: report.file, triaged },
    });
  }
  return events;
}

/**
 * Explicit run-plan loop lines in terminal output. Shared detection for the
 * Crew feed (formatTerminalRunEvidence) and the busy-outside-plan derivation
 * so both surfaces agree on what counts as run-loop evidence.
 */
const TERMINAL_RUN_EVIDENCE_RE = /\/run-plan|LOOP_TICK_RESULT|Night shift:.*run-plan/i;

/**
 * Narrow execution evidence from terminal lastOutput (explicit run-plan lines only).
 */
export function formatTerminalRunEvidence(terminals, { limit = 3 } = {}) {
  const events = [];
  for (const t of terminals || []) {
    if (events.length >= limit) break;
    const out = t?.lastOutput || "";
    if (!out || !TERMINAL_RUN_EVIDENCE_RE.test(out)) {
      continue;
    }
    const line =
      out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /run-plan|LOOP_TICK_RESULT|Tick →|Tick ->/i.test(l)) || null;
    if (!line) continue;
    events.push({
      id: activityId("run_plan", ["term", t.id, line.slice(0, 40)]),
      kind: "run_plan",
      at: null,
      label: truncateStr(`system \u00b7 running \u00b7 ${line}`, MAX_SEMANTIC_LABEL),
      sourcePath: null,
      refs: { terminal: t.id },
    });
  }
  return events;
}

/** Freshness window for busy-outside-plan evidence (terminal file mtime). */
export const BUSY_OUTSIDE_PLAN_FRESH_MS = 10 * 60 * 1000;
/** Cap busy-outside-plan evidence rows (terminal ids only; not rendered as feed). */
export const MAX_BUSY_OUTSIDE_PLAN_EVIDENCE = 3;

/**
 * "Busy outside the plan" live state. True when the Current mission is not
 * executing (idle, awaiting, or completed) yet at least one terminal shows
 * fresh run-loop evidence (same detection as the Crew feed) inside the
 * freshness window. In-plan execution never raises this flag: the normal
 * executing chrome owns that state. Evidence rows are terminal ids plus the
 * observed mtime, never terminal output bodies.
 */
export function deriveBusyOutsidePlan({ now, terminals, nowMs = Date.now() } = {}) {
  const inactive = { active: false, evidence: [] };
  if (!now || now.status === "executing") return inactive;
  const evidence = [];
  for (const t of terminals || []) {
    if (evidence.length >= MAX_BUSY_OUTSIDE_PLAN_EVIDENCE) break;
    const out = t?.lastOutput || "";
    if (!out || !TERMINAL_RUN_EVIDENCE_RE.test(out)) continue;
    const ms = Date.parse(t?.updatedAt || "");
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(nowMs) || nowMs - ms > BUSY_OUTSIDE_PLAN_FRESH_MS) continue;
    evidence.push({ terminal: t.id || null, at: new Date(ms).toISOString() });
  }
  return evidence.length > 0 ? { active: true, evidence } : inactive;
}

/**
 * Merge activity streams newest-first, dedupe by id, bound length.
 */
export function mergeActivity(streams, { limit = MAX_ACTIVITY } = {}) {
  const seen = new Set();
  const out = [];
  for (const stream of streams) {
    for (const ev of stream || []) {
      if (!ev?.id || seen.has(ev.id)) continue;
      seen.add(ev.id);
      out.push({
        ...ev,
        label: truncateStr(ev.label || "", MAX_SEMANTIC_LABEL),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Normalize an inventory key. Keeps skill path segments (`core/foo`) so
 * categories do not collide; strips a trailing `.md` only.
 */
function inventoryKey(raw) {
  return String(raw || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.md$/i, "")
    .trim();
}

function inventoryLabelName(name) {
  return truncateStr(inventoryKey(name) || "item", MAX_INVENTORY_NAME);
}

/**
 * Fingerprint map for set-diff. Values are comparable strings; empty string
 * means identity-only (added/removed, never changed).
 * @param {iterable} items
 * @param {(item: object) => { id: string, fingerprint?: string }|null} project
 */
function inventoryFingerprintMap(items, project) {
  const map = new Map();
  for (const item of items || []) {
    const row = project(item);
    if (!row?.id) continue;
    const id = inventoryKey(row.id);
    if (!id || map.has(id)) continue;
    map.set(id, typeof row.fingerprint === "string" ? row.fingerprint : "");
  }
  return map;
}

function pushInventoryDelta(events, { kind, source, action, name, idParts, at = null, limit }) {
  if (events.length >= limit) return false;
  const safeName = inventoryLabelName(name);
  const verb = action === "added" ? "added" : action === "removed" ? "removed" : "changed";
  const section =
    kind === "agent"
      ? "Agent"
      : kind === "skill"
        ? "Skill"
        : kind === "command"
          ? "Command"
          : "Memory";
  const parts = Array.isArray(idParts) && idParts.length > 0 ? idParts : [action, safeName];
  events.push({
    id: activityId(kind, parts),
    kind,
    source,
    at,
    label: truncateStr(`${section} ${verb}: ${safeName}`, MAX_SEMANTIC_LABEL),
    refs: { name: safeName, action },
  });
  return true;
}

/**
 * Diff two fingerprint maps into added / removed / changed events.
 * @returns {boolean} false when the event cap is reached
 */
function diffInventoryMaps(events, { kind, source, previous, current, limit, idNamespace = "" }) {
  const ns = idNamespace ? [idNamespace] : [];
  for (const [id, fp] of current) {
    if (!previous.has(id)) {
      if (
        !pushInventoryDelta(events, {
          kind,
          source,
          action: "added",
          name: id,
          idParts: [...ns, "added", id],
          limit,
        })
      ) {
        return false;
      }
      continue;
    }
    const prevFp = previous.get(id) ?? "";
    if (fp !== prevFp) {
      if (
        !pushInventoryDelta(events, {
          kind,
          source,
          action: "changed",
          name: id,
          idParts: [...ns, "changed", id],
          limit,
        })
      ) {
        return false;
      }
    }
  }
  for (const id of previous.keys()) {
    if (current.has(id)) continue;
    if (
      !pushInventoryDelta(events, {
        kind,
        source,
        action: "removed",
        name: id,
        idParts: [...ns, "removed", id],
        limit,
      })
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Build a comparable inventory baseline from a dashboard snapshot slice.
 * Used as `previousInventory` on the next refresh (server-side dedupe keys).
 * @param {{ agents?: object[], skills?: object[], commands?: object[], memory?: object|null }} snap
 */
export function buildInventoryBaseline({
  agents = [],
  skills = [],
  commands = [],
  memory = null,
} = {}) {
  const errorEntries = Array.isArray(memory?.errorEntries)
    ? memory.errorEntries
    : Array.isArray(memory?.errorIds)
      ? memory.errorIds.map((id) => ({ id }))
      : [];
  const decisionEntries = Array.isArray(memory?.decisionEntries)
    ? memory.decisionEntries
    : Array.isArray(memory?.decisionIds)
      ? memory.decisionIds.map((id) => ({ id }))
      : Array.isArray(memory?.recentDecisions)
        ? memory.recentDecisions.map((d) => ({ id: d?.id || d }))
        : [];

  return {
    agents: (agents || [])
      .map((a) => {
        const id = inventoryKey(a?.id || a?.file);
        if (!id) return null;
        return { id, fingerprint: String(a?.description || "") };
      })
      .filter(Boolean),
    skills: (skills || [])
      .map((s) => {
        const id = inventoryKey(s?.id || s?.title);
        if (!id) return null;
        return {
          id,
          fingerprint: `${String(s?.title || "")}\0${String(s?.description || "")}`,
        };
      })
      .filter(Boolean),
    commands: (commands || [])
      .map((c) => {
        const id = inventoryKey(c?.id || c?.file);
        return id ? { id, fingerprint: "" } : null;
      })
      .filter(Boolean),
    memory: {
      errors: errorEntries
        .map((e) => {
          const id = inventoryKey(e?.id || e);
          if (!id) return null;
          const mtime =
            typeof e?.modifiedAt === "string"
              ? e.modifiedAt
              : typeof e?.mtimeMs === "number"
                ? String(e.mtimeMs)
                : "";
          return { id, fingerprint: mtime };
        })
        .filter(Boolean),
      decisions: decisionEntries
        .map((e) => {
          const id = inventoryKey(e?.id || e);
          if (!id) return null;
          const mtime =
            typeof e?.modifiedAt === "string"
              ? e.modifiedAt
              : typeof e?.mtimeMs === "number"
                ? String(e.mtimeMs)
                : "";
          return { id, fingerprint: mtime };
        })
        .filter(Boolean),
    },
  };
}

/**
 * Emit durable inventory semantic events (agents/skills/commands/memory).
 * Requires a previous baseline; cold start (null/undefined) emits nothing so
 * the first snapshot does not flood "added" for the whole tree.
 *
 * Ids: `agent:added:<name>`, `skill:removed:<name>`, `memory:error:changed:<file>`, …
 * Kinds stay off the Monitor allowlist (`MONITOR_ACTIVITY_KINDS`).
 *
 * @param {{ agents?: object[], skills?: object[], commands?: object[], memory?: object|null }} current
 * @param {object|null|undefined} previous - prior `buildInventoryBaseline` result
 * @param {{ limit?: number }} [opts]
 */
export function formatInventoryActivity(
  current,
  previous,
  { limit = MAX_INVENTORY_ACTIVITY } = {},
) {
  if (!previous || typeof previous !== "object") return [];

  const cur = buildInventoryBaseline(current || {});
  const prevAgents = inventoryFingerprintMap(previous.agents, (a) => ({
    id: a?.id,
    fingerprint: a?.fingerprint,
  }));
  const curAgents = inventoryFingerprintMap(cur.agents, (a) => ({
    id: a?.id,
    fingerprint: a?.fingerprint,
  }));
  const prevSkills = inventoryFingerprintMap(previous.skills, (a) => ({
    id: a?.id,
    fingerprint: a?.fingerprint,
  }));
  const curSkills = inventoryFingerprintMap(cur.skills, (a) => ({
    id: a?.id,
    fingerprint: a?.fingerprint,
  }));
  const prevCommands = inventoryFingerprintMap(previous.commands, (a) => ({
    id: a?.id,
    fingerprint: a?.fingerprint,
  }));
  const curCommands = inventoryFingerprintMap(cur.commands, (a) => ({
    id: a?.id,
    fingerprint: a?.fingerprint,
  }));
  const prevErrors = inventoryFingerprintMap(previous.memory?.errors, (a) => ({
    id: a?.id,
    fingerprint: a?.fingerprint,
  }));
  const curErrors = inventoryFingerprintMap(cur.memory?.errors, (a) => ({
    id: a?.id,
    fingerprint: a?.fingerprint,
  }));
  const prevDecisions = inventoryFingerprintMap(previous.memory?.decisions, (a) => ({
    id: a?.id,
    fingerprint: a?.fingerprint,
  }));
  const curDecisions = inventoryFingerprintMap(cur.memory?.decisions, (a) => ({
    id: a?.id,
    fingerprint: a?.fingerprint,
  }));

  /** @type {object[]} */
  const events = [];
  if (
    !diffInventoryMaps(events, {
      kind: "agent",
      source: "agents",
      previous: prevAgents,
      current: curAgents,
      limit,
    })
  ) {
    return events;
  }
  if (
    !diffInventoryMaps(events, {
      kind: "skill",
      source: "skills",
      previous: prevSkills,
      current: curSkills,
      limit,
    })
  ) {
    return events;
  }
  if (
    !diffInventoryMaps(events, {
      kind: "command",
      source: "commands",
      previous: prevCommands,
      current: curCommands,
      limit,
    })
  ) {
    return events;
  }
  // Memory errors + decisions share kind `memory`; namespace ids to avoid collisions.
  if (
    !diffInventoryMaps(events, {
      kind: "memory",
      source: "memory",
      previous: prevErrors,
      current: curErrors,
      limit,
      idNamespace: "error",
    })
  ) {
    return events;
  }
  diffInventoryMaps(events, {
    kind: "memory",
    source: "memory",
    previous: prevDecisions,
    current: curDecisions,
    limit,
    idNamespace: "decision",
  });
  return events;
}

/**
 * Action contract for Field Report and Checklist rows.
 *
 * The panel is read-only: it copies and a human pastes. `path` targets are
 * copied for the file picker; `copy` targets carry their own `subject` and
 * `pasteDestination`. No action type opens anything.
 * @param {'path'|'copy'} type
 */
function attentionAction(type, target, label) {
  return { type, target, label };
}

/**
 * Build the Field Report attention stack: agent prompts + readiness + External
 * reviews + optional activity cadence warning (heads-up inbox). Plan-state
 * kinds and the HANDOFF awaiting-user gate do not belong here.
 * `buildChecklistNotes` emits readiness advisories only.
 */
export function buildAttentionItems({
  plans,
  handoff,
  agentPrompts = [],
  externalReports = [],
  dismissedIds = [],
  archivedPlanFiles = [],
  readinessPending = [],
  deferredCheckIds = [],
  cadenceLedger = null,
  cadenceConfig = null,
  limit = MAX_ATTENTION + MAX_CHECKLIST_NOTES,
}) {
  const dismissed = new Set(
    (dismissedIds || []).filter((id) => typeof id === "string" && id.length > 0),
  );
  const items = [];
  const cadenceOpts = parseFieldReportReviewCadenceConfig(
    cadenceConfig ? { fieldReportReviewCadence: cadenceConfig } : null,
  );

  // Agent prompts lead the payload; the panel reorders by severity / report group.
  for (const prompt of buildAgentPromptItems(agentPrompts, { plans, handoff })) {
    if (dismissed.has(prompt.id)) continue;
    if (items.length >= limit) break;
    items.push(prompt);
  }

  for (const note of buildChecklistNotes({
    plans,
    handoff,
    readinessPending,
    deferredCheckIds,
    limit: MAX_CHECKLIST_NOTES,
  })) {
    if (dismissed.has(note.id)) continue;
    if (items.length >= limit) break;
    items.push(note);
  }

  const unreviewed = listUnreviewedReviewTargets(
    plans,
    handoff,
    externalReports,
    archivedPlanFiles,
  );
  const cadenceItem = buildCadenceAttentionItem(cadenceLedger, unreviewed, {
    enabled: cadenceOpts.enabled,
    dismissed,
  });
  if (cadenceItem && items.length < limit) {
    items.push(cadenceItem);
  }

  // Strong triage clears a report; terminal reviewed-plan lifecycle classifies
  // it into the review-debt group (still shown). Dismissals then filter by id.
  for (const report of buildExternalReportItems(externalReports, plans, {
    handoff,
    archivedPlanFiles,
  })) {
    if (dismissed.has(report.id)) continue;
    if (items.length >= limit) break;
    items.push(report);
  }

  return items.slice(0, limit);
}

/**
 * Emit readiness advisories for the Field Report attention stack. Plan-state
 * NOTE kinds (backlog / parked / incomplete) stay on Checklist plan cards and
 * must not emit here. `plans` / `handoff` remain in the signature for callers
 * that still pass them; they are unused for note emission.
 */
export function buildChecklistNotes({
  plans: _plans,
  handoff: _handoff,
  readinessPending = [],
  deferredCheckIds = [],
  limit = MAX_CHECKLIST_NOTES,
}) {
  const items = [];
  const deferredIds = deferredCheckIdSet(deferredCheckIds);
  for (const pending of readinessPending || []) {
    if (items.length >= limit) break;
    if (!pending || pending.essential === true) continue;
    if (pending.status === "ready") continue;
    if (isDeferredReadinessPending(pending, deferredIds)) continue;
    const id = pending.id || pending.checkId || "readiness";
    items.push({
      id: `attention:readiness:${id}`,
      kind: "readiness",
      severity: "info",
      label: truncateStr(
        pending.label ||
          pending.title ||
          `Non-essential readiness: ${id} (${pending.status || "pending"})`,
        MAX_SEMANTIC_LABEL,
      ),
      sourcePath: ".cursor/context/readiness.json",
      modifiedAt: null,
      progress: null,
      action: {
        type: "copy",
        target: "/agent-kit-onboard",
        label: "Copy /agent-kit-onboard (non-essential)",
        subject: "/agent-kit-onboard",
        pasteDestination: "chatInput",
      },
    });
  }

  return items.slice(0, limit);
}

/**
 * Enrich plan records with lifecycle classification (non-mutating copy).
 */
export function enrichPlans(plans, handoff) {
  const runQueueView = buildRunQueueView(handoff);
  return (plans || []).map((plan) => {
    const stats = todoStats(plan);
    const parked = isParkedPlan(plan, handoff);
    const backlog = isBacklogPlan(plan, handoff);
    const queueIdx = runQueueView ? runQueueView.queue.indexOf(planFileKey(plan)) : -1;
    return {
      id: plan.id,
      file: plan.file,
      path: plan.path,
      overview: truncateStr(plan.overview || "", MAX_SEMANTIC_LABEL),
      modifiedAt: plan.modifiedAt || null,
      progress: {
        completed: stats.completed,
        total: stats.total,
        label: `${stats.completed} of ${stats.total}`,
      },
      lifecycle: classifyPlan(plan, handoff),
      // Preserved when lifecycle is completed so UI/sort can still know provenance.
      parked,
      backlog,
      // /run-plan-all layer: role + queue position (null outside queue mode).
      // Additive to lifecycle; the executing shimmer keys on lifecycle only.
      queueRole: planQueueRole(plan, runQueueView),
      queueIndex: queueIdx >= 0 ? queueIdx : null,
      currentTodo: compactTodo(pickCurrentTodo(plan, handoff)),
      nextTodo: compactTodo(pickNextTodo(plan, pickCurrentTodo(plan, handoff))),
    };
  });
}

/**
 * Allowlisted readiness pending actions for attention (no nested scan dump).
 * Preserves `checkId` so Checklist can match `onboarding.deferredItems.checkId`
 * (pillar check id, e.g. collaboration.provider) against action ids (confirm-provider).
 */
export function allowlistReadinessPending(rawPending) {
  if (!Array.isArray(rawPending)) return [];
  return rawPending.slice(0, MAX_ATTENTION).map((item) => {
    const out = {
      id: typeof item?.id === "string" ? item.id : "unknown",
      status: typeof item?.status === "string" ? item.status : "unknown",
      essential: item?.essential === true,
    };
    if (typeof item?.checkId === "string" && item.checkId) {
      out.checkId = item.checkId;
    }
    const title =
      typeof item?.title === "string"
        ? truncateStr(item.title, 120)
        : typeof item?.label === "string"
          ? truncateStr(item.label, 120)
          : undefined;
    if (title !== undefined) out.title = title;
    return out;
  });
}

/**
 * Derive Checklist readiness rows from a doctor report.
 * Prefers pillars so each action carries `checkId` + `essential` (pendingActions alone lack both).
 * Falls back to `pendingActions` when pillars are absent.
 * @param {unknown} readiness
 * @returns {{ id: string, checkId?: string, status: string, essential: boolean, title?: string }[]}
 */
export function collectReadinessPendingFromReport(readiness) {
  if (!readiness || typeof readiness !== "object") return [];
  const fromPillars = [];
  for (const pillar of readiness.pillars || []) {
    if (!pillar || typeof pillar !== "object") continue;
    for (const check of pillar.checks || []) {
      if (!check || typeof check !== "object") continue;
      if (check.status === "ready") continue;
      const actions = Array.isArray(check.actions) ? check.actions : [];
      for (const action of actions) {
        if (!action || typeof action !== "object") continue;
        if (action.status === "ready") continue;
        fromPillars.push({
          id: typeof action.id === "string" ? action.id : "unknown",
          checkId: typeof check.id === "string" ? check.id : undefined,
          status:
            typeof action.status === "string"
              ? action.status
              : typeof check.status === "string"
                ? check.status
                : "unknown",
          essential: check.essential === true,
          title: typeof check.title === "string" ? check.title : undefined,
        });
      }
    }
  }
  if (fromPillars.length > 0) return fromPillars;
  if (!Array.isArray(readiness.pendingActions)) return [];
  return readiness.pendingActions.map((item) => ({
    id: typeof item?.id === "string" ? item.id : "unknown",
    checkId: typeof item?.checkId === "string" ? item.checkId : undefined,
    status: typeof item?.status === "string" ? item.status : "unknown",
    essential: item?.essential === true,
    title:
      typeof item?.title === "string"
        ? item.title
        : typeof item?.recommendation === "string"
          ? item.recommendation
          : undefined,
  }));
}

/**
 * Extract deferred check ids from config onboarding.deferredItems.
 * Requires a non-empty reason (same rule as doctor onboarding reconcile).
 * @param {unknown} rawConfig
 * @returns {string[]}
 */
export function collectDeferredCheckIds(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object") return [];
  const onboarding = rawConfig.onboarding;
  if (!onboarding || typeof onboarding !== "object") return [];
  if (!Array.isArray(onboarding.deferredItems)) return [];
  const ids = [];
  for (const item of onboarding.deferredItems) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.checkId !== "string" || !item.checkId.trim()) continue;
    if (typeof item.reason !== "string" || !item.reason.trim()) continue;
    ids.push(item.checkId.trim());
  }
  return ids;
}

/** @param {unknown} deferredCheckIds */
function deferredCheckIdSet(deferredCheckIds) {
  const set = new Set();
  if (!Array.isArray(deferredCheckIds)) return set;
  for (const id of deferredCheckIds) {
    if (typeof id === "string" && id.trim()) set.add(id.trim());
  }
  return set;
}

/**
 * True when a pending readiness row is explicitly deferred.
 * Matches deferredItems.checkId against action id or pillar checkId
 * (confirm-provider ↔ collaboration.provider).
 * @param {{ id?: string, checkId?: string }} pending
 * @param {Set<string>} deferredIds
 */
export function isDeferredReadinessPending(pending, deferredIds) {
  if (!pending || !(deferredIds instanceof Set) || deferredIds.size === 0) return false;
  if (typeof pending.id === "string" && deferredIds.has(pending.id)) return true;
  if (typeof pending.checkId === "string" && deferredIds.has(pending.checkId)) return true;
  return false;
}

/**
 * Agent-prompt detection contract (pure half).
 *
 * A transcript is one JSON object per line. Conversation entries carry a
 * `role` of `user` or `assistant`; a trailing turn marker object has no
 * `role` and is ignored. An assistant entry counts as a QUESTION when its
 * `message.content` holds a `tool_use` whose `name` matches
 * `AGENT_QUESTION_TOOL_RE` (the AskQuestion family). An ANSWER is any later
 * entry with `role === 'user'`. A transcript is "awaiting a reply" only when it
 * contains at least one question and no user entry follows the last one. The
 * assistant speaking last carries no signal (almost every transcript ends on an
 * assistant entry) and is deliberately not used. The fs half (directory
 * location, file cap, recency window) lives in `dashboard-data.mjs`.
 */
export function isAgentQuestionEntry(entry) {
  if (!entry || entry.role !== "assistant") return false;
  const content = entry.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (c) => c && c.type === "tool_use" && AGENT_QUESTION_TOOL_RE.test(String(c.name || "")),
  );
}

export function isUserEntry(entry) {
  return !!entry && entry.role === "user";
}

/**
 * Collapse whitespace in derived Field Report labels.
 *
 * AskQuestion prompts often carry blank lines and markdown breaks. Those must
 * not reach the panel as multi-line labels (they truncate mid-paragraph and
 * break the single-line attention row).
 */
export function collapseAttentionLabel(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Turn raw first-user transcript text into a short chat identifier.
 * Prefers `<user_query>` body; otherwise strips Cursor wrapper blocks and
 * falls back to a slash-command name when the message is command-only.
 */
export function normalizeUserTextToSnippet(text) {
  let t = String(text || "");
  const query = t.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (query) {
    t = query[1];
  } else {
    const cmdMatch = t.match(/---\s*Cursor Command:\s*([^\n]+?)\s*---/i);
    const commandName = cmdMatch ? collapseAttentionLabel(cmdMatch[1]) : "";
    t = t
      .replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, " ")
      .replace(/<cursor_commands>[\s\S]*?<\/cursor_commands>/gi, " ")
      .replace(/<external_links>[\s\S]*?<\/external_links>/gi, " ")
      .replace(/<\/?[a-z_:-]+>/gi, " ");
    t = collapseAttentionLabel(t);
    if (!t && commandName) {
      const slash = commandName.startsWith("/") ? commandName : `/${commandName}`;
      return truncateStr(slash, MAX_CHAT_SNIPPET);
    }
  }
  t = collapseAttentionLabel(t);
  if (!t) return null;
  return truncateStr(t, MAX_CHAT_SNIPPET);
}

/**
 * First identifying snippet from a transcript (earliest usable user text).
 * @param {object[]} entries
 * @returns {string|null}
 */
export function extractChatSnippet(entries) {
  if (!Array.isArray(entries)) return null;
  for (const e of entries) {
    if (!isUserEntry(e)) continue;
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (!c || c.type !== "text" || typeof c.text !== "string") continue;
      const snippet = normalizeUserTextToSnippet(c.text);
      if (snippet) return snippet;
    }
  }
  return null;
}

/**
 * Clipboard payload for the past-chat picker: bare chat id only.
 * Identifying context (snippet, question, time) stays on the Field Report row
 * and in the copy subject/guidance so a paste into the picker stays reliable.
 */
export function formatChatReferencePayload(chatId) {
  if (typeof chatId !== "string") return "";
  return chatId.trim();
}

/** Toast/tooltip subject that names which chat id was copied. */
export function formatChatReferenceSubject(chatId, chatSnippet) {
  const id = typeof chatId === "string" ? chatId.trim() : "";
  const short = id ? id.slice(0, 8) : "";
  const snip = collapseAttentionLabel(chatSnippet);
  if (short && snip) {
    return `chat id ${short} (${truncateStr(snip, 48)})`;
  }
  if (short) return `chat id ${short}`;
  return "chat id";
}

/**
 * Untruncated collapsed question text from the question tool_use itself.
 * This is the detection value: lifecycle clear parses plan refs from it before
 * any display truncation, so a terminal ref before the 200-char cutoff cannot
 * clear a row whose active ref sits past the cutoff (FR-SAC-01).
 */
export function extractQuestionText(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (!c || c.type !== "tool_use" || !AGENT_QUESTION_TOOL_RE.test(String(c.name || ""))) {
      continue;
    }
    const questions = c.input?.questions;
    if (Array.isArray(questions)) {
      for (const q of questions) {
        const prompt = collapseAttentionLabel(q?.prompt || q?.question || q?.text);
        if (prompt) return prompt;
      }
    }
    const single = collapseAttentionLabel(c.input?.prompt || c.input?.question);
    if (single) return single;
  }
  return null;
}

/** Human-readable label for display; truncated to the panel label bound. */
export function extractQuestionLabel(entry) {
  const text = extractQuestionText(entry);
  return text ? truncateStr(text, MAX_SEMANTIC_LABEL) : null;
}

/**
 * Scan parsed transcript entries for an unanswered agent question.
 * @param {object[]} entries - parsed JSONL objects, in file order
 * @returns {{ label: string|null }|null} match when awaiting a reply, else null
 */
export function detectAwaitingPrompt(entries) {
  if (!Array.isArray(entries)) return null;
  let lastQuestionIdx = -1;
  let lastUserIdx = -1;
  let lastQuestionEntry = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== "object") continue;
    if (isUserEntry(e)) lastUserIdx = i;
    if (isAgentQuestionEntry(e)) {
      lastQuestionIdx = i;
      lastQuestionEntry = e;
    }
  }
  if (lastQuestionIdx < 0) return null;
  if (lastUserIdx > lastQuestionIdx) return null;
  const labelFull = extractQuestionText(lastQuestionEntry);
  return {
    label: labelFull ? truncateStr(labelFull, MAX_SEMANTIC_LABEL) : null,
    // Untruncated detection value for lifecycle clear (FR-SAC-01).
    labelFull,
  };
}

/**
 * Map detected prompts into attention-item shape. Each item copies the bare
 * chat id for the past-chat picker; it does not open a chat. Row fields carry
 * snippet, timestamp, and pending question so the human can identify the chat.
 * Drops prompts whose pending label names only terminal plans (lifecycle clear).
 * @param {{chatId:string,label?:string,chatSnippet?:string,quietAt?:string}[]} prompts
 */
export function buildAgentPromptItems(
  prompts,
  { limit = MAX_AGENT_PROMPTS, plans = [], handoff = null } = {},
) {
  const items = [];
  for (const p of prompts || []) {
    if (items.length >= limit) break;
    if (!p || !p.chatId) continue;
    const label = collapseAttentionLabel(p.label) || "Agent question awaiting a reply";
    // Parse plan refs from the untruncated text so a ref past the display cutoff
    // still counts toward the all-references-terminal rule (FR-SAC-01).
    const lifecycleText = collapseAttentionLabel(p.labelFull) || label;
    if (isPromptClearedByPlanLifecycle(lifecycleText, plans, handoff)) continue;
    const rawSnippet = collapseAttentionLabel(p.chatSnippet);
    const snippet = rawSnippet ? truncateStr(rawSnippet, MAX_CHAT_SNIPPET) : null;
    const payload = formatChatReferencePayload(p.chatId);
    if (!payload) continue;
    items.push(
      withResolveAction({
        id: `attention:prompt:${p.chatId}`,
        kind: "prompt",
        severity: "action",
        label: truncateStr(label, MAX_SEMANTIC_LABEL),
        chatSnippet: snippet,
        sourcePath: null,
        chatId: p.chatId,
        modifiedAt: p.quietAt || null,
        progress: null,
        action: {
          type: "copy",
          target: payload,
          label: "Copy chat id",
          subject: formatChatReferenceSubject(p.chatId, snippet),
          pasteDestination: "pastChatPicker",
        },
      }),
    );
  }
  return items;
}

/** Compare slugs across the `-` / `_` split between report and plan names. */
function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.plan\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Empty-state string for a report that carries no structured findings section.
 * The row still renders; extraction is best-effort against the plan-monitor
 * template (2026-07-25_mission-control-field-report-source-contract.md,
 * "Findings summary extraction").
 */
export const FINDINGS_SUMMARY_EMPTY = "No structured findings extracted";

/** Char cap for the derived findings summary before an ellipsis truncation. */
export const MAX_FINDINGS_SUMMARY = 240;

/** Residual/standing/full-review items taken into the summary, at most. */
const MAX_FINDINGS_BULLETS = 3;

// Heading prefix matchers. Real monitors append parentheticals (for example
// `### Residual items for human attention (none are severe; ...)`) and
// pluralize the standing heading (`## Standing findings — not owned ...`), so
// match on the leading text only. Tested per line, no global/multiline state.
const RESIDUAL_HEADING_RE = /^#{2,6}\s+Residual items for human attention/i;
const STANDING_HEADING_RE = /^#{2,6}\s+Standing finding/i;
const FULL_REVIEW_HEADING_RE = /^#{2,6}\s+Full review/i;
const ANY_HEADING_RE = /^#{2,6}\s/;
const HR_RE = /^-{3,}\s*$/;

/** Strip inline markdown emphasis and collapse whitespace for display. */
function cleanFindingsInline(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Body lines under the first heading matching `headingRe`, until the next
 *  heading or horizontal rule. Null when the heading is absent. */
function findingsSectionLines(text, headingRe) {
  const lines = String(text || "").split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const body = [];
  for (let i = start; i < lines.length; i++) {
    if (ANY_HEADING_RE.test(lines[i]) || HR_RE.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body;
}

/** First blank-line-delimited paragraph in a section body, cleaned. */
function findingsFirstParagraph(body) {
  const para = [];
  for (const raw of body || []) {
    if (raw.trim() === "") {
      if (para.length) break;
      continue;
    }
    para.push(raw.trim());
  }
  return para.length ? cleanFindingsInline(para.join(" ")) : null;
}

/** Up to `MAX_FINDINGS_BULLETS` numbered residual items, cleaned. */
function findingsResidualItems(text) {
  const body = findingsSectionLines(text, RESIDUAL_HEADING_RE);
  if (!body) return null;
  const items = [];
  for (const raw of body) {
    const match = /^\s*\d+\.\s+(.*\S)\s*$/.exec(raw);
    if (!match) continue;
    const cleaned = cleanFindingsInline(match[1]);
    if (cleaned) items.push(cleaned);
    if (items.length >= MAX_FINDINGS_BULLETS) break;
  }
  return items.length ? items : null;
}

/** Outcome line (or first paragraph) under the Full review heading. */
function findingsOutcome(text) {
  const body = findingsSectionLines(text, FULL_REVIEW_HEADING_RE);
  if (!body) return null;
  for (const raw of body) {
    const line = cleanFindingsInline(raw);
    const match = /^Outcome:?\s*(.+)$/i.exec(line);
    if (match?.[1]) return match[1];
  }
  return findingsFirstParagraph(body);
}

/**
 * Derive a short, human-readable findings summary from monitor markdown.
 * Order: numbered Residual items, else the Standing finding paragraph, else
 * the Full-review Outcome, else the stable empty fallback. Always returns a
 * string; never null. The result is plain text and MUST be HTML-escaped by the
 * renderer, since it comes from untrusted report markdown.
 * @param {string} content - raw report markdown
 */
export function extractFindingsSummary(content) {
  const text = typeof content === "string" ? content : "";
  const residual = findingsResidualItems(text);
  let summary = null;
  if (residual) {
    summary = residual.join(" • ");
  } else {
    const standingBody = findingsSectionLines(text, STANDING_HEADING_RE);
    summary = findingsFirstParagraph(standingBody) || findingsOutcome(text);
  }
  if (!summary) return FINDINGS_SUMMARY_EMPTY;
  return truncateStr(summary, MAX_FINDINGS_SUMMARY);
}

const STILL_OPEN_HEADING_RE = /^#{2,6}\s+Still open/i;
const NONE_ONLY_RE = /^(none\.?|—|-|n\/a|no\s+open\s+items?\.?)$/i;

/**
 * Whether monitor markdown still has open review gaps for Review-all targeting.
 * True when numbered Residual items, non-empty Still open rows, or a substantive
 * Standing finding exist. False for empty Still open / no residuals (clean
 * Outcome). Prefer include when structure is ambiguous (no Still open section
 * and no clear empty signal).
 * @param {string} content
 */
export function reportHasOpenReviewGaps(content) {
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) return true;

  const residuals = findingsResidualItems(text);
  if (residuals && residuals.length > 0) return true;

  const standingBody = findingsSectionLines(text, STANDING_HEADING_RE);
  const standing = findingsFirstParagraph(standingBody);
  if (standing && !NONE_ONLY_RE.test(standing) && !/^no standing/i.test(standing)) {
    return true;
  }

  const stillOpen = findingsSectionLines(text, STILL_OPEN_HEADING_RE);
  if (stillOpen) {
    const lines = stillOpen.map((l) => l.trim()).filter(Boolean);
    let hasDataRow = false;
    let sawNone = false;
    for (const line of lines) {
      if (/^\|\s*-+/.test(line)) continue;
      if (/^\|\s*ID\s*\|/i.test(line)) continue;
      if (NONE_ONLY_RE.test(line)) {
        sawNone = true;
        continue;
      }
      if (/^\|/.test(line)) {
        const cells = line
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);
        if (cells.length === 0) continue;
        if (cells.every((c) => NONE_ONLY_RE.test(c) || c === "")) {
          sawNone = true;
          continue;
        }
        hasDataRow = true;
        break;
      }
      // Non-table body (e.g. "None.")
      if (!NONE_ONLY_RE.test(line)) {
        hasDataRow = true;
        break;
      }
      sawNone = true;
    }
    if (hasDataRow) return true;
    if (sawNone || lines.length === 0) return false;
  }

  // No Still open section: Outcome-only / empty structure → no gap for bulk Review all.
  return false;
}

/**
 * Parse one external review report into the fields the triage rule needs.
 * @param {{file:string,content:string,modifiedAt?:string}} input
 */
export function parseExternalReport({ file, content, modifiedAt = null } = {}) {
  const match = EXTERNAL_REPORT_FILE_RE.exec(String(file || ""));
  if (!match) return null;
  const text = typeof content === "string" ? content : "";
  const reviewed = text.match(REPORT_REVIEWED_PLAN_RE);
  return {
    file,
    path: `.cursor/memory/${file}`,
    slug: match[1],
    reviewedPlanFile: reviewed ? reviewed[1].trim() : null,
    triageNoteInReport: TRIAGE_HEADING_RE.test(text),
    findingsSummary: extractFindingsSummary(text),
    hasOpenReviewGaps: reportHasOpenReviewGaps(text),
    modifiedAt,
  };
}

/**
 * "Not yet a plan" contract (pure half), derived from the local reports rather
 * than assumed. A report at `.cursor/memory/plan-monitor-<slug>.md` counts as
 * ALREADY TRIAGED when either signal holds:
 *
 *   1. The report carries a triage heading (`TRIAGE_HEADING_RE`). Both triaged
 *      reports in this repository do: one records `## Triage note` for an
 *      "ack and stop" outcome that produced no plan, the other records
 *      `## Follow-up plan`.
 *   2. A plan other than the reviewed plan names the report slug or the
 *      reviewed plan in its own id or overview. The reviewed plan is read from
 *      the report's `**Plan:**` header, so a hash-suffixed plan file is
 *      excluded as itself rather than mistaken for its own follow-up.
 *
 * Neither signal alone is enough historically: a residuals plan may land
 * without editing the report. `/plan-review-triage` now requires a durable
 * triage heading for every outcome (including Ack and stop) so the heading
 * path clears Field Report without relying on HANDOFF alone. A report with
 * neither signal is surfaced as awaiting triage. The fs half (directory, file
 * cap, size cap, recency window) lives in `dashboard-data.mjs`, next to the
 * prompt-scan contract.
 */
export function isReportTriaged(report, plans) {
  if (!report) return false;
  if (report.triageNoteInReport) return true;

  const slug = normalizeSlug(report.slug);
  const reviewed = normalizeSlug(report.reviewedPlanFile);
  if (!slug && !reviewed) return false;

  return (plans || []).some((plan) => {
    if (!plan) return false;
    const planFile = String(plan.file || "");
    if (report.reviewedPlanFile && planFile === report.reviewedPlanFile) return false;
    const planSlug = normalizeSlug(plan.id || planFile);
    if (planSlug === slug || (reviewed && planSlug === reviewed)) return false;
    const haystack = normalizeSlug(`${plan.id || ""} ${plan.overview || ""}`);
    if (!haystack) return false;
    return (!!slug && haystack.includes(slug)) || (!!reviewed && haystack.includes(reviewed));
  });
}

/** Ascending-sort key for a report timestamp; missing/unparsable sort last. */
function reportSortMs(modifiedAt) {
  if (typeof modifiedAt !== "string" || !modifiedAt.trim()) return Number.POSITIVE_INFINITY;
  const t = Date.parse(modifiedAt);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Shape one untriaged report into an attention item carrying its group. */
function shapeExternalReportItem(report, group) {
  const reviewed = report.reviewedPlanFile
    ? report.reviewedPlanFile.replace(/\.plan\.md$/, "")
    : report.slug;
  return withResolveAction({
    id: `attention:report:${report.slug}`,
    kind: "report",
    // Blocking rows gate a live or queued plan; debt rows are owed triage but
    // no longer gate execution. Phase 3 renders the group without re-deriving
    // lifecycle (2026-07-26_mission-control-field-report-review-debt-inbox).
    group,
    severity: "action",
    label: truncateStr(`${reviewed} awaiting triage`, MAX_SEMANTIC_LABEL),
    // Plain text derived from untrusted report markdown; escapeHtml at render.
    findingsSummary: report.findingsSummary || FINDINGS_SUMMARY_EMPTY,
    hasOpenReviewGaps: report.hasOpenReviewGaps !== false,
    sourcePath: report.path,
    modifiedAt: report.modifiedAt || null,
    progress: null,
    pathAction: attentionAction("path", report.path, "Copy path"),
    action: {
      type: "copy",
      target: `/plan-review-triage ${report.path}`,
      label: "Copy triage command",
      subject: "triage command",
      pasteDestination: "chatInput",
      command: `/plan-review-triage ${report.path}`,
      sourcePath: report.path,
    },
  });
}

/**
 * Map untriaged reports into attention items, classified by reviewed-plan
 * lifecycle rather than filtered by it. Each row copies the report path and
 * `/plan-review-triage <path>` for a fresh chat; it does not run triage.
 *
 * Hard hides (row removed): strong triage (`isReportTriaged`) and, upstream,
 * ID-only dismissals. Lifecycle no longer removes a row: a terminal reviewed
 * plan (completed, parked, archived) sets `group: "debt"`; a live, queued, or
 * unknown-not-archived plan sets `group: "blocking"`. Blocking keeps the
 * incoming freshness order; debt is ordered oldest first. The surfaced total is
 * capped at `limit`, blocking before debt.
 * @param {object[]} reports - parsed reports (see `parseExternalReport`)
 * @param {object[]} plans - plan records from the snapshot
 */
export function buildExternalReportItems(
  reports,
  plans,
  { limit = MAX_EXTERNAL_REPORTS, handoff = null, archivedPlanFiles = [] } = {},
) {
  const blocking = [];
  const debt = [];
  for (const report of reports || []) {
    if (!report || !report.file) continue;
    if (isReportTriaged(report, plans)) continue;
    const demoted = isReportDemotedByPlanLifecycle(report, plans, handoff, archivedPlanFiles);
    if (demoted) {
      debt.push(shapeExternalReportItem(report, "debt"));
    } else {
      blocking.push(shapeExternalReportItem(report, "blocking"));
    }
  }
  // Within debt: oldest first. Blocking keeps the scan (freshness) order.
  debt.sort((a, b) => reportSortMs(a.modifiedAt) - reportSortMs(b.modifiedAt));
  return [...blocking, ...debt].slice(0, limit);
}

/**
 * Assemble the Mission Control view model attached to the dashboard snapshot.
 */
export function buildMissionControlView({
  plans = [],
  handoff = null,
  gitLogLines = [],
  terminals = [],
  readinessPending = [],
  deferredCheckIds = [],
  agentPrompts = [],
  externalReports = [],
  subagentRuns = [],
  dismissedIds = [],
  archivedPlanFiles = [],
  agents = [],
  skills = [],
  commands = [],
  memory = null,
  previousInventory = null,
  timingLedger = null,
  flightLogLedger = null,
  cadenceLedger = null,
  cadenceConfig = null,
  nowMs = Date.now(),
} = {}) {
  const nowBase = buildCurrentExecution(plans, handoff);
  const activeForTiming = (plans || []).find((p) => isActivePlan(p, handoff)) || null;
  const { ledger: nextTimingLedger, timing } = observeMissionTiming(
    parseMissionTimingLedger(timingLedger),
    nowBase,
    { nowMs, todoItems: activeForTiming?.todos?.items || [] },
  );
  const now = withMissionTiming(nowBase, timing);
  // Live "busy outside the plan" flag: fresh run-loop terminal evidence while
  // the mission is not executing. Attached to the now slice so the existing
  // now fingerprint drives SSE re-render on change.
  now.busyOutsidePlan = deriveBusyOutsidePlan({ now, terminals, nowMs });
  const { ledger: nextFlightLogLedger, flightLog } = observeFlightLog(
    parseFlightLogLedger(flightLogLedger),
    now.gaps,
    {
      nowMs,
      sourcePath: ".cursor/HANDOFF.md",
      flightKey: buildFlightLogFlightKey(handoff),
    },
  );
  flightLog.warnings = buildFlightLogWarnings(handoff);
  const classifiedPlans = enrichPlans(plans, handoff);
  const planEvents = formatPlanHandoffActivity({ now, handoff, plans });
  const inventoryEvents = formatInventoryActivity(
    { agents, skills, commands, memory },
    previousInventory,
  );
  // Per-event delivery attribution from each merge branch (never the active plan).
  // Delivery precedes raw git so merge/delivery rows are not starved by MAX_ACTIVITY;
  // superseded merge + absorbed commit SHAs are excluded from the git stream so
  // each merge appears once (as delivery) on the unified Activity stream.
  const deliveryEvents = formatDeliveryActivity(gitLogLines, {
    plans,
    limit: MAX_GIT_ACTIVITY,
  });
  const supersededShas = deliverySupersededShas(deliveryEvents);
  const activity = mergeActivity([
    planEvents.filter((e) => e.kind === "run_plan" || e.kind === "handoff"),
    planEvents.filter((e) => e.kind === "agent_step"),
    // Live Task-worker lifecycle before delivery: a running subagent is the
    // freshest thing on the board and must not be starved by MAX_ACTIVITY.
    formatSubagentActivity(subagentRuns),
    deliveryEvents,
    formatPlanReviewActivity(externalReports, plans),
    planEvents.filter((e) => e.kind === "plan_progress"),
    formatGitActivity(gitLogLines, { excludeShas: supersededShas }),
    formatTerminalRunEvidence(terminals),
    inventoryEvents,
  ]);
  // Field Report attention inbox left the Flight Log card; builders stay
  // exported for /field-report-resolve + cadence scripts (ADR keep).
  // Quiet Gaps+Warnings: bounded report rows may surface on Flight Log.
  // Build quiet lane from external reports directly (not capped attention) so
  // prompt/readiness pressure cannot starve Reviews awaiting triage to All clear.
  const dismissedForQuiet = new Set(
    (dismissedIds || []).filter((id) => typeof id === "string" && id.length > 0),
  );
  const quietReportItems = buildExternalReportItems(externalReports, plans, {
    handoff,
    archivedPlanFiles,
  }).filter((item) => item && !dismissedForQuiet.has(item.id));
  const attention = buildAttentionItems({
    plans,
    handoff,
    agentPrompts,
    externalReports,
    dismissedIds,
    archivedPlanFiles,
    readinessPending: allowlistReadinessPending(readinessPending),
    deferredCheckIds,
    cadenceLedger,
    cadenceConfig,
  });
  flightLog.quietOpenTriages = listFlightLogQuietOpenTriages(quietReportItems);
  // Deprecated: attention owns Field Report rows. Kept empty so older panel
  // code that still reads the field does not double-render.
  const checklistNotes = [];

  return {
    schemaVersion: "1.0.0",
    now,
    activity,
    attention,
    flightLog,
    checklistNotes,
    plans: classifiedPlans,
    // Crew Monitor hero display cap (SoT for dashboard.html; no HTML literal).
    monitorFeedCap: MONITOR_FEED_CAP,
    // Quiet open-triage fallback cap for dashboard.html attention mirror.
    flightLogQuietOpenTriagesCap: FLIGHT_LOG_QUIET_OPEN_TRIAGES_CAP,
    // /run-plan-all queue slice (null outside queue mode). Copy-only data:
    // display order and roles; the panel never writes the queue back.
    runQueue: buildRunQueueView(handoff),
    // Next ledger after this observation (dashboard-data persists write-on-change).
    timingLedger: nextTimingLedger,
    flightLogLedger: nextFlightLogLedger,
  };
}

/** Cap for the generated per-process narration line. */
export const MAX_PROCESS_DESCRIPTION = 160;

const PROCESS_PORT_RE = /(?:--port[=\s]|PORT=|:)(\d{4,5})\b/;
const PROCESS_GIT_SUB_RE = /\bgit\s+([a-z][a-z-]*)/i;
const PROCESS_NODE_SCRIPT_RE = /(?:^|\s)(?:\S*\/)*([\w.-]+\.(?:mjs|cjs|js|ts))(?:\s|$)/;
const PROCESS_PKG_RUN_RE = /^(npm|pnpm|yarn|bun|npx)\s+([\w:.-]+)/;

const PROCESS_GIT_ACTIONS = Object.freeze({
  add: "Staging changes",
  checkout: "Switching branches",
  clone: "Cloning a repository",
  commit: "Recording a commit",
  diff: "Comparing changes",
  fetch: "Fetching updates from the remote",
  log: "Reading the commit history",
  merge: "Merging branches",
  pull: "Pulling updates from the remote",
  push: "Pushing commits to the remote",
  rebase: "Rebasing commits",
  status: "Checking the working tree status",
  switch: "Switching branches",
});

function describeProcessBase(label, command) {
  if (label === "dashboard-server" || /serve\.mjs|node dashboard/.test(command)) {
    const port = command.match(PROCESS_PORT_RE);
    return port
      ? `Serving the Mission Control dashboard on port ${port[1]}`
      : "Serving the Mission Control dashboard";
  }
  const gitSub = command.match(PROCESS_GIT_SUB_RE);
  if (label === "git" || gitSub) {
    const sub = gitSub ? gitSub[1].toLowerCase() : null;
    if (sub && PROCESS_GIT_ACTIONS[sub]) return PROCESS_GIT_ACTIONS[sub];
    if (sub) return `Running git ${sub}`;
    return "Running a git operation";
  }
  if (label === "node" || /\bnode\b/.test(command)) {
    const script = command.match(PROCESS_NODE_SCRIPT_RE);
    if (script) return `Running the ${script[1]} Node script`;
    return "Running a Node.js process";
  }
  const pkgRun = command.match(PROCESS_PKG_RUN_RE);
  if (pkgRun) return `Running ${pkgRun[1]} ${pkgRun[2]}`;
  const bin = (command.split(/\s+/)[0] || "").split("/").pop();
  if (bin) return `Running ${bin}`;
  return "Running an unrecognized process";
}

/**
 * Deterministic per-process narration for the Processes tab ("what is it
 * doing right now"). Pure heuristics over the ps snapshot fields (label,
 * command, cpu, etime); no external calls. One short sentence.
 *
 * Design choice (accepted): heuristics replace LLM narration for the local
 * dashboard (no latency, no API cost, deterministic tests). README/CHANGELOG
 * "narrated" / "generated" language means this function, not an AI call.
 */
export function describeProcess(proc) {
  const command = String(proc?.command || "").trim();
  const label = String(proc?.label || "other");
  const base = describeProcessBase(label, command);
  const cpuRaw = String(proc?.cpu ?? "").trim();
  const cpuNum = Number.parseFloat(cpuRaw);
  const hasCpu = cpuRaw !== "" && Number.isFinite(cpuNum);
  const signal = !hasCpu ? null : cpuNum >= 50 ? "busy" : cpuNum >= 10 ? "active" : "idle";
  const etime = String(proc?.etime || "").trim();
  const detail = [signal, hasCpu ? `${cpuRaw}% CPU` : null, etime ? `up ${etime}` : null]
    .filter(Boolean)
    .join(", ");
  const text = detail ? `${base} (${detail}).` : `${base}.`;
  return truncateStr(text, MAX_PROCESS_DESCRIPTION);
}
