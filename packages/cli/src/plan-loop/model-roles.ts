/**
 * Model roles: the `roles` key of `.cursor/context/config.json` (worker,
 * subworker, reviewer) and its resolution against CLI flags and plan
 * frontmatter. ADR 2026-11-16_model-roles-config-contract.md; reviewer
 * model rule in ADR 2026-11-16_reviewer-same-family-rule.md; capability
 * evidence in docs/model-roles-capability-matrix.md.
 *
 * With no `roles` key and no plan override every command keeps its old
 * default. A bad value stops the run (usage error) instead of running the
 * default backend: a silent fallback could bill a backend nobody picked.
 */
import { loadContextConfig } from "../lifecycle/context-config.js";
import type { BackendId } from "./backends.js";
import { isBackendId, isRequestedBackend } from "./detect.js";
import { readPlan, resolveActivePlanPath } from "./plan-state.js";

/** What each backend lets the kit set per role (docs/model-roles-capability-matrix.md). */
export interface RoleCapability {
  /** `roles.worker.model` reaches the vendor CLI. */
  workerModel: boolean;
  /** `roles.subworker` reaches the subagents the worker spawns. */
  subworkerModel: boolean;
  /** A review-only session can run on this backend. */
  reviewer: boolean;
}

/** Mirrored in dashboard/lib/guards.mjs (ROLE_CAPABILITIES); a parity test keeps them equal. */
export const ROLE_CAPABILITIES: Readonly<Record<BackendId, RoleCapability>> = Object.freeze({
  claude: { workerModel: true, subworkerModel: true, reviewer: true },
  "cursor-agent": { workerModel: true, subworkerModel: false, reviewer: true },
  codex: { workerModel: true, subworkerModel: false, reviewer: false },
  openrouter: { workerModel: true, subworkerModel: false, reviewer: false },
  "cursor-acp": { workerModel: false, subworkerModel: false, reviewer: false },
});

/** Model ids: aliases, full ids, OpenRouter `vendor/model`, Cursor `[k=v,...]` parameters. Argv/env only, never a shell. */
export const ROLE_MODEL_ID = /^[A-Za-z0-9._:/+=,[\]-]{1,128}$/;
/** Plan `worker_type` values used as `roles.subworker.byWorkerType` keys. */
export const ROLE_WORKER_TYPE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Reserved `roles.subworker.model` value (auto tier routing is a separate plan). */
export const SUBWORKER_AUTO = "auto";
export const REVIEWER_SCOPES = ["off", "tick", "plan"] as const;
export const REVIEWER_BACKENDS = ["auto", "claude", "cursor-agent"] as const;
/** Claude Code's documented default model for subagents without their own model. */
export const CLAUDE_SUBAGENT_MODEL_ENV = "CLAUDE_CODE_SUBAGENT_MODEL";

export type ReviewerScope = (typeof REVIEWER_SCOPES)[number];
export type RoleSource = "flag" | "plan" | "config" | "default";

export interface WorkerRole {
  backend?: string;
  model?: string;
}
export interface SubworkerRole {
  model?: string;
  byWorkerType?: Record<string, string>;
}
export interface ReviewerRole {
  enabled?: boolean;
  scope?: ReviewerScope;
  backend?: (typeof REVIEWER_BACKENDS)[number];
  model?: string;
  advisorModel?: string;
}
export interface ModelRoles {
  worker?: WorkerRole;
  subworker?: SubworkerRole;
  reviewer?: ReviewerRole;
}

export type ParseRolesResult = { ok: true; roles: ModelRoles } | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function modelField(v: unknown, where: string): { value?: string; error?: string } {
  if (v === undefined || v === null || v === "") return {};
  if (typeof v !== "string" || !ROLE_MODEL_ID.test(v.trim())) {
    return { error: `${where} must be a model id (letters, digits, . _ : / + = , [ ] -)` };
  }
  return { value: v.trim() };
}

/**
 * Parse `config.roles`. Absent is `{}`. Unknown keys and malformed values are
 * errors: the caller stops instead of guessing.
 */
export function parseModelRoles(raw: unknown): ParseRolesResult {
  if (raw === undefined || raw === null) return { ok: true, roles: {} };
  if (!isPlainObject(raw)) return { ok: false, error: "roles must be an object" };
  const roles: ModelRoles = {};
  for (const key of Object.keys(raw)) {
    if (key !== "worker" && key !== "subworker" && key !== "reviewer") {
      return { ok: false, error: `unknown roles key: ${key}` };
    }
  }
  if (raw.worker !== undefined && raw.worker !== null) {
    const w = raw.worker;
    if (!isPlainObject(w)) return { ok: false, error: "roles.worker must be an object" };
    for (const key of Object.keys(w)) {
      if (key !== "backend" && key !== "model") {
        return { ok: false, error: `unknown roles.worker key: ${key}` };
      }
    }
    const worker: WorkerRole = {};
    if (w.backend !== undefined && w.backend !== null && w.backend !== "") {
      const b = typeof w.backend === "string" ? w.backend.trim().toLowerCase() : "";
      if (!isRequestedBackend(b)) {
        return {
          ok: false,
          error: `roles.worker.backend must be auto or a kit backend id (got ${JSON.stringify(w.backend)})`,
        };
      }
      worker.backend = b;
    }
    const m = modelField(w.model, "roles.worker.model");
    if (m.error) return { ok: false, error: m.error };
    if (m.value) worker.model = m.value;
    roles.worker = worker;
  }
  if (raw.subworker !== undefined && raw.subworker !== null) {
    const s = raw.subworker;
    if (!isPlainObject(s)) return { ok: false, error: "roles.subworker must be an object" };
    for (const key of Object.keys(s)) {
      if (key !== "model" && key !== "byWorkerType") {
        return { ok: false, error: `unknown roles.subworker key: ${key}` };
      }
    }
    const sub: SubworkerRole = {};
    const m = modelField(s.model, "roles.subworker.model");
    if (m.error) return { ok: false, error: m.error };
    if (m.value) sub.model = m.value;
    if (s.byWorkerType !== undefined && s.byWorkerType !== null) {
      if (!isPlainObject(s.byWorkerType)) {
        return { ok: false, error: "roles.subworker.byWorkerType must be an object" };
      }
      const map: Record<string, string> = {};
      for (const [type, value] of Object.entries(s.byWorkerType)) {
        if (!ROLE_WORKER_TYPE_KEY.test(type)) {
          return {
            ok: false,
            error: `roles.subworker.byWorkerType key ${type} is not a worker_type`,
          };
        }
        const mv = modelField(value, `roles.subworker.byWorkerType.${type}`);
        if (mv.error) return { ok: false, error: mv.error };
        if (mv.value) map[type] = mv.value;
      }
      sub.byWorkerType = map;
    }
    roles.subworker = sub;
  }
  if (raw.reviewer !== undefined && raw.reviewer !== null) {
    const r = raw.reviewer;
    if (!isPlainObject(r)) return { ok: false, error: "roles.reviewer must be an object" };
    const reviewer: ReviewerRole = {};
    for (const key of Object.keys(r)) {
      if (!["enabled", "scope", "backend", "model", "advisorModel"].includes(key)) {
        return { ok: false, error: `unknown roles.reviewer key: ${key}` };
      }
    }
    if (r.enabled !== undefined && r.enabled !== null) {
      if (typeof r.enabled !== "boolean") {
        return { ok: false, error: "roles.reviewer.enabled must be boolean" };
      }
      reviewer.enabled = r.enabled;
    }
    if (r.scope !== undefined && r.scope !== null) {
      if (
        typeof r.scope !== "string" ||
        !(REVIEWER_SCOPES as readonly string[]).includes(r.scope)
      ) {
        return { ok: false, error: "roles.reviewer.scope must be off, tick, or plan" };
      }
      reviewer.scope = r.scope as ReviewerScope;
    }
    if (r.backend !== undefined && r.backend !== null) {
      if (
        typeof r.backend !== "string" ||
        !(REVIEWER_BACKENDS as readonly string[]).includes(r.backend)
      ) {
        return { ok: false, error: "roles.reviewer.backend must be auto, claude, or cursor-agent" };
      }
      reviewer.backend = r.backend as ReviewerRole["backend"];
    }
    for (const key of ["model", "advisorModel"] as const) {
      const mv = modelField(r[key], `roles.reviewer.${key}`);
      if (mv.error) return { ok: false, error: mv.error };
      if (mv.value) reviewer[key] = mv.value;
    }
    roles.reviewer = reviewer;
  }
  return { ok: true, roles };
}

/** Flat plan frontmatter overrides (ADR point 3). */
export interface PlanRoleOverrides {
  workerBackend?: string;
  workerModel?: string;
  subworkerModel?: string;
  /** `worker_type` of the next pending / in_progress to-do. */
  nextWorkerType?: string;
}

function frontmatterBlock(planText: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(planText);
  return m?.[1] ?? null;
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** Read `worker_backend` / `worker_model` / `subworker_model` and the next to-do's `worker_type`. */
export function readPlanRoleOverrides(planText: string): PlanRoleOverrides {
  const block = frontmatterBlock(planText);
  if (!block) return {};
  const out: PlanRoleOverrides = {};
  const top = (key: string): string | undefined => {
    const m = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(block);
    const v = m?.[1] ? unquote(m[1]) : "";
    return v ? v : undefined;
  };
  const wb = top("worker_backend");
  if (wb) out.workerBackend = wb;
  const wm = top("worker_model");
  if (wm) out.workerModel = wm;
  const sm = top("subworker_model");
  if (sm) out.subworkerModel = sm;
  // To-do items: `  - id: x` blocks under `todos:`; the first pending or
  // in_progress one is the next unit, as in countPendingTodos.
  const items = block.split(/^\s*- id:/m).slice(1);
  for (const item of items) {
    const status = /^\s*status:\s*(\S+)/m.exec(item)?.[1];
    if (status !== "pending" && status !== "in_progress") continue;
    if (unquote(item.split("\n")[0] ?? "") === "dogfood-poc") continue;
    const type = /^\s*worker_type:\s*(.+)$/m.exec(item)?.[1];
    if (type) out.nextWorkerType = unquote(type);
    break;
  }
  return out;
}

export interface ResolvedWorker {
  /** Requested backend (`auto` or an id); the caller runs detection on it. */
  backend: string;
  model?: string;
  backendSource: RoleSource;
  modelSource?: RoleSource;
  /** Non-fatal notes (dropped models, unsupported knobs). */
  warnings: string[];
}

const RANK: Record<RoleSource, number> = { flag: 3, plan: 2, config: 1, default: 0 };

export interface ResolveWorkerInput {
  flagBackend?: string;
  flagModel?: string;
  plan?: PlanRoleOverrides;
  roles?: ModelRoles;
  defaultBackend: string;
}

/**
 * CLI flag > plan frontmatter > config > default. A model is taken only from
 * the layer that chose the backend or a higher one (ADR point 3).
 */
export function resolveWorkerRole(input: ResolveWorkerInput): ResolvedWorker {
  const warnings: string[] = [];
  const layers: { source: RoleSource; backend?: string; model?: string }[] = [
    {
      source: "flag",
      backend: input.flagBackend?.trim() || undefined,
      model: input.flagModel?.trim() || undefined,
    },
    { source: "plan", backend: input.plan?.workerBackend, model: input.plan?.workerModel },
    { source: "config", backend: input.roles?.worker?.backend, model: input.roles?.worker?.model },
    { source: "default", backend: input.defaultBackend },
  ];
  const bLayer = layers.find((l) => l.backend) ?? {
    source: "default" as const,
    backend: input.defaultBackend,
  };
  const backend = (bLayer.backend as string).trim().toLowerCase();
  let model: string | undefined;
  let modelSource: RoleSource | undefined;
  for (const l of layers) {
    if (!l.model) continue;
    if (RANK[l.source] < RANK[bLayer.source]) {
      warnings.push(
        `${l.source} model ${l.model} ignored: the backend ${backend} came from the ${bLayer.source} layer, and a model only applies to its own backend or a lower layer's`,
      );
      break;
    }
    model = l.model;
    modelSource = l.source;
    break;
  }
  if (
    model &&
    modelSource !== "flag" &&
    isBackendId(backend) &&
    !ROLE_CAPABILITIES[backend].workerModel
  ) {
    warnings.push(
      `${modelSource} model ${model} ignored: ${backend} cannot select a model (docs/model-roles-capability-matrix.md)`,
    );
    model = undefined;
    modelSource = undefined;
  }
  return {
    backend,
    ...(model ? { model, modelSource } : {}),
    backendSource: bLayer.source,
    warnings,
  };
}

export interface ResolvedSubworker {
  model?: string;
  source?: "plan" | "worker_type" | "config";
  warning?: string;
}

/** Subworker model for one tick on a resolved backend (ADR points 4 and 6). */
export function resolveSubworkerModel(input: {
  backend: BackendId;
  roles?: ModelRoles;
  plan?: PlanRoleOverrides;
}): ResolvedSubworker {
  const sub = input.roles?.subworker;
  const type = input.plan?.nextWorkerType;
  let model: string | undefined;
  let source: ResolvedSubworker["source"];
  if (input.plan?.subworkerModel) {
    model = input.plan.subworkerModel;
    source = "plan";
  } else if (type && sub?.byWorkerType?.[type]) {
    model = sub.byWorkerType[type];
    source = "worker_type";
  } else if (sub?.model) {
    model = sub.model;
    source = "config";
  }
  if (!model) return {};
  if (model === SUBWORKER_AUTO) {
    return {
      warning:
        "subworker model auto is reserved and not implemented yet (auto tier routing); no subworker model set",
    };
  }
  if (!ROLE_MODEL_ID.test(model)) {
    return {
      warning: `subworker model ${JSON.stringify(model)} is not a model id; no subworker model set`,
    };
  }
  if (!ROLE_CAPABILITIES[input.backend].subworkerModel) {
    const how =
      input.backend === "cursor-agent"
        ? "Cursor subagents follow the worker model (model: inherit)"
        : "subagents keep the backend default";
    return {
      warning: `subworker model ${model} is not supported on ${input.backend}; ${how} (docs/model-roles-capability-matrix.md)`,
    };
  }
  return { model, source };
}

/** One log line for the resolved roles of a tick. */
export function describeResolvedRoles(input: {
  backendId: string;
  backendSource: RoleSource;
  model?: string;
  modelSource?: RoleSource;
  subworker?: ResolvedSubworker;
}): string {
  const model = input.model ? `${input.model} (${input.modelSource ?? "flag"})` : "backend default";
  const sub = input.subworker?.model
    ? `, subworker ${input.subworker.model} (${input.subworker.source})`
    : "";
  return `roles: worker ${input.backendId} (${input.backendSource}), model ${model}${sub}`;
}

/** Effective reviewer role: when a review runs and with which backend and model. */
export interface ResolvedReviewer {
  /** `off` (no review), `tick` (review job after each headless tick) or `plan` (audits path). */
  scope: ReviewerScope;
  /** Which key decided on/off: `roles.reviewer`, legacy `externalPlanReview.enabled`, or neither. */
  source: "roles" | "externalPlanReview" | "default";
  backend?: (typeof REVIEWER_BACKENDS)[number];
  model?: string;
  advisorModel?: string;
}

/**
 * Resolve `roles.reviewer` against the legacy `externalPlanReview.enabled`
 * (ADR model roles point 8). `enabled: false` or `scope: "off"` turns review
 * off and wins over the legacy key; an absent `enabled` falls back to the
 * legacy key; an absent `scope` is `plan`. With no `roles.reviewer` the result
 * is the legacy behavior (`plan` when `externalPlanReview.enabled` is true).
 */
export function resolveReviewerRole(
  roles: ModelRoles | undefined,
  externalPlanReview?: unknown,
): ResolvedReviewer {
  const r = roles?.reviewer;
  const legacyOn = isPlainObject(externalPlanReview) && externalPlanReview.enabled === true;
  const fields = {
    ...(r?.backend ? { backend: r.backend } : {}),
    ...(r?.model ? { model: r.model } : {}),
    ...(r?.advisorModel ? { advisorModel: r.advisorModel } : {}),
  };
  if (r?.enabled === false || r?.scope === "off") {
    return { scope: "off", source: "roles", ...fields };
  }
  const on = r?.enabled === true || legacyOn;
  const source = r?.enabled === true ? "roles" : legacyOn ? "externalPlanReview" : "default";
  if (!on) return { scope: "off", source, ...fields };
  return { scope: r?.scope ?? "plan", source, ...fields };
}

/** How a reviewer model relates to the implementer model (ADR reviewer same-family rule). */
export type ReviewModelRelation = "identical" | "same-family" | "different";

/**
 * Fold a model id for the identical-model compare: lower case, no
 * whitespace, no bracket parameter (`opus[1m]` is `opus`); empty and the
 * Auto spellings are `auto`. Mirrors `normalize_model_id` in
 * `.cursor/scripts/plan-external-review.sh` (parity test).
 */
export function normalizeReviewModelId(raw: string | undefined): string {
  const id = (raw ?? "").toLowerCase().replace(/\s+/g, "").replace(/\[.*$/, "");
  if (id === "" || id === "auto" || id === "cursor-auto" || id === "cursorauto" || id === "default")
    return "auto";
  return id;
}

/** Family prefixes, same table as `normalize_model_family` in the audits launcher. */
const FAMILY_PATTERNS: readonly (readonly [string, RegExp])[] = [
  [
    "haiku",
    /^(haiku|claude-haiku|claude-3-haiku.*|claude-3\.5-haiku.*|claude-3-5-haiku.*|claude-haiku-.*|claude-4-haiku.*|claude-4\.5-haiku.*)$/,
  ],
  [
    "opus",
    /^(opus|claude-opus|claude-3-opus.*|claude-opus-.*|claude-4-opus.*|claude-4\.5-opus.*)$/,
  ],
  [
    "sonnet",
    /^(sonnet|claude-sonnet|claude-3-sonnet.*|claude-3\.5-sonnet.*|claude-3-5-sonnet.*|claude-3-7-sonnet.*|claude-sonnet-.*|claude-4-sonnet.*|claude-4\.5-sonnet.*)$/,
  ],
  ["fable", /^(fable|claude-fable|claude-fable-.*)$/],
  ["composer", /^(composer|composer-.*|cursor-composer.*)$/],
  ["grok", /^(grok|grok-.*)$/],
];

/** Model family of an id (`opus`, `sonnet`, `haiku`, `fable`, `composer`, `grok`, `auto`), else the folded id. */
export function reviewModelFamily(raw: string | undefined): string {
  const id = normalizeReviewModelId(raw);
  for (const [family, pattern] of FAMILY_PATTERNS) if (pattern.test(id)) return family;
  return id;
}

function isFamilyAlias(id: string, family: string): boolean {
  return id === family || id === `claude-${family}` || id === `cursor-${family}`;
}

/**
 * The reviewer rule (ADR 2026-11-16_reviewer-same-family-rule): the identical
 * model is refused (same folded id, Auto/Auto, or a family alias against any
 * id of that family, because the alias may resolve to it); two different full
 * ids of one family run with a warning; different families run.
 */
export function reviewModelRelation(
  implementer: string | undefined,
  reviewer: string | undefined,
): ReviewModelRelation {
  const a = normalizeReviewModelId(implementer);
  const b = normalizeReviewModelId(reviewer);
  if (a === b) return "identical";
  const fa = reviewModelFamily(a);
  const fb = reviewModelFamily(b);
  if (fa !== fb) return "different";
  if (isFamilyAlias(a, fa) || isFamilyAlias(b, fb)) return "identical";
  return "same-family";
}

/** One line for a refused identical-model review (never a silent self-review). */
export function describeIdenticalReviewModel(implementer: string, reviewer: string): string {
  return `reviewer model ${reviewer} is the implementer model (${implementer}): identical-model review is refused, Auto/Auto and a family alias against an id of that family included. This is not a silent self-review; set roles.reviewer.model to a different model`;
}

/** One warning line for a same-family reviewer that runs. */
export function describeSameFamilyReviewModel(implementer: string, reviewer: string): string {
  return `reviewer model ${reviewer} and implementer model ${implementer} are the same family (${reviewModelFamily(reviewer)}): the review runs, as a second read by a different model of one family`;
}

export interface ResolvedReviewJob {
  /** Requested backend (`auto` or an id); the caller runs detection on it. */
  backend: string;
  model?: string;
  backendSource: "flag" | "config" | "default";
  modelSource?: "flag" | "config";
  /** Set when the reviewer model is the implementer model: the caller refuses the run. */
  refusal?: string;
  /** Set when reviewer and implementer are different models of one family. */
  warning?: string;
}

/**
 * Backend and model of the standalone review job (`agent-kit run review-pack`,
 * `countdown --job review`): flag > `roles.reviewer` > `auto`. A config model
 * rides only on the config or default backend (ADR model roles point 3). The
 * reviewer rule applies when both the reviewer model and `roles.worker.model`
 * are known; with neither key set nothing changes.
 */
export function resolveReviewJobRole(input: {
  flagBackend?: string;
  flagModel?: string;
  roles?: ModelRoles;
}): ResolvedReviewJob {
  const flagBackend = input.flagBackend?.trim() ?? "";
  const flagModel = input.flagModel?.trim() ?? "";
  const reviewer = input.roles?.reviewer;
  const backend = flagBackend || reviewer?.backend || "auto";
  const backendSource = flagBackend ? "flag" : reviewer?.backend ? "config" : "default";
  const model = flagModel || (flagBackend ? "" : (reviewer?.model ?? ""));
  const out: ResolvedReviewJob = {
    backend,
    backendSource,
    ...(model ? { model, modelSource: flagModel ? ("flag" as const) : ("config" as const) } : {}),
  };
  const implementer = input.roles?.worker?.model;
  if (model && implementer) {
    const relation = reviewModelRelation(implementer, model);
    if (relation === "identical") out.refusal = describeIdenticalReviewModel(implementer, model);
    else if (relation === "same-family") {
      out.warning = describeSameFamilyReviewModel(implementer, model);
    }
  }
  return out;
}

export type LoadRolesResult =
  | { ok: true; roles: ModelRoles; plan: PlanRoleOverrides; reviewer: ResolvedReviewer }
  | { ok: false; error: string };

/** Validate the plan frontmatter overrides with the same rules as config (ADR point 5). */
export function checkPlanRoleOverrides(plan: PlanRoleOverrides): string | null {
  if (plan.workerBackend && !isRequestedBackend(plan.workerBackend.toLowerCase())) {
    return `plan frontmatter worker_backend must be auto or a kit backend id (got ${JSON.stringify(plan.workerBackend)})`;
  }
  for (const [key, value] of [
    ["worker_model", plan.workerModel],
    ["subworker_model", plan.subworkerModel],
  ] as const) {
    if (value && !ROLE_MODEL_ID.test(value)) {
      return `plan frontmatter ${key} must be a model id (got ${JSON.stringify(value)})`;
    }
  }
  return null;
}

/**
 * Read `roles` from `.cursor/context/config.json` and, when `usePlan`, the
 * active plan's frontmatter overrides. A malformed value is an error: the
 * caller stops with a usage error instead of running a default backend.
 */
export async function loadRolesContext(root: string, usePlan: boolean): Promise<LoadRolesResult> {
  const config = await loadContextConfig(root);
  const parsed = parseModelRoles(config?.roles);
  if (!parsed.ok) return { ok: false, error: `.cursor/context/config.json: ${parsed.error}` };
  let plan: PlanRoleOverrides = {};
  if (usePlan) {
    const planPath = await resolveActivePlanPath(root);
    if (planPath) {
      plan = readPlanRoleOverrides(await readPlan(planPath).catch(() => ""));
      const problem = checkPlanRoleOverrides(plan);
      if (problem) return { ok: false, error: `${planPath}: ${problem}` };
    }
  }
  return {
    ok: true,
    roles: parsed.roles,
    plan,
    reviewer: resolveReviewerRole(parsed.roles, config?.externalPlanReview),
  };
}
