// dashboard/lib/semantic-model.mjs
// Pure Mission Control view-model helpers (testable; no fs/git I/O).

import { truncateStr } from './guards.mjs';

export const MAX_ACTIVITY = 20;
export const MAX_ATTENTION = 15;
export const MAX_SEMANTIC_LABEL = 200;
export const MAX_GIT_ACTIVITY = 15;

// Max agent-prompt items surfaced in Field Report. Kept under MAX_ATTENTION so
// prompts never crowd out the rest of the stack once merged.
export const MAX_AGENT_PROMPTS = 8;

// Max external review reports surfaced in Field Report, for the same reason.
export const MAX_EXTERNAL_REPORTS = 6;

// Max plan-state and readiness notes surfaced in Checklist. Matches the
// Field Report bound these items had before they moved, so relocation does not
// change how much the panel renders.
export const MAX_CHECKLIST_NOTES = 15;

/** External review reports are `.cursor/memory/plan-monitor-<slug>.md`. */
export const EXTERNAL_REPORT_FILE_RE = /^plan-monitor-(.+)\.md$/;

/**
 * A heading the triage step leaves behind in the report itself. Confirmed
 * against the local reports: `## Triage note - residual (A) verified` and
 * `## Follow-up plan - hitl_ask_questions_residuals_2026_07_20.plan.md`.
 */
export const TRIAGE_HEADING_RE =
  /^#{2,6}\s+.*\b(triage|follow-?up plan|residuals plan)\b/im;

/** `**Plan:** [`name.plan.md`](../plans/name.plan.md)` in the report header. */
const REPORT_REVIEWED_PLAN_RE = /^\*\*Plan:\*\*\s*\[`([^`]+)`\]/m;

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
const MERGE_PR_RE = /^([0-9a-f]{7,40})\s+Merge pull request #(\d+)\b(.*)$/i;
const STAGING_COMMIT_RE = /\b(git staging|\/git-staging|merge.*staging|to staging)\b/i;

/**
 * Parse Agent Kit HANDOFF.md into structured fields used by Mission Control.
 * @param {string} content
 */
export function parseHandoffMarkdown(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const handoff = {};

  const planMatch = content.match(/^- \*\*Plan:\*\* `(.+?)`/m);
  if (planMatch) {
    const raw = planMatch[1].trim();
    handoff.plan = raw;
    handoff.planPath = raw.startsWith('.cursor/')
      ? raw
      : `.cursor/plans/${raw.replace(/^plans\//, '')}`;
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

  const parkedMatch = content.match(/^- \*\*Parked plans:\*\*\s*(.+)$/m);
  if (parkedMatch) {
    handoff.parkedPlansRaw = parkedMatch[1].trim();
    handoff.parkedPlans = parseParkedPlans(parkedMatch[1]);
  } else {
    handoff.parkedPlans = [];
  }

  const instructionMatch = content.match(
    /^- \*\*Instruction for the next agent:\*\*\s*(.+)$/m,
  );
  if (instructionMatch) {
    handoff.instruction = truncateStr(instructionMatch[1].trim(), MAX_SEMANTIC_LABEL);
  }

  return Object.keys(handoff).length > 0 ? handoff : null;
}

/** Extract plan file basenames from a parked-plans HANDOFF line. */
export function parseParkedPlans(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const ids = [];
  const backtick = [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const sources = backtick.length > 0 ? backtick : raw.split(/[,;]/);
  for (const part of sources) {
    const cleaned = String(part)
      .replace(/\(.*?\)/g, '')
      .trim()
      .replace(/^plans\//, '');
    if (!cleaned || /^none$/i.test(cleaned)) continue;
    const base = cleaned.split('/').pop();
    if (base) ids.push(base);
  }
  return [...new Set(ids)];
}

function planFileKey(plan) {
  if (!plan) return '';
  return String(plan.file || plan.path || plan.id || '')
    .split('/')
    .pop()
    .trim();
}

function handoffPlanKey(handoff) {
  if (!handoff?.plan) return '';
  return String(handoff.plan).split('/').pop().trim();
}

function isActivePlan(plan, handoff) {
  const active = handoffPlanKey(handoff);
  if (!active) return false;
  const key = planFileKey(plan);
  if (!key) return false;
  return (
    key === active ||
    key === `${active}.plan.md` ||
    active === key.replace(/\.plan\.md$/, '') ||
    active.includes(key) ||
    key.includes(active.replace(/\.plan\.md$/, ''))
  );
}

function isParkedPlan(plan, handoff) {
  const parked = handoff?.parkedPlans || [];
  if (parked.length === 0) return false;
  const key = planFileKey(plan);
  const id = String(plan?.id || '');
  return parked.some((p) => {
    const base = String(p).split('/').pop();
    return (
      base === key ||
      base === `${id}.plan.md` ||
      base.replace(/\.plan\.md$/, '') === id ||
      key.includes(base.replace(/\.plan\.md$/, ''))
    );
  });
}

function todoStats(plan) {
  const items = plan?.todos?.items || [];
  const total = plan?.todos?.total ?? items.length;
  const completed =
    plan?.todos?.completed ?? items.filter((t) => t.status === 'completed').length;
  const inProgress =
    plan?.todos?.inProgress ?? items.filter((t) => t.status === 'in_progress').length;
  const pending =
    plan?.todos?.pending ?? items.filter((t) => t.status === 'pending').length;
  const cancelled = items.filter((t) => t.status === 'cancelled').length;
  const open = total - completed - cancelled;
  return { items, total, completed, inProgress, pending, cancelled, open };
}

function modeImpliesAwaiting(mode) {
  return typeof mode === 'string' && AWAITING_MODE_RE.test(mode);
}

function modeImpliesExecuting(mode) {
  return typeof mode === 'string' && EXECUTING_MODE_RE.test(mode);
}

/**
 * Classify a plan lifecycle from HANDOFF + todo evidence.
 * @returns {'executing'|'awaiting_user'|'parked'|'incomplete'|'completed'}
 */
export function classifyPlan(plan, handoff) {
  if (isParkedPlan(plan, handoff)) return 'parked';

  const stats = todoStats(plan);
  const active = isActivePlan(plan, handoff);
  const mode = handoff?.mode || '';

  if (active) {
    if (modeImpliesAwaiting(mode) && stats.inProgress === 0) return 'awaiting_user';
    if (stats.inProgress > 0 || modeImpliesExecuting(mode)) return 'executing';
    if (stats.open > 0) return 'awaiting_user';
    return 'completed';
  }

  if (stats.total > 0 && stats.open === 0) return 'completed';
  if (stats.open > 0) return 'incomplete';
  return 'completed';
}

function pickCurrentTodo(plan, handoff) {
  const items = plan?.todos?.items || [];
  const inProg = items.find((t) => t.status === 'in_progress');
  if (inProg) return inProg;

  const nextRaw = handoff?.nextTodos || '';
  const nextId = nextRaw.match(/`?([a-z0-9][\w-]*)`?/i)?.[1];
  if (nextId) {
    const matched = items.find((t) => t.id === nextId);
    if (matched) return matched;
  }
  return items.find((t) => t.status === 'pending') || null;
}

function pickPreviousTodo(plan, current) {
  const items = plan?.todos?.items || [];
  let end = items.length;
  if (current) {
    const idx = items.findIndex((t) => t.id === current.id);
    if (idx >= 0) end = idx;
  }
  for (let i = end - 1; i >= 0; i--) {
    if (items[i].status === 'completed') return items[i];
  }
  return null;
}

function pickNextTodo(plan, current) {
  const items = plan?.todos?.items || [];
  if (!current) {
    return items.find((t) => t.status === 'pending' || t.status === 'in_progress') || null;
  }
  const idx = items.findIndex((t) => t.id === current.id);
  if (idx >= 0) {
    for (let i = idx + 1; i < items.length; i++) {
      if (items[i].status === 'pending' || items[i].status === 'in_progress') {
        return items[i];
      }
    }
  }
  return items.find((t) => t.id !== current.id && t.status === 'pending') || null;
}

function compactTodo(todo) {
  if (!todo) return null;
  return {
    id: todo.id,
    content: truncateStr(todo.content || '', MAX_SEMANTIC_LABEL),
    status: todo.status,
  };
}

/**
 * Build the "what is happening now" slice.
 */
export function buildCurrentExecution(plans, handoff) {
  if (!handoff?.plan) {
    return {
      status: 'idle',
      planId: null,
      planFile: null,
      planPath: null,
      mode: null,
      progress: { completed: 0, total: 0 },
      previousTodo: null,
      currentTodo: null,
      nextTodo: null,
      modifiedAt: null,
      sourcePath: '.cursor/HANDOFF.md',
      lifecycle: null,
    };
  }

  const active =
    (plans || []).find((p) => isActivePlan(p, handoff)) || null;
  const lifecycle = active ? classifyPlan(active, handoff) : null;
  const stats = active ? todoStats(active) : { completed: 0, total: 0 };
  const currentTodo = active ? pickCurrentTodo(active, handoff) : null;
  const previousTodo = active ? pickPreviousTodo(active, currentTodo) : null;
  const nextTodo = active ? pickNextTodo(active, currentTodo) : null;

  let status = 'idle';
  if (lifecycle === 'executing') status = 'executing';
  else if (lifecycle === 'awaiting_user') status = 'awaiting_user';
  else if (active && stats.open > 0) status = 'awaiting_user';

  return {
    status,
    planId: active?.id || handoff.plan.replace(/\.plan\.md$/, ''),
    planFile: active?.file || handoffPlanKey(handoff),
    planPath: active?.path || handoff.planPath || null,
    mode: handoff.mode || null,
    progress: { completed: stats.completed, total: stats.total },
    previousTodo: compactTodo(previousTodo),
    currentTodo: compactTodo(currentTodo),
    nextTodo: compactTodo(nextTodo),
    modifiedAt: active?.modifiedAt || handoff.lastUpdated || null,
    sourcePath: '.cursor/HANDOFF.md',
    lifecycle,
  };
}

function activityId(kind, parts) {
  return truncateStr(`${kind}:${parts.filter(Boolean).join(':')}`, 120);
}

/**
 * Format durable git log lines into semantic activity events.
 * @param {string[]} logLines - `git log --oneline` style lines (newest first)
 */
export function formatGitActivity(logLines, { limit = MAX_GIT_ACTIVITY } = {}) {
  const events = [];
  for (const line of logLines || []) {
    if (events.length >= limit) break;
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;

    const merge = trimmed.match(MERGE_PR_RE);
    if (merge) {
      const sha = merge[1].slice(0, 7);
      const pr = merge[2];
      events.push({
        id: activityId('merge', [pr, sha]),
        kind: 'merge',
        at: null,
        label: truncateStr(`Merged PR #${pr} → ${sha}.`, MAX_SEMANTIC_LABEL),
        refs: { pr: Number(pr), sha },
      });
      continue;
    }

    const m = trimmed.match(/^([0-9a-f]{7,40})\s+(.+)$/i);
    if (!m) continue;
    const sha = m[1].slice(0, 7);
    const message = m[2].trim();
    const kind = STAGING_COMMIT_RE.test(message) ? 'staging' : 'commit';
    events.push({
      id: activityId(kind, [sha]),
      kind,
      at: null,
      label: truncateStr(
        kind === 'staging'
          ? `Staging ${sha}: ${message}`
          : `Commit ${sha}: ${message}`,
        MAX_SEMANTIC_LABEL,
      ),
      refs: { sha },
    });
  }
  return events;
}

/**
 * Plan / HANDOFF milestone events (not refresh noise).
 */
export function formatPlanHandoffActivity({ now, handoff, plans }) {
  const events = [];

  if (now?.status === 'executing' && now.currentTodo) {
    const progress =
      now.progress?.total > 0
        ? ` Plan: ${now.progress.completed}/${now.progress.total}.`
        : '';
    const modeBit = now.mode ? `${truncateStr(now.mode, 80)}. ` : '';
    events.push({
      id: activityId('run_plan', [now.planFile, now.currentTodo.id]),
      kind: 'run_plan',
      at: now.modifiedAt || null,
      label: truncateStr(
        `${modeBit}Tick in flight: ${now.currentTodo.id}.${progress}`,
        MAX_SEMANTIC_LABEL,
      ),
      sourcePath: now.planPath || null,
      refs: { plan: now.planFile, todo: now.currentTodo.id },
    });
  } else if (now?.status === 'awaiting_user') {
    events.push({
      id: activityId('handoff', [now.planFile, 'awaiting']),
      kind: 'handoff',
      at: now.modifiedAt || null,
      label: truncateStr(
        `HANDOFF awaiting user: ${now.planFile || handoff?.plan || 'plan'}` +
          (now.nextTodo ? ` (next: ${now.nextTodo.id})` : ''),
        MAX_SEMANTIC_LABEL,
      ),
      sourcePath: '.cursor/HANDOFF.md',
      refs: { plan: now.planFile },
    });
  }

  // Only recent or parked completed plans: avoid flooding activity with old portfolio noise.
  const completed = (plans || [])
    .filter((plan) => {
      const lifecycle = classifyPlan(plan, handoff);
      return lifecycle === 'completed' || lifecycle === 'parked';
    })
    .filter((plan) => todoStats(plan).total > 0)
    .sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')))
    .slice(0, 3);

  for (const plan of completed) {
    const stats = todoStats(plan);
    const parked = classifyPlan(plan, handoff) === 'parked';
    events.push({
      id: activityId('plan_progress', [plan.file, parked ? 'parked' : 'done']),
      kind: 'plan_progress',
      at: plan.modifiedAt || null,
      label: truncateStr(
        parked
          ? `Parked ${plan.id}: ${stats.completed}/${stats.total}.`
          : `Plan ${plan.id}: ${stats.completed}/${stats.total} complete.`,
        MAX_SEMANTIC_LABEL,
      ),
      sourcePath: plan.path || null,
      refs: { plan: plan.file },
    });
  }

  return events;
}

/**
 * Narrow execution evidence from terminal lastOutput (explicit run-plan lines only).
 */
export function formatTerminalRunEvidence(terminals, { limit = 3 } = {}) {
  const events = [];
  for (const t of terminals || []) {
    if (events.length >= limit) break;
    const out = t?.lastOutput || '';
    if (!out || !/\/run-plan|LOOP_TICK_RESULT|Night shift:.*run-plan/i.test(out)) {
      continue;
    }
    const line =
      out
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /run-plan|LOOP_TICK_RESULT|Tick →|Tick ->/i.test(l)) || null;
    if (!line) continue;
    events.push({
      id: activityId('run_plan', ['term', t.id, line.slice(0, 40)]),
      kind: 'run_plan',
      at: null,
      label: truncateStr(line, MAX_SEMANTIC_LABEL),
      sourcePath: null,
      refs: { terminal: t.id },
    });
  }
  return events;
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
        label: truncateStr(ev.label || '', MAX_SEMANTIC_LABEL),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
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
 * Build the Field Report stack: what is waiting on a human reply.
 *
 * Carries agent prompts, untriaged external reviews, and the active HANDOFF
 * gate. The gate stays here because it is a pending human decision read from
 * `.cursor/HANDOFF.md`, not a portfolio state: the plan cannot advance until
 * someone answers it, which is the same question the other two rows ask. Plan
 * lifecycle and readiness advisories belong to Checklist
 * (see `buildChecklistNotes`).
 */
export function buildAttentionItems({
  plans,
  handoff,
  now,
  agentPrompts = [],
  externalReports = [],
  limit = MAX_ATTENTION,
}) {
  const items = [];

  // Agent prompts awaiting a reply lead the stack: they are the clearest
  // "waiting on you" signal and carry their own labelled group in the UI.
  for (const prompt of buildAgentPromptItems(agentPrompts)) {
    if (items.length >= limit) break;
    items.push(prompt);
  }

  // Untriaged external reviews follow: also user-owned work, also its own group.
  for (const report of buildExternalReportItems(externalReports, plans)) {
    if (items.length >= limit) break;
    items.push(report);
  }

  if (now?.status === 'awaiting_user') {
    items.push({
      id: 'attention:handoff-awaiting',
      kind: 'handoff',
      severity: 'action',
      label: truncateStr(
        `Active HANDOFF awaits user: ${now.planFile || handoff?.plan}` +
          (now.nextTodo ? ` → ${now.nextTodo.id}` : ''),
        MAX_SEMANTIC_LABEL,
      ),
      sourcePath: '.cursor/HANDOFF.md',
      modifiedAt: now.modifiedAt || handoff?.lastUpdated || null,
      progress: now.progress || null,
      action: attentionAction('path', '.cursor/HANDOFF.md', 'Copy path'),
    });
  }

  return items.slice(0, limit);
}

/** Shared row shape for a plan whose lifecycle needs a decision. */
function planStateNote(plan, { kind, severity }) {
  const stats = todoStats(plan);
  const path = plan.path || `.cursor/plans/${plan.file}`;
  const prefix = kind === 'parked' ? 'Parked plan' : 'Incomplete plan';
  return {
    id: `attention:${kind}:${plan.file}`,
    kind,
    severity,
    label: truncateStr(
      `${prefix}: ${plan.id} (${stats.completed}/${stats.total})`,
      MAX_SEMANTIC_LABEL,
    ),
    sourcePath: path,
    // Lets the panel drop a note whose plan already renders as a plan card.
    planFile: plan.file,
    modifiedAt: plan.modifiedAt || null,
    progress: {
      completed: stats.completed,
      total: stats.total,
      label: `${stats.completed} of ${stats.total}`,
    },
    action: attentionAction('path', path, 'Copy path'),
  };
}

/**
 * Build the Checklist notes: plan lifecycle and readiness advisories.
 *
 * These rows describe the state of the plan portfolio rather than a pending
 * reply, so they live next to the plan cards instead of in Field Report. Rows
 * carry `planFile` so the panel can reconcile a note against a plan already
 * rendered as a card.
 */
export function buildChecklistNotes({
  plans,
  handoff,
  readinessPending = [],
  limit = MAX_CHECKLIST_NOTES,
}) {
  const items = [];

  for (const plan of plans || []) {
    if (items.length >= limit) break;
    if (classifyPlan(plan, handoff) !== 'parked') continue;
    items.push(planStateNote(plan, { kind: 'parked', severity: 'info' }));
  }

  for (const plan of plans || []) {
    if (items.length >= limit) break;
    if (classifyPlan(plan, handoff) !== 'incomplete') continue;
    if (isActivePlan(plan, handoff)) continue;
    items.push(planStateNote(plan, { kind: 'incomplete', severity: 'warning' }));
  }

  for (const pending of readinessPending || []) {
    if (items.length >= limit) break;
    if (!pending || pending.essential === true) continue;
    if (pending.status === 'ready') continue;
    const id = pending.id || pending.checkId || 'readiness';
    items.push({
      id: `attention:readiness:${id}`,
      kind: 'readiness',
      severity: 'info',
      label: truncateStr(
        pending.label ||
          pending.title ||
          `Non-essential readiness: ${id} (${pending.status || 'pending'})`,
        MAX_SEMANTIC_LABEL,
      ),
      sourcePath: '.cursor/context/readiness.json',
      modifiedAt: null,
      progress: null,
      action: {
        type: 'copy',
        target: '/agent-kit-onboard',
        label: 'Copy /agent-kit-onboard',
        subject: '/agent-kit-onboard',
        pasteDestination: 'chat input',
      },
    });
  }

  return items.slice(0, limit);
}

/**
 * Enrich plan records with lifecycle classification (non-mutating copy).
 */
export function enrichPlans(plans, handoff) {
  return (plans || []).map((plan) => {
    const stats = todoStats(plan);
    return {
      id: plan.id,
      file: plan.file,
      path: plan.path,
      overview: truncateStr(plan.overview || '', MAX_SEMANTIC_LABEL),
      modifiedAt: plan.modifiedAt || null,
      progress: {
        completed: stats.completed,
        total: stats.total,
        label: `${stats.completed} of ${stats.total}`,
      },
      lifecycle: classifyPlan(plan, handoff),
      currentTodo: compactTodo(pickCurrentTodo(plan, handoff)),
      nextTodo: compactTodo(
        pickNextTodo(plan, pickCurrentTodo(plan, handoff)),
      ),
    };
  });
}

/**
 * Allowlisted readiness pending actions for attention (no nested scan dump).
 */
export function allowlistReadinessPending(rawPending) {
  if (!Array.isArray(rawPending)) return [];
  return rawPending.slice(0, MAX_ATTENTION).map((item) => ({
    id: typeof item?.id === 'string' ? item.id : 'unknown',
    status: typeof item?.status === 'string' ? item.status : 'unknown',
    essential: item?.essential === true,
    title:
      typeof item?.title === 'string'
        ? truncateStr(item.title, 120)
        : typeof item?.label === 'string'
          ? truncateStr(item.label, 120)
          : undefined,
  }));
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
  if (!entry || entry.role !== 'assistant') return false;
  const content = entry.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (c) =>
      c &&
      c.type === 'tool_use' &&
      AGENT_QUESTION_TOOL_RE.test(String(c.name || '')),
  );
}

export function isUserEntry(entry) {
  return !!entry && entry.role === 'user';
}

/** Derive a human-readable label from the question tool_use itself. */
export function extractQuestionLabel(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (
      !c ||
      c.type !== 'tool_use' ||
      !AGENT_QUESTION_TOOL_RE.test(String(c.name || ''))
    ) {
      continue;
    }
    const questions = c.input?.questions;
    if (Array.isArray(questions)) {
      for (const q of questions) {
        const prompt = q?.prompt || q?.question || q?.text;
        if (typeof prompt === 'string' && prompt.trim()) {
          return truncateStr(prompt.trim(), MAX_SEMANTIC_LABEL);
        }
      }
    }
    const single = c.input?.prompt || c.input?.question;
    if (typeof single === 'string' && single.trim()) {
      return truncateStr(single.trim(), MAX_SEMANTIC_LABEL);
    }
  }
  return null;
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
    if (!e || typeof e !== 'object') continue;
    if (isUserEntry(e)) lastUserIdx = i;
    if (isAgentQuestionEntry(e)) {
      lastQuestionIdx = i;
      lastQuestionEntry = e;
    }
  }
  if (lastQuestionIdx < 0) return null;
  if (lastUserIdx > lastQuestionIdx) return null;
  return { label: extractQuestionLabel(lastQuestionEntry) };
}

/**
 * Map detected prompts into attention-item shape. Each item copies the chat
 * reference the user pastes into the past-chat picker; it does not open a chat.
 * @param {{chatId:string,label?:string,quietAt?:string}[]} prompts
 */
export function buildAgentPromptItems(prompts, { limit = MAX_AGENT_PROMPTS } = {}) {
  const items = [];
  for (const p of prompts || []) {
    if (items.length >= limit) break;
    if (!p || !p.chatId) continue;
    items.push({
      id: `attention:prompt:${p.chatId}`,
      kind: 'prompt',
      severity: 'action',
      label: truncateStr(
        p.label || 'Agent question awaiting a reply',
        MAX_SEMANTIC_LABEL,
      ),
      sourcePath: null,
      chatId: p.chatId,
      modifiedAt: p.quietAt || null,
      progress: null,
      action: {
        type: 'copy',
        target: p.chatId,
        label: 'Copy chat reference',
        subject: 'chat reference',
        pasteDestination: 'past-chat picker',
      },
    });
  }
  return items;
}

/** Compare slugs across the `-` / `_` split between report and plan names. */
function normalizeSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.plan\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parse one external review report into the fields the triage rule needs.
 * @param {{file:string,content:string,modifiedAt?:string}} input
 */
export function parseExternalReport({ file, content, modifiedAt = null } = {}) {
  const match = EXTERNAL_REPORT_FILE_RE.exec(String(file || ''));
  if (!match) return null;
  const text = typeof content === 'string' ? content : '';
  const reviewed = text.match(REPORT_REVIEWED_PLAN_RE);
  return {
    file,
    path: `.cursor/memory/${file}`,
    slug: match[1],
    reviewedPlanFile: reviewed ? reviewed[1].trim() : null,
    triageNoteInReport: TRIAGE_HEADING_RE.test(text),
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
 * Neither signal alone is enough: `/plan-review-triage` may write a residuals
 * plan without touching the report, and an "ack and stop" outcome produces a
 * note with no plan at all. A report with neither signal is surfaced as
 * awaiting triage. The fs half (directory, file cap, size cap, recency window)
 * lives in `dashboard-data.mjs`, next to the prompt-scan contract.
 */
export function isReportTriaged(report, plans) {
  if (!report) return false;
  if (report.triageNoteInReport) return true;

  const slug = normalizeSlug(report.slug);
  const reviewed = normalizeSlug(report.reviewedPlanFile);
  if (!slug && !reviewed) return false;

  return (plans || []).some((plan) => {
    if (!plan) return false;
    const planFile = String(plan.file || '');
    if (report.reviewedPlanFile && planFile === report.reviewedPlanFile) return false;
    const planSlug = normalizeSlug(plan.id || planFile);
    if (planSlug === slug || (reviewed && planSlug === reviewed)) return false;
    const haystack = normalizeSlug(`${plan.id || ''} ${plan.overview || ''}`);
    if (!haystack) return false;
    return (
      (!!slug && haystack.includes(slug)) || (!!reviewed && haystack.includes(reviewed))
    );
  });
}

/**
 * Map untriaged reports into attention-item shape. Each item copies the triage
 * command with the report path; it does not run triage.
 * @param {object[]} reports - parsed reports (see `parseExternalReport`)
 * @param {object[]} plans - plan records from the snapshot
 */
export function buildExternalReportItems(
  reports,
  plans,
  { limit = MAX_EXTERNAL_REPORTS } = {},
) {
  const items = [];
  for (const report of reports || []) {
    if (items.length >= limit) break;
    if (!report || !report.file) continue;
    if (isReportTriaged(report, plans)) continue;
    const reviewed = report.reviewedPlanFile
      ? report.reviewedPlanFile.replace(/\.plan\.md$/, '')
      : report.slug;
    items.push({
      id: `attention:report:${report.slug}`,
      kind: 'report',
      severity: 'action',
      label: truncateStr(
        `External review of ${reviewed} has no triage outcome yet`,
        MAX_SEMANTIC_LABEL,
      ),
      sourcePath: report.path,
      modifiedAt: report.modifiedAt || null,
      progress: null,
      action: {
        type: 'copy',
        target: `/plan-review-triage ${report.path}`,
        label: 'Copy triage command',
        subject: 'triage command',
        pasteDestination: 'chat input',
      },
    });
  }
  return items;
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
  agentPrompts = [],
  externalReports = [],
} = {}) {
  const now = buildCurrentExecution(plans, handoff);
  const classifiedPlans = enrichPlans(plans, handoff);
  const planEvents = formatPlanHandoffActivity({ now, handoff, plans });
  const activity = mergeActivity([
    planEvents.filter((e) => e.kind === 'run_plan' || e.kind === 'handoff'),
    formatGitActivity(gitLogLines),
    planEvents.filter((e) => e.kind === 'plan_progress'),
    formatTerminalRunEvidence(terminals),
  ]);
  const attention = buildAttentionItems({
    plans,
    handoff,
    now,
    agentPrompts,
    externalReports,
  });
  const checklistNotes = buildChecklistNotes({
    plans,
    handoff,
    readinessPending: allowlistReadinessPending(readinessPending),
  });

  return {
    schemaVersion: '1.0.0',
    now,
    activity,
    attention,
    checklistNotes,
    plans: classifiedPlans,
  };
}
