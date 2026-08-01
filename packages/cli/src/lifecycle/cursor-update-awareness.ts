import { readFile } from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "../utils/fs.js";

/** Official Cursor product changelog (detection source SoT). */
export const DEFAULT_CURSOR_CHANGELOG_URL = "https://cursor.com/changelog";

/**
 * In-child changelog fetch timeout. sessionStart spawn timeout must exceed this
 * (see CURSOR_AWARENESS_SPAWN_TIMEOUT_MS in session-start.ts).
 */
export const CHANGELOG_FETCH_TIMEOUT_MS = 15_000;

/** Cursor product majors stay low; CSS/layout tokens on the changelog page are 30–50+. */
export const CURSOR_VERSION_MAJOR_MAX = 20;

const INVENTORY_REL = path.join("docs", "cursor-native-audit.md");
const FEATURES_REL = path.join("docs", "cursor-3-features.md");

export type CursorAwarenessStatus =
  | "current"
  | "gaps-found"
  | "skipped-disabled"
  | "skipped-interval"
  | "error";

export type CursorAwarenessSeverity = "info" | "advisory" | "stale";

export type CursorAwarenessRoute = "backlog-add" | "dogfood" | "none";

export interface CursorUpdateCheckPrefs {
  enabled: boolean;
  intervalDays: number;
  lastCheckedAt: string | null;
  lastSeenCursorVersion: string | null;
  changelogUrl: string;
}

export interface CursorAwarenessGap {
  id: string;
  severity: CursorAwarenessSeverity;
  path: string;
  evidence: string;
  suggestedRoute: CursorAwarenessRoute;
}

export interface CursorAwarenessResult {
  status: CursorAwarenessStatus;
  /** Always false: check never applies kit or IDE changes. */
  applyRecommended: false;
  /** Always false: never auto Field Reports. */
  fieldReportRecommended: false;
  inventoryPath: string;
  featuresPath: string;
  changelogUrl: string | null;
  latestCursorVersion: string | null;
  lastSeenCursorVersion: string | null;
  inventoryRefreshed: string | null;
  openActionIds: string[];
  gaps: CursorAwarenessGap[];
  message: string;
  conveyorHint: string;
}

export interface CursorAwarenessOptions {
  /** When true, honor cursorUpdateCheck.enabled + intervalDays. */
  respectPrefs?: boolean;
  /** Persist lastCheckedAt / lastSeenCursorVersion after a successful network or inventory check. */
  stamp?: boolean;
  /** Skip network changelog fetch; inventory-only advisory. */
  offline?: boolean;
  /** Override changelog URL (HTTPS). */
  changelogUrl?: string;
  /** Injected changelog body (tests). */
  changelogBody?: string;
  /** Injected fetch implementation (tests). */
  fetchText?: (url: string) => Promise<string>;
}

const DEFAULT_PREFS: CursorUpdateCheckPrefs = {
  enabled: false,
  intervalDays: 7,
  lastCheckedAt: null,
  lastSeenCursorVersion: null,
  changelogUrl: DEFAULT_CURSOR_CHANGELOG_URL,
};

const CONVEYOR_HINT =
  "Confirmed gaps: Ask HITL then `/backlog-add` or `/dogfood` (lane-aware). Never auto Field Reports. Native-audit version prose owned by parked Marketplace plan.";

export function readCursorUpdateCheckPrefs(config: unknown): CursorUpdateCheckPrefs {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ...DEFAULT_PREFS };
  }
  const raw = (config as Record<string, unknown>).cursorUpdateCheck;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_PREFS };
  }
  const uc = raw as Record<string, unknown>;
  const intervalDays =
    typeof uc.intervalDays === "number" && Number.isInteger(uc.intervalDays) && uc.intervalDays >= 1
      ? uc.intervalDays
      : DEFAULT_PREFS.intervalDays;
  const changelogUrl =
    typeof uc.changelogUrl === "string" && uc.changelogUrl.startsWith("https://")
      ? uc.changelogUrl
      : DEFAULT_PREFS.changelogUrl;
  return {
    enabled: uc.enabled === true,
    intervalDays,
    lastCheckedAt: typeof uc.lastCheckedAt === "string" ? uc.lastCheckedAt : null,
    lastSeenCursorVersion:
      typeof uc.lastSeenCursorVersion === "string" ? uc.lastSeenCursorVersion : null,
    changelogUrl,
  };
}

function intervalElapsed(lastCheckedAt: string | null, intervalDays: number): boolean {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  if (Number.isNaN(last)) return true;
  return Date.now() - last >= intervalDays * 24 * 60 * 60 * 1000;
}

async function loadContextConfig(cwd: string): Promise<Record<string, unknown> | null> {
  const configPath = path.join(cwd, ".cursor", "context", "config.json");
  return readJson<Record<string, unknown>>(configPath);
}

/** Persist cursorUpdateCheck prefs; refuses implausible lastSeenCursorVersion values. */
export async function stampCursorUpdateCheck(
  cwd: string,
  patch: { lastSeenCursorVersion?: string | null },
): Promise<void> {
  const configPath = path.join(cwd, ".cursor", "context", "config.json");
  const existing = (await loadContextConfig(cwd)) ?? {};
  const prev =
    existing.cursorUpdateCheck && typeof existing.cursorUpdateCheck === "object"
      ? { ...(existing.cursorUpdateCheck as Record<string, unknown>) }
      : {};
  const nextSeen =
    patch.lastSeenCursorVersion !== undefined ? patch.lastSeenCursorVersion : undefined;
  // Refuse to persist implausible versions (e.g. CSS 49.511) as the baseline.
  if (nextSeen !== undefined && nextSeen !== null && !isPlausibleCursorVersion(nextSeen)) {
    existing.cursorUpdateCheck = {
      ...DEFAULT_PREFS,
      ...prev,
      lastCheckedAt: new Date().toISOString(),
    };
    await writeJson(configPath, existing);
    return;
  }
  existing.cursorUpdateCheck = {
    ...DEFAULT_PREFS,
    ...prev,
    lastCheckedAt: new Date().toISOString(),
    ...(nextSeen !== undefined ? { lastSeenCursorVersion: nextSeen } : {}),
  };
  await writeJson(configPath, existing);
}

/** True when major is in the plausible Cursor product range (rejects CSS/layout noise). */
export function isPlausibleCursorVersion(version: string): boolean {
  const parts = String(version).split(".");
  if (parts.length < 2 || parts.length > 3) return false;
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = parts.length === 3 ? Number(parts[2]) : 0;
  if ([major, minor, patch].some((n) => Number.isNaN(n) || n < 0)) return false;
  if (major >= 2000 || major > CURSOR_VERSION_MAJOR_MAX) return false;
  if (minor > 999 || patch > 999) return false;
  return true;
}

/** Extract highest plausible Cursor product version from changelog HTML/text. */
export function extractLatestCursorVersion(changelogText: string): string | null {
  const text = String(changelogText ?? "");
  const candidates: string[] = [];

  const push = (major: string, minor: string, patch?: string) => {
    const version = patch !== undefined ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
    if (isPlausibleCursorVersion(version)) candidates.push(version);
  };

  // Prefer cursor.com/changelog release labels: <span class="label">3.11</span>
  for (const m of text.matchAll(/<span class="label">(\d+)\.(\d+)(?:\.(\d+))?<\/span>/gi)) {
    push(m[1] ?? "", m[2] ?? "", m[3]);
  }

  // Plain-text / markdown changelog lines: "3.6 May 29 · Changelog"
  for (const m of text.matchAll(
    /\b(\d+)\.(\d+)(?:\.(\d+))?\b(?=[^\n]{0,48}(?:Changelog|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/gi,
  )) {
    push(m[1] ?? "", m[2] ?? "", m[3]);
  }

  // Fallback: any plausible token (never CSS/layout majors like 49.511).
  if (candidates.length === 0) {
    for (const m of text.matchAll(/\b(\d+)\.(\d+)(?:\.(\d+))?\b/g)) {
      push(m[1] ?? "", m[2] ?? "", m[3]);
    }
  }

  let best: string | null = null;
  let bestScore = -1;
  for (const version of candidates) {
    const parts = version.split(".").map(Number);
    const score = (parts[0] ?? 0) * 1_000_000 + (parts[1] ?? 0) * 1_000 + (parts[2] ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = version;
    }
  }
  return best;
}

/** Compare loose Cursor product versions (X.Y or X.Y.Z). Returns -1 / 0 / 1. */
export function compareCursorVersion(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number(p));
  const pb = b.split(".").map((p) => Number(p));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (Number.isNaN(da) || Number.isNaN(db)) return 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/** Parse `last refreshed **YYYY-MM-DD**` from the inventory intro. */
export function parseInventoryRefreshed(markdown: string): string | null {
  const m = markdown.match(/last refreshed\s+\*\*(\d{4}-\d{2}-\d{2})\*\*/i);
  return m?.[1] ?? null;
}

/** Open action-item IDs from the Action items table (`| ID | Open |`). */
export function parseOpenActionIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\|\s*([A-Z]\d+)\s*\|\s*Open\s*\|/i);
    if (m?.[1]) ids.push(m[1]);
  }
  return ids;
}

/** Feature names from the cursor-3-features table (first column). */
export function parseFeatureMapNames(markdown: string): string[] {
  const names: string[] = [];
  let inTable = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("| Feature |")) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (!line.startsWith("|")) break;
      if (line.includes("---")) continue;
      const cells = line.split("|").map((c) => c.trim());
      const name = cells[1];
      if (name && name.toLowerCase() !== "feature") names.push(name);
    }
  }
  return names;
}

async function defaultFetchText(url: string): Promise<string> {
  if (!url.startsWith("https://")) {
    throw new Error(`Refusing non-HTTPS changelog URL: ${url}`);
  }
  const res = await fetch(url, {
    headers: { Accept: "text/html,text/plain;q=0.9,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(CHANGELOG_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Changelog fetch failed: HTTP ${res.status}`);
  }
  return res.text();
}

function baseResult(
  partial: Omit<
    CursorAwarenessResult,
    "applyRecommended" | "fieldReportRecommended" | "conveyorHint"
  >,
): CursorAwarenessResult {
  return {
    ...partial,
    applyRecommended: false,
    fieldReportRecommended: false,
    conveyorHint: CONVEYOR_HINT,
  };
}

/**
 * Advisory Cursor product-update awareness check.
 * Diffs changelog / inventory signals; never applies; never recommends Field Reports.
 */
export async function checkCursorUpdateAwareness(
  cwd: string,
  options: CursorAwarenessOptions = {},
): Promise<CursorAwarenessResult> {
  const inventoryPath = path.join(cwd, INVENTORY_REL);
  const featuresPath = path.join(cwd, FEATURES_REL);
  const prefs = readCursorUpdateCheckPrefs(await loadContextConfig(cwd));
  const changelogUrl = options.changelogUrl ?? prefs.changelogUrl;

  if (options.respectPrefs) {
    if (!prefs.enabled) {
      return baseResult({
        status: "skipped-disabled",
        inventoryPath: INVENTORY_REL,
        featuresPath: FEATURES_REL,
        changelogUrl,
        latestCursorVersion: null,
        lastSeenCursorVersion: prefs.lastSeenCursorVersion,
        inventoryRefreshed: null,
        openActionIds: [],
        gaps: [],
        message:
          "cursorUpdateCheck.enabled is false (opt-in). Set true in .cursor/context/config.json to nudge.",
      });
    }
    if (!intervalElapsed(prefs.lastCheckedAt, prefs.intervalDays)) {
      return baseResult({
        status: "skipped-interval",
        inventoryPath: INVENTORY_REL,
        featuresPath: FEATURES_REL,
        changelogUrl,
        latestCursorVersion: null,
        lastSeenCursorVersion: prefs.lastSeenCursorVersion,
        inventoryRefreshed: null,
        openActionIds: [],
        gaps: [],
        message: `Within cursorUpdateCheck.intervalDays (${prefs.intervalDays}); last check ${prefs.lastCheckedAt}.`,
      });
    }
  }

  let inventoryMd: string;
  try {
    inventoryMd = await readFile(inventoryPath, "utf8");
  } catch {
    return baseResult({
      status: "error",
      inventoryPath: INVENTORY_REL,
      featuresPath: FEATURES_REL,
      changelogUrl,
      latestCursorVersion: null,
      lastSeenCursorVersion: prefs.lastSeenCursorVersion,
      inventoryRefreshed: null,
      openActionIds: [],
      gaps: [],
      message: `Missing inventory at ${INVENTORY_REL}.`,
    });
  }

  const inventoryRefreshed = parseInventoryRefreshed(inventoryMd);
  const openActionIds = parseOpenActionIds(inventoryMd);
  const gaps: CursorAwarenessGap[] = [];

  for (const id of openActionIds) {
    gaps.push({
      id: `open-action-${id}`,
      severity: "advisory",
      path: INVENTORY_REL,
      evidence: `Action item ${id} is Open in the native-audit inventory`,
      suggestedRoute: "backlog-add",
    });
  }

  if (inventoryRefreshed) {
    const refreshedMs = Date.parse(inventoryRefreshed);
    if (!Number.isNaN(refreshedMs)) {
      const ageDays = (Date.now() - refreshedMs) / (24 * 60 * 60 * 1000);
      if (ageDays > 45) {
        gaps.push({
          id: "inventory-stale",
          severity: "stale",
          path: INVENTORY_REL,
          evidence: `Inventory last refreshed ${inventoryRefreshed} (>45 days). Version-prose refresh owned by parked Marketplace plan; awareness reports only.`,
          suggestedRoute: "none",
        });
      }
    }
  }

  try {
    const featuresMd = await readFile(featuresPath, "utf8");
    if (parseFeatureMapNames(featuresMd).length === 0) {
      gaps.push({
        id: "features-map-empty",
        severity: "info",
        path: FEATURES_REL,
        evidence: "Secondary feature map has no Feature table rows",
        suggestedRoute: "none",
      });
    }
  } catch {
    gaps.push({
      id: "features-map-missing",
      severity: "info",
      path: FEATURES_REL,
      evidence: "Secondary feature map missing; changelog/inventory check continues",
      suggestedRoute: "none",
    });
  }

  let latestCursorVersion: string | null = null;
  if (!options.offline) {
    try {
      const body =
        options.changelogBody ?? (await (options.fetchText ?? defaultFetchText)(changelogUrl));
      latestCursorVersion = extractLatestCursorVersion(body);
      if (
        latestCursorVersion &&
        prefs.lastSeenCursorVersion &&
        compareCursorVersion(latestCursorVersion, prefs.lastSeenCursorVersion) > 0
      ) {
        gaps.push({
          id: "changelog-ahead",
          severity: "advisory",
          path: changelogUrl,
          evidence: `Changelog latest ${latestCursorVersion} is ahead of lastSeenCursorVersion ${prefs.lastSeenCursorVersion}`,
          suggestedRoute: "backlog-add",
        });
      } else if (latestCursorVersion && !prefs.lastSeenCursorVersion) {
        gaps.push({
          id: "changelog-baseline",
          severity: "info",
          path: changelogUrl,
          evidence: `Changelog latest ${latestCursorVersion}; no lastSeenCursorVersion baseline yet (stamp to baseline)`,
          suggestedRoute: "none",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return baseResult({
        status: "error",
        inventoryPath: INVENTORY_REL,
        featuresPath: FEATURES_REL,
        changelogUrl,
        latestCursorVersion: null,
        lastSeenCursorVersion: prefs.lastSeenCursorVersion,
        inventoryRefreshed,
        openActionIds,
        gaps,
        message: `Changelog fetch error: ${msg}`,
      });
    }
  }

  if (options.stamp) {
    await stampCursorUpdateCheck(cwd, {
      lastSeenCursorVersion: latestCursorVersion ?? prefs.lastSeenCursorVersion,
    });
  }

  const status: CursorAwarenessStatus = gaps.length > 0 ? "gaps-found" : "current";
  const message =
    status === "current"
      ? "No advisory Cursor-update gaps vs inventory (check-only)."
      : `Found ${gaps.length} advisory gap(s). ${CONVEYOR_HINT}`;

  return baseResult({
    status,
    inventoryPath: INVENTORY_REL,
    featuresPath: FEATURES_REL,
    changelogUrl: options.offline ? null : changelogUrl,
    latestCursorVersion,
    lastSeenCursorVersion: prefs.lastSeenCursorVersion,
    inventoryRefreshed,
    openActionIds,
    gaps,
    message,
  });
}
