import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { validateHandoffText } from "../invariants/handoff-schema.js";
import { CHANGELOG_FETCH_TIMEOUT_MS } from "../lifecycle/cursor-update-awareness.js";
import {
  CURSOR_AWARENESS_NUDGE,
  DOGFOOD_INBOX_HINT,
  HARD_RULES,
  UPDATE_CHECK_NUDGE,
} from "./hard-rules.js";

const NONE_PLACEHOLDERS = new Set(["none", "n/a", "empty", "nil"]);

/** Must exceed CHANGELOG_FETCH_TIMEOUT_MS so the child can finish before parent kill. */
export const CURSOR_AWARENESS_SPAWN_TIMEOUT_MS = CHANGELOG_FETCH_TIMEOUT_MS + 3_000;

export interface SessionStartPayload {
  workspace_roots?: string[];
}

async function readTextLimited(filePath: string, limit = 60): Promise<string> {
  try {
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
    return lines.slice(0, limit).join("\n").trim();
  } catch {
    return "";
  }
}

async function readFull(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function isMarkdownTableSeparator(line: string): boolean {
  const stripped = line.trim();
  if (!stripped.startsWith("|")) return false;
  const parts = stripped
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  return parts.length > 0 && parts.every((cell) => /^:?-+:?$/.test(cell));
}

/** Match factory (`###`) and consumer (`##`) Unprocessed headings. */
export function parseUnprocessedDogfoodItems(readmeText: string): string[] {
  const items: string[] = [];
  let inSection = false;
  let sectionLevel = 0;
  const lines = readmeText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const unprocessedMatch = /^(#{2,3})\s+Unprocessed Files\b/.exec(line);
    if (unprocessedMatch) {
      const hashes = unprocessedMatch[1];
      if (!hashes) continue;
      inSection = true;
      sectionLevel = hashes.length;
      continue;
    }
    if (!inSection) continue;
    const headingMatch = /^(#{1,6})\s+/.exec(line);
    if (headingMatch) {
      // Any Processed heading ends the section (Files optional; mixed H2/H3 must not leak).
      if (/^#{1,6}\s+Processed(?:\s+Files)?\b/.test(line)) break;
      const hashes = headingMatch[1];
      if (hashes && hashes.length <= sectionLevel) break;
      continue;
    }
    // Header is the table row immediately before a separator, not a word allowlist.
    if (line.trim().startsWith("|") && isMarkdownTableSeparator(lines[i + 1] ?? "")) {
      continue;
    }
    const body = extractUnprocessedDogfoodLine(line);
    if (!body) continue;
    items.push(body);
  }
  return items;
}

/** Bullets, numbered lists, and markdown table rows (first cell). */
function extractUnprocessedDogfoodLine(line: string): string | null {
  const stripped = line.trim();
  if (!stripped) return null;

  let raw: string | null = null;
  if (stripped.startsWith("- ")) {
    raw = stripped.slice(2).trim();
  } else {
    const numbered = /^(\d+)[.)]\s+(.+)$/.exec(stripped);
    if (numbered?.[2]) {
      raw = numbered[2].trim();
    } else if (stripped.startsWith("|")) {
      if (isMarkdownTableSeparator(stripped)) return null;
      const parts = stripped
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
      if (parts.length === 0) return null;
      raw = (parts[0] ?? "").trim();
    }
  }

  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/[*_]/g, "").trim();
  if (!normalized || NONE_PLACEHOLDERS.has(normalized)) return null;
  return raw;
}

async function l0Present(root: string): Promise<boolean> {
  const cursor = path.join(root, ".cursor");
  return (
    (await fileExists(path.join(cursor, "agent-kit.json"))) ||
    (await fileExists(path.join(cursor, "commands", "agent-kit-onboard.md"))) ||
    (await fileExists(path.join(cursor, "commands", "start-project.md")))
  );
}

function checkLabelAndRecommendation(check: Record<string, unknown>): [string, string] | null {
  const checkId = check.id;
  if (typeof checkId !== "string" || !checkId) return null;
  const actions = check.actions;
  if (Array.isArray(actions)) {
    for (const action of actions) {
      if (!action || typeof action !== "object") continue;
      const a = action as Record<string, unknown>;
      if (typeof a.id === "string" && typeof a.recommendation === "string") {
        return [a.id, a.recommendation];
      }
    }
  }
  const title = check.title;
  if (typeof title === "string" && title) return [checkId, title];
  return [checkId, "Resolve this readiness check"];
}

function unresolvedReadinessChecks(data: Record<string, unknown>): {
  essential: Record<string, unknown>[];
  nonessential: Record<string, unknown>[];
} {
  const essential: Record<string, unknown>[] = [];
  const nonessential: Record<string, unknown>[] = [];
  const pillars = data.pillars;
  if (!Array.isArray(pillars)) return { essential, nonessential };
  for (const pillar of pillars) {
    if (!pillar || typeof pillar !== "object") continue;
    const checks = (pillar as Record<string, unknown>).checks;
    if (!Array.isArray(checks)) continue;
    for (const check of checks) {
      if (!check || typeof check !== "object") continue;
      const c = check as Record<string, unknown>;
      if (c.status === "ready") continue;
      if (c.essential === true) essential.push(c);
      else nonessential.push(c);
    }
  }
  return { essential, nonessential };
}

async function readinessSection(root: string): Promise<string | null> {
  const snapshotPath = path.join(root, ".cursor", "context", "readiness.json");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await readFile(snapshotPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { essential, nonessential } = unresolvedReadinessChecks(data);
  if (essential[0]) {
    const labeled = checkLabelAndRecommendation(essential[0]);
    if (!labeled) return null;
    const [actionId, recommendation] = labeled;
    return `## Repository readiness\n\nUnresolved essential check: \`${actionId}\`. ${recommendation} Run \`/agent-kit-onboard\` before \`/start-project\`. An active plan or HANDOFF remains the current work and is not replaced.`;
  }
  if (nonessential[0]) {
    const labeled = checkLabelAndRecommendation(nonessential[0]);
    if (!labeled) return null;
    const [actionId, recommendation] = labeled;
    return `## Repository readiness\n\nOptional readiness item: \`${actionId}\`. ${recommendation} This does not block \`/start-project\` or active plan work. Resume later with \`/agent-kit-onboard\` if useful.`;
  }
  const actions = data.pendingActions;
  if (!Array.isArray(actions) || !actions[0] || typeof actions[0] !== "object") return null;
  const first = actions[0] as Record<string, unknown>;
  if (typeof first.id !== "string" || typeof first.recommendation !== "string") return null;
  return `## Repository readiness\n\nOptional readiness item: \`${first.id}\`. ${first.recommendation} This does not block \`/start-project\` or active plan work. Resume later with \`/agent-kit-onboard\` if useful.`;
}

async function dogfoodInboxSection(root: string): Promise<string | null> {
  const candidateReadmes = [
    path.join(root, "dogfood", "README.md"),
    path.join(root, ".cursor", "dogfood", "README.md"),
  ];
  for (const readme of candidateReadmes) {
    if (!(await fileExists(readme))) continue;
    try {
      const text = await readFile(readme, "utf8");
      if (parseUnprocessedDogfoodItems(text).length) return DOGFOOD_INBOX_HINT;
    } catch {
      // ignore and try next
    }
  }
  return null;
}

async function loadUpdateCheckPrefs(root: string): Promise<Record<string, unknown> | null> {
  try {
    const data = JSON.parse(
      await readFile(path.join(root, ".cursor", "context", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    const uc = data.updateCheck;
    if (!uc || typeof uc !== "object" || (uc as Record<string, unknown>).enabled !== true) {
      return null;
    }
    return uc as Record<string, unknown>;
  } catch {
    return null;
  }
}

function runUpdateCheckJson(root: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        process.argv[1] ?? "",
        "update",
        "--check",
        "--json",
        "--respect-prefs",
        "--stamp",
        "--cwd",
        root,
      ],
      { stdio: ["ignore", "pipe", "ignore"], timeout: 12_000 },
    );
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(out.trim()) as Record<string, unknown>;
        resolve(parsed && typeof parsed === "object" ? parsed : null);
      } catch {
        resolve(null);
      }
    });
  });
}

async function updateCheckSection(root: string): Promise<string | null> {
  if ((await loadUpdateCheckPrefs(root)) === null) return null;
  // Prefer PATH agent-kit when available; fall back to re-invoking this binary.
  const result = await new Promise<Record<string, unknown> | null>((resolve) => {
    const child = spawn(
      "agent-kit",
      ["update", "--check", "--json", "--respect-prefs", "--stamp", "--cwd", root],
      { stdio: ["ignore", "pipe", "ignore"], timeout: 12_000, shell: false },
    );
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => {
      void runUpdateCheckJson(root).then(resolve);
    });
    child.on("close", (code) => {
      if (code !== 0 && !out.trim()) {
        void runUpdateCheckJson(root).then(resolve);
        return;
      }
      try {
        resolve(JSON.parse(out.trim()) as Record<string, unknown>);
      } catch {
        void runUpdateCheckJson(root).then(resolve);
      }
    });
  });
  if (!result || result.status !== "update-available") return null;
  if (result.applyRecommended === true) return null;
  const installed = String(result.installedVersion ?? "?");
  const latest = String(result.latestVersion ?? "?");
  return UPDATE_CHECK_NUDGE.replace("{installed}", installed).replace("{latest}", latest);
}

async function loadCursorUpdateCheckPrefs(root: string): Promise<Record<string, unknown> | null> {
  try {
    const data = JSON.parse(
      await readFile(path.join(root, ".cursor", "context", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    const uc = data.cursorUpdateCheck;
    if (!uc || typeof uc !== "object" || (uc as Record<string, unknown>).enabled !== true) {
      return null;
    }
    return uc as Record<string, unknown>;
  } catch {
    return null;
  }
}

function runCursorAwarenessJson(root: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        process.argv[1] ?? "",
        "cursor-awareness",
        "--check",
        "--json",
        "--respect-prefs",
        "--stamp",
        "--cwd",
        root,
      ],
      { stdio: ["ignore", "pipe", "ignore"], timeout: CURSOR_AWARENESS_SPAWN_TIMEOUT_MS },
    );
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(out.trim()) as Record<string, unknown>;
        resolve(parsed && typeof parsed === "object" ? parsed : null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** True when the check result warrants a sessionStart Cursor-update nudge. */
export function shouldEmitCursorAwarenessNudge(result: Record<string, unknown> | null): boolean {
  if (!result || result.status !== "gaps-found") return false;
  if (result.applyRecommended === true || result.fieldReportRecommended === true) return false;
  const gaps = Array.isArray(result.gaps) ? result.gaps : [];
  return gaps.some(
    (g) => g && typeof g === "object" && (g as { id?: string }).id === "changelog-ahead",
  );
}

export type CursorAwarenessSpawn = typeof spawn;

/**
 * sessionStart Cursor-awareness section. Primary spawn is `agent-kit`; on ENOENT /
 * empty failure, exactly one fallback via `process.execPath` + argv[1].
 * Inject `spawnFn` / `runFallback` in tests.
 */
export async function cursorAwarenessSection(
  root: string,
  deps: {
    spawnFn?: CursorAwarenessSpawn;
    runFallback?: (root: string) => Promise<Record<string, unknown> | null>;
  } = {},
): Promise<string | null> {
  if ((await loadCursorUpdateCheckPrefs(root)) === null) return null;
  const spawnFn = deps.spawnFn ?? spawn;
  const runFallback = deps.runFallback ?? runCursorAwarenessJson;
  const result = await new Promise<Record<string, unknown> | null>((resolve) => {
    let settled = false;
    let fallbackStarted = false;
    const finish = (value: Record<string, unknown> | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const startFallback = () => {
      if (settled || fallbackStarted) return;
      fallbackStarted = true;
      void runFallback(root).then(finish);
    };
    const child = spawnFn(
      "agent-kit",
      ["cursor-awareness", "--check", "--json", "--respect-prefs", "--stamp", "--cwd", root],
      {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: CURSOR_AWARENESS_SPAWN_TIMEOUT_MS,
        shell: false,
      },
    );
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => {
      startFallback();
    });
    child.on("close", (code) => {
      if (settled || fallbackStarted) return;
      if (code !== 0 && !out.trim()) {
        startFallback();
        return;
      }
      try {
        finish(JSON.parse(out.trim()) as Record<string, unknown>);
      } catch {
        startFallback();
      }
    });
  });
  if (!shouldEmitCursorAwarenessNudge(result)) return null;
  return CURSOR_AWARENESS_NUDGE;
}

export async function buildSessionStartAdditionalContext(
  rootDir: string,
  _payload: SessionStartPayload = {},
): Promise<{ additional_context: string }> {
  const root = path.resolve(rootDir);
  const handoffPath = path.join(root, ".cursor", "HANDOFF.md");
  const handoffFull = await readFull(handoffPath);
  const handoff = await readTextLimited(handoffPath);
  const parts: string[] = [HARD_RULES];

  if (await l0Present(root)) {
    const readiness = await readinessSection(root);
    if (readiness) parts.push(readiness);
  }

  const dogfood = await dogfoodInboxSection(root);
  if (dogfood) parts.push(dogfood);

  const updateNudge = await updateCheckSection(root);
  if (updateNudge) parts.push(updateNudge);

  const cursorNudge = await cursorAwarenessSection(root);
  if (cursorNudge) parts.push(cursorNudge);

  const formatWarnings = validateHandoffText(handoffFull);
  if (formatWarnings.length) {
    const bullet = formatWarnings.map((w) => `- ${w.message}`).join("\n");
    parts.push(
      `## HANDOFF format warning (Mission Control)\n\n${bullet}\n\nRewrite machine lists as \`- **Field:**\` bullets before trusting Checklist / Current mission.`,
    );
  }

  if (handoff) {
    parts.push(`## Current HANDOFF.md (excerpt)\n\n${handoff}`);
  } else {
    parts.push(
      "## HANDOFF.md\n\nNo handoff file yet. If starting work, create a plan with to-dos first (`/start-project`).",
    );
  }

  return { additional_context: parts.join("\n\n") };
}

export function resolveSessionRoot(payload: SessionStartPayload, cwd = process.cwd()): string {
  const roots = payload.workspace_roots;
  if (Array.isArray(roots) && typeof roots[0] === "string" && roots[0]) {
    return roots[0];
  }
  return cwd;
}
