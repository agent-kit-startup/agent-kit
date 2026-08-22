#!/usr/bin/env node
// dashboard/dashboard-data.mjs
// Data fetcher for Startup Kit Dashboard
// Scans .cursor/plans, HANDOFF, memory, config, git status, terminals, processes
// Outputs JSON to stdout (consumed by dashboard.html)

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  MAX_STRING,
  allowlistConfig,
  parseGitStatusShort,
  resolveSnapshotRepoRoot,
  truncateStr,
} from "./lib/guards.mjs";
import {
  EXTERNAL_REPORT_FILE_RE,
  FIELD_REPORT_CADENCE_LEDGER_REL,
  FLIGHT_LOG_LEDGER_REL,
  MAX_AGENT_PROMPTS,
  MAX_GIT_ACTIVITY,
  MISSION_TIMING_LEDGER_REL,
  SUBAGENT_TRANSCRIPT_FILE_RE,
  buildMissionControlView,
  collectDeferredCheckIds,
  collectReadinessPendingFromReport,
  describeProcess,
  detectAwaitingPrompt,
  dismissedAttentionIds,
  extractChatSnippet,
  parseCadenceLedger,
  parseExternalReport,
  parseFieldReportDismissals,
  parseFieldReportReviewCadenceConfig,
  parseFlightLogLedger,
  parseHandoffMarkdown,
  parseMissionTimingLedger,
  parseSubagentRun,
  serializeFlightLogLedger,
  serializeMissionTimingLedger,
} from "./lib/semantic-model.mjs";
import { MAX_TERMINAL_BYTES, buildTerminalSnapshotFields } from "./lib/terminal-snapshot.mjs";

const KIT_ROOT = resolve(import.meta.dirname, "..");
/** Snapshot root: consumer workspace when MISSION_CONTROL_REPO_ROOT is set, else kit tree. */
const ROOT = resolveSnapshotRepoRoot(process.env, KIT_ROOT);
const MAX_TERMINALS = 20;
const MAX_PROCESSES = 25;
const MAX_GIT_GRAPH_LINES = 25;
const MAX_GIT_GRAPH_LINE_CHARS = 160;

/** Soft wall-clock budget for optional collectors (transcripts, reports, ps). */
const SNAPSHOT_STARTED_MS = Date.now();
const SNAPSHOT_BUDGET_MS = (() => {
  const raw = process.env.AGENT_KIT_DASHBOARD_DATA_BUDGET_MS;
  const n = raw != null && raw !== "" ? Number(raw) : 12_000;
  return Number.isFinite(n) && n > 0 ? n : 12_000;
})();
function withinSnapshotBudget(reserveMs = 400) {
  return Date.now() - SNAPSHOT_STARTED_MS + reserveMs < SNAPSHOT_BUDGET_MS;
}

// Agent-prompt scan bounds (fs half of the detection contract in semantic-model.mjs).
const MAX_TRANSCRIPT_FILES = 60; // cap directory reads per snapshot
const MAX_TRANSCRIPT_BYTES = 1024 * 1024; // skip oversized transcripts, degrade quietly
const TRANSCRIPT_RECENCY_MS = 30 * 24 * 60 * 60 * 1000; // 30-day recency window

// External review report scan bounds (fs half of the triage contract).
const MAX_REPORT_FILES = 20; // cap memory reads per snapshot
const MAX_REPORT_BYTES = 512 * 1024; // skip oversized reports, degrade quietly
const REPORT_RECENCY_MS = 90 * 24 * 60 * 60 * 1000; // 90-day recency window

// Task subagent run scan bounds (fs half of the lifecycle contract).
const MAX_SUBAGENT_PARENTS = 12; // cap parent chat directories walked per snapshot
const MAX_SUBAGENT_FILES = 24; // cap worker transcripts read per snapshot
const MAX_SUBAGENT_BYTES = 512 * 1024; // skip oversized transcripts, degrade quietly
const SUBAGENT_RECENCY_MS = 6 * 60 * 60 * 1000; // 6-hour window: live feed, not an archive

/** Redact likely secrets in terminal output (paths-only git payload uses separate rules). */
const SECRET_OUTPUT_PATTERNS = [
  /(?:API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)\s*=\s*\S+/gi,
  /(?:api[_-]?key|secret|password|token|authorization)\s*[:=]\s*\S+/gi,
];

function redactTerminalMeta(meta) {
  const out = { ...meta };
  if (out.cwd) out.cwd = truncateStr(out.cwd, MAX_STRING.terminalCwd);
  if (out.lastCommand) out.lastCommand = truncateStr(out.lastCommand, MAX_STRING.terminalCommand);
  return out;
}

function redactTerminalOutput(text) {
  let out = String(text);
  for (const pat of SECRET_OUTPUT_PATTERNS) {
    out = out.replace(pat, (match) => {
      const sep = match.includes("=") ? "=" : ":";
      const key = match.split(sep)[0];
      return `${key}${sep}***`;
    });
  }
  return out;
}

const SNAPSHOT = {
  _schema: {
    version: "1.2.0",
    description: "Mission Control dashboard data model",
    fields: {
      generatedAt: "ISO-8601 timestamp of snapshot generation",
      dashboardDataVersion: "Semantic version of the data model schema",
      plans: "Active plans from .cursor/plans/*.plan.md with frontmatter parsing",
      system:
        "System metadata: repoRoot, listen port, handoff state, allowlisted config summary, package info, version, name, contextPacks, detachedAuditSessions ({count, oldestAgeSeconds}|null; host-wide detached agent-kit-audit-* PTYs)",
      agents: "Agent definitions from .cursor/agents/*.md",
      commands: "Slash commands from .cursor/commands/*.md",
      memory:
        "Memory records: error count, decision count, recent decisions, recent parsed errors, error-o-meter stats",
      git: "Git repository state: branch, dirty status, commit, ahead/behind, bounded files[], promotion flow vs staging/main, graph lines, staging hygiene",
      terminals:
        "Active Cursor terminal sessions with metadata, output line count, and capped lastOutput",
      processes:
        "Running process snapshots (node, serve.mjs, git operations) with elapsed time and a generated narration per process",
      skills: "Available skills discovered in .cursor/skills/",
      health: "Aggregated health status with per-check results",
      missionControl: "Normalized now/activity/attention/plans view model (source-backed; bounded)",
    },
  },
  generatedAt: new Date().toISOString(),
  dashboardDataVersion: "1.3.0",
  plans: [],
  system: {
    repoRoot: ROOT,
    port: Number.parseInt(process.env.PORT || "3333", 10) || 3333,
  },
  agents: [],
  commands: [],
  memory: {},
  git: {},
  terminals: [],
  processes: [],
  skills: [],
  health: { status: "ok", checks: [] },
  missionControl: null,
};

// 1. Plans
const plansDir = join(ROOT, ".cursor", "plans");
if (existsSync(plansDir)) {
  const files = readdirSync(plansDir).filter((f) => f.endsWith(".plan.md"));
  for (const file of files) {
    const content = readFileSync(join(plansDir, file), "utf-8");
    const stats = statSync(join(plansDir, file));
    const todos = [];
    let overview = "";
    let name = file.replace(/\.plan\.md$/, "");
    let agent = null;

    // Parse frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim();
      const overviewMatch = fm.match(/^overview:\s*"(.+)"$/m);
      if (overviewMatch) overview = overviewMatch[1];
      const agentMatch = fm.match(/^agent:\s*(.+)$/m);
      if (agentMatch) agent = agentMatch[1].trim().replace(/^"(.*)"$/, "$1");

      // Parse todos
      const todoRegex = /^\s*-\s+id:\s*(\S+)\s*\n\s*content:\s*"(.+)"\s*\n\s*status:\s*(\S+)/gm;
      for (const m of fm.matchAll(todoRegex)) {
        todos.push({ id: m[1], content: m[2], status: m[3] });
      }
    }

    const totalTodos = todos.length;
    const doneTodos = todos.filter((t) => t.status === "completed").length;
    const progress = totalTodos > 0 ? Math.round((doneTodos / totalTodos) * 100) : 0;

    SNAPSHOT.plans.push({
      id: name,
      file,
      path: `.cursor/plans/${file}`,
      overview,
      agent,
      progress,
      todos: {
        total: totalTodos,
        completed: doneTodos,
        pending: todos.filter((t) => t.status === "pending").length,
        inProgress: todos.filter((t) => t.status === "in_progress").length,
        items: todos,
      },
      modifiedAt: stats.mtime.toISOString(),
    });
  }
}

// 1b. Archived plans: only basenames are collected. A plan file present under
// .cursor/plans/archive/ resolves as the terminal `archived` lifecycle, so
// archiving a plan never promotes its review back into blocking attention.
const plansArchiveDir = join(plansDir, "archive");
const archivedPlanFiles = existsSync(plansArchiveDir)
  ? readdirSync(plansArchiveDir).filter((f) => f.endsWith(".plan.md"))
  : [];

// 2. HANDOFF (rich parse for Mission Control now/attention)
const handoffPath = join(ROOT, ".cursor", "HANDOFF.md");
if (existsSync(handoffPath)) {
  const content = readFileSync(handoffPath, "utf-8");
  const handoff = parseHandoffMarkdown(content);
  if (handoff) SNAPSHOT.system.handoff = handoff;
}

// 3. Agents
const agentsDir = join(ROOT, ".cursor", "agents");
if (existsSync(agentsDir)) {
  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = readFileSync(join(agentsDir, file), "utf-8");
    const name = file.replace(/\.md$/, "");
    const descMatch = content.match(/(?:description|summary|#+ .+?)\n*([^#\n]{30,200})/);
    SNAPSHOT.agents.push({
      id: name,
      file,
      path: `.cursor/agents/${file}`,
      description: descMatch ? descMatch[1].trim().slice(0, 120) : "",
    });
  }
}

// 4. Commands
const commandsDir = join(ROOT, ".cursor", "commands");
if (existsSync(commandsDir)) {
  const files = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const name = file.replace(/\.md$/, "");
    SNAPSHOT.commands.push({ id: name, file, path: `.cursor/commands/${file}` });
  }
}

// 4b. Kit-managed marker: commands, skills, and agents listed in registry/registry.json are
// owned by kit updates (read-only from the dashboard). No registry: all project-local.
const kitCommandPaths = new Set();
const kitSkillDirs = new Set();
const kitAgentPaths = new Set();
const registryFile = join(ROOT, "registry", "registry.json");
if (existsSync(registryFile)) {
  try {
    const registry = JSON.parse(readFileSync(registryFile, "utf8"));
    const entries = Array.isArray(registry?.artifacts) ? registry.artifacts : [];
    for (const entry of entries) {
      if (entry?.kind === "command" && typeof entry?.path === "string") {
        kitCommandPaths.add(entry.path);
      }
      if (
        entry?.kind === "skill" &&
        typeof entry?.path === "string" &&
        entry.path.startsWith("registry/skills/")
      ) {
        kitSkillDirs.add(entry.path.replace(/^registry\/skills\//, ".cursor/skills/"));
      }
      if (entry?.kind === "agent" && typeof entry?.path === "string") {
        kitAgentPaths.add(entry.path);
      }
    }
  } catch {
    // Unreadable registry: degrade to all-editable rather than locking everything.
  }
}
for (const c of SNAPSHOT.commands) {
  c.kitManaged = kitCommandPaths.has(c.path);
}
for (const a of SNAPSHOT.agents) {
  a.kitManaged = kitAgentPaths.has(a.path);
}

// 5. Memory
const memoryErrorsDir = join(ROOT, ".cursor", "memory", "errors");
const memoryDecisionsDir = join(ROOT, ".cursor", "memory", "decisions");
const MAX_MEMORY_RECENT_ERRORS = 12; // cap parsed entries shipped per snapshot
const MAX_MEMORY_ERROR_BYTES = 64 * 1024; // skip oversized entries, degrade quietly

/** Parse one `.cursor/memory/errors/*.md` entry into the KPI-friendly shape. */
function parseMemoryErrorFile(dir, file) {
  const id = file.replace(/\.md$/, "");
  const path = `.cursor/memory/errors/${file}`;
  const full = join(dir, file);
  let modifiedAt = null;
  try {
    modifiedAt = statSync(full).mtime.toISOString();
  } catch {
    modifiedAt = null;
  }
  let raw = "";
  try {
    raw = readFileSync(full, "utf-8").slice(0, MAX_MEMORY_ERROR_BYTES);
  } catch {
    return {
      id,
      path,
      title: id,
      date: "",
      error: "",
      cause: "",
      solution: "",
      files: "",
      tags: [],
      modifiedAt,
    };
  }
  const field = (...names) => {
    for (const name of names) {
      const m = raw.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.+)$`, "im"));
      if (m) return truncateStr(m[1].trim(), 600);
    }
    return "";
  };
  const titleMatch = raw.match(/^#\s+(.+)$/m);
  const tags = field("Tags")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    id,
    path,
    title: titleMatch ? truncateStr(titleMatch[1].trim(), 200) : id,
    date: field("Date", "Data"),
    error: field("Error", "Erro"),
    cause: field("Cause", "Causa"),
    solution: field("Solution", "Solução", "Solucao"),
    files: field("Files", "Arquivos"),
    tags,
    modifiedAt,
  };
}

/** Error-o-meter aggregates: counts, rates, and top tags across parsed entries. */
function computeMemoryErrorStats(entries) {
  const total = entries.length;
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const last30d = entries.filter((e) => {
    const t = Date.parse(e.date || e.modifiedAt || "");
    return Number.isFinite(t) && now - t <= 30 * DAY_MS;
  }).length;
  const weeklyRate = Math.round((last30d / 30) * 7 * 10) / 10;
  const tagCounts = new Map();
  for (const e of entries) {
    for (const t of e.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([tag, count]) => ({ tag, count }));
  return { total, last30d, weeklyRate, topTags };
}

if (existsSync(memoryErrorsDir)) {
  const errorFiles = readdirSync(memoryErrorsDir).filter((f) => f.endsWith(".md"));
  SNAPSHOT.memory.errors = errorFiles.length;
  SNAPSHOT.memory.errorEntries = errorFiles.map((f) => {
    const id = f.replace(/\.md$/, "");
    let modifiedAt = null;
    try {
      modifiedAt = statSync(join(memoryErrorsDir, f)).mtime.toISOString();
    } catch {
      modifiedAt = null;
    }
    return { id, modifiedAt };
  });
  const parsedErrors = errorFiles
    .map((f) => parseMemoryErrorFile(memoryErrorsDir, f))
    .sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)));
  SNAPSHOT.memory.recentErrors = parsedErrors.slice(0, MAX_MEMORY_RECENT_ERRORS);
  SNAPSHOT.memory.errorStats = computeMemoryErrorStats(parsedErrors);
}
if (existsSync(memoryDecisionsDir)) {
  const files = readdirSync(memoryDecisionsDir).filter((f) => f.endsWith(".md"));
  SNAPSHOT.memory.decisions = files.length;
  SNAPSHOT.memory.decisionEntries = files.map((f) => {
    const id = f.replace(/\.md$/, "");
    let modifiedAt = null;
    try {
      modifiedAt = statSync(join(memoryDecisionsDir, f)).mtime.toISOString();
    } catch {
      modifiedAt = null;
    }
    return { id, modifiedAt };
  });
  SNAPSHOT.memory.recentDecisions = files
    .slice(-5)
    .reverse()
    .map((f) => ({
      id: f.replace(/\.md$/, ""),
      path: `.cursor/memory/decisions/${f}`,
    }));
}

// 6. Git
try {
  const gitOpts = { cwd: ROOT, encoding: "utf-8", timeout: 5000 };
  const branch = execSync("git rev-parse --abbrev-ref HEAD", gitOpts).trim();
  const status = execSync("git status --short", gitOpts).trim();
  const lastCommit = execSync("git log -1 --oneline", gitOpts).trim();
  let ahead = 0;
  let behind = 0;
  try {
    ahead =
      Number.parseInt(execSync("git rev-list --count origin/main..HEAD", gitOpts).trim(), 10) || 0;
  } catch {
    /* no upstream */
  }
  try {
    behind =
      Number.parseInt(execSync("git rev-list --count HEAD..origin/main", gitOpts).trim(), 10) || 0;
  } catch {
    /* no upstream */
  }

  const parsed = parseGitStatusShort(status);
  let recentLog = [];
  try {
    recentLog = execSync(`git log --oneline -n ${MAX_GIT_ACTIVITY}`, gitOpts)
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    recentLog = [];
  }

  // Promotion flow state: ahead/behind of HEAD vs BOTH origin/staging and
  // origin/main, plus staging vs main (pending promotion count).
  const countDivergence = (range) => {
    try {
      const out = execSync(`git rev-list --left-right --count ${range}`, gitOpts).trim();
      const [left, right] = out.split(/\s+/).map((n) => Number.parseInt(n, 10) || 0);
      return { ahead: right, behind: left };
    } catch {
      return null;
    }
  };
  const flow = {
    vsStaging: countDivergence("origin/staging...HEAD"),
    vsMain: countDivergence("origin/main...HEAD"),
    stagingVsMain: countDivergence("origin/main...origin/staging"),
  };

  // Readable graph (branch lanes + merges) as pre-rendered text lines.
  let graphLines = [];
  try {
    graphLines = execSync(
      `git log --graph --oneline --decorate --date-order --all -n ${MAX_GIT_GRAPH_LINES}`,
      gitOpts,
    )
      .trimEnd()
      .split("\n")
      .filter(Boolean)
      .map((line) => truncateStr(line, MAX_GIT_GRAPH_LINE_CHARS));
  } catch {
    graphLines = [];
  }

  // Staging hygiene: untracked plan-monitor WIP (add-by-name only, never a
  // broad git add of .cursor/memory/; ADR 2026-07-29 staging hygiene R14/R15).
  const monitorWip = parsed.files
    .filter((f) => f.untracked && /^\.cursor\/memory\/plan-monitor-.+\.md$/.test(f.path))
    .map((f) => f.path);

  SNAPSHOT.git = {
    branch: truncateStr(branch, MAX_STRING.branch),
    dirty: parsed.total > 0,
    dirtyCount: parsed.total,
    files: parsed.files,
    filesTruncated: parsed.truncated,
    lastCommit: truncateStr(lastCommit, MAX_STRING.lastCommit),
    ahead,
    behind,
    flow,
    graph: graphLines,
    hygiene: { monitorWip },
  };
  SNAPSHOT._gitRecentLog = recentLog;
} catch {
  SNAPSHOT.git = { error: "unable to read git state" };
  SNAPSHOT._gitRecentLog = [];
}

// 7. Terminals (read from Cursor terminal files)
const terminalsDir = resolve(process.env.HOME || "~", ".cursor", "projects");
// Derive project path from ROOT rather than hardcoding a specific slug
const projectSlug = ROOT.replace(/\//g, "-").replace(/^-/, "");
const terminalProjectPath = join(terminalsDir, projectSlug, "terminals");

if (existsSync(terminalProjectPath)) {
  try {
    const files = readdirSync(terminalProjectPath)
      .filter((f) => f.endsWith(".txt"))
      .slice(0, MAX_TERMINALS);
    for (const file of files) {
      const full = join(terminalProjectPath, file);
      const raw = readFileSync(full, "utf-8");
      // Meta from file head; body/output from tail-cap so over-cap terminals keep pid/cwd/exit
      // (plain tail-slice previously dropped the header and blanked exit-code dots).
      const { meta, outputLines, lastOutput } = buildTerminalSnapshotFields(raw, {
        maxBytes: MAX_TERMINAL_BYTES,
        redact: redactTerminalOutput,
        truncate: truncateStr,
      });
      const entry = {
        id: file,
        ...redactTerminalMeta(meta),
        outputLines,
      };
      // File mtime feeds the busy-outside-plan freshness window (semantic model).
      try {
        entry.updatedAt = statSync(full).mtime.toISOString();
      } catch {
        // Missing mtime only disables the busy freshness signal for this terminal.
      }
      if (lastOutput) entry.lastOutput = lastOutput;
      SNAPSHOT.terminals.push(entry);
    }
  } catch {
    // Ignore terminal read errors
  }
}

// 8. Config
const configPath = join(ROOT, ".cursor", "context", "config.json");
if (existsSync(configPath)) {
  try {
    const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    SNAPSHOT.system.config = allowlistConfig(rawConfig);
  } catch {
    SNAPSHOT.system.config = { error: "parse error" };
  }
}

// 9. Package.json
const pkgPath = join(ROOT, "package.json");
if (existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    SNAPSHOT.system.version = pkg.version;
    SNAPSHOT.system.name = pkg.name;
  } catch {
    // ignore
  }
}

// 11. Context Packs
const contextCurrentDir = join(ROOT, ".cursor", "context", "current");
if (existsSync(contextCurrentDir)) {
  try {
    const contextFiles = readdirSync(contextCurrentDir).filter((f) => f.endsWith(".md"));
    SNAPSHOT.system.contextPacks = contextFiles.map((f) => ({
      id: f.replace(/\.md$/, ""),
      file: f,
      path: `.cursor/context/current/${f}`,
    }));
  } catch {
    SNAPSHOT.system.contextPacks = [];
  }
}

// 12. Skills discovery
const skillsDir = join(ROOT, ".cursor", "skills");
if (existsSync(skillsDir)) {
  try {
    function scanSkills(dir, category = "") {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanSkills(fullPath, entry.name);
        } else if (entry.name === "SKILL.md") {
          const relativeDir = dir.replace(`${skillsDir}/`, "");
          const raw = readFileSync(fullPath, "utf-8");
          const titleMatch = raw.match(/^# (.+)$/m);
          const descMatch = raw.match(/\n\n(.{20,200})/);
          SNAPSHOT.skills.push({
            id: relativeDir,
            category: category || "root",
            title: titleMatch ? titleMatch[1].trim() : relativeDir.split("/").pop(),
            description: descMatch ? descMatch[1].trim().slice(0, 150) : "",
            file: fullPath.replace(`${ROOT}/`, ""),
            kitManaged: kitSkillDirs.has(`.cursor/skills/${relativeDir}`),
          });
        }
      }
    }
    scanSkills(skillsDir);
  } catch {
    // Ignore skills scan errors
  }
}

// 13. Process scanning (capped list: the UI only needs a sample of relevant procs)
try {
  if (!withinSnapshotBudget(500)) {
    SNAPSHOT.processes = [];
  } else {
    const psOutput = execSync("ps -axo pid=,pcpu=,pmem=,etime=,command=", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (psOutput) {
      const interesting = [];
      for (const line of psOutput.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (!/node|git|serve\.mjs|dashboard/i.test(trimmed)) continue;
        if (/grep|dashboard-data/.test(trimmed)) continue;
        const parts = trimmed.split(/\s+/);
        const pid = parts[0];
        const cpu = parts[1];
        const mem = parts[2];
        const etime = parts[3];
        const cmd = parts.slice(4).join(" ") || "unknown";
        let label = "other";
        if (cmd.includes("serve.mjs") || cmd.includes("node dashboard")) label = "dashboard-server";
        else if (/\bgit\b/.test(cmd)) label = "git";
        else if (cmd.includes("node")) label = "node";
        interesting.push({
          pid,
          cpu,
          mem,
          etime,
          command: truncateStr(cmd, MAX_STRING.processCommand),
          label,
          description: describeProcess({ label, command: cmd, cpu, etime }),
        });
        if (interesting.length >= MAX_PROCESSES) break;
      }
      SNAPSHOT.processes = interesting;
    }
  }
} catch {
  SNAPSHOT.processes = [];
}

// 13b. Detached audit-session visibility (plan phase3-visibility).
// Mirrors the sessionStart hook semantics (packages/cli/src/hooks/session-start.ts):
// whole agent-kit-audit- namespace (any token, legacy unscoped names included),
// detached sessions only; attached sessions are operator work and never counted.
// Fail-open: null when zero sessions or tmux/screen is missing/errors.
SNAPSHOT.system.detachedAuditSessions = null;
try {
  if (withinSnapshotBudget(400)) {
    const auditAges = [];
    const nowEpoch = Math.floor(Date.now() / 1000);
    try {
      const tmuxOut = execSync(
        "tmux list-sessions -F '#{session_name} #{session_attached} #{session_created}'",
        { encoding: "utf-8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] },
      );
      for (const line of tmuxOut.split("\n")) {
        const m = line.trim().match(/^(\S+)\s+(\d+)\s+(\d+)$/);
        if (!m) continue;
        if (!m[1].startsWith("agent-kit-audit-")) continue;
        if (Number(m[2]) > 0) continue;
        const created = Number(m[3]);
        auditAges.push(nowEpoch >= created ? nowEpoch - created : -1);
      }
    } catch {
      // tmux missing or no server: fail-open
    }
    try {
      // `screen -ls` exits 1 while successfully listing, so soften the exit code.
      const screenOut = execSync("screen -ls || true", {
        encoding: "utf-8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      // The "N Sockets in <dir>." line trails the session list; socket mtime ~ start time.
      let sockdir = null;
      for (const line of screenOut.split("\n")) {
        const dirMatch = line.match(/^\d+\s+Sockets?\s+in\s+(.+)\.$/);
        if (dirMatch) sockdir = dirMatch[1];
      }
      for (const line of screenOut.split("\n")) {
        const m = line.match(/^\s+(\d+)\.(\S+)\s+\((.*)\)/);
        if (!m) continue;
        if (!m[2].startsWith("agent-kit-audit-")) continue;
        // "Detached" has a single t before "ached", so it never matches [Aa]ttached.
        if (/[Aa]ttached/.test(m[3])) continue;
        let age = -1;
        if (sockdir) {
          try {
            const mtimeMs = statSync(join(sockdir, `${m[1]}.${m[2]}`)).mtimeMs;
            if (Date.now() >= mtimeMs) age = Math.floor((Date.now() - mtimeMs) / 1000);
          } catch {
            // socket not stat-able: age stays unknown, session still counted
          }
        }
        auditAges.push(age);
      }
    } catch {
      // screen missing: fail-open
    }
    if (auditAges.length > 0) {
      const known = auditAges.filter((a) => a >= 0);
      SNAPSHOT.system.detachedAuditSessions = {
        count: auditAges.length,
        oldestAgeSeconds: known.length ? Math.max(...known) : null,
      };
    }
  }
} catch {
  SNAPSHOT.system.detachedAuditSessions = null;
}

// 10. Health checks (originally)
const checks = [
  { id: "plans", label: "Plans directory", ok: existsSync(plansDir) && SNAPSHOT.plans.length > 0 },
  // Present + parseable HANDOFF is healthy even when Plan is none/null (idle).
  { id: "handoff", label: "HANDOFF.md", ok: !!SNAPSHOT.system.handoff },
  // L0-optional: empty .cursor/agents/ is healthy (packs/skills may add agents later).
  { id: "agents", label: "Agents", ok: true },
  { id: "commands", label: "Commands", ok: SNAPSHOT.commands.length > 0 },
  {
    id: "memory",
    label: "Memory (errors + decisions)",
    ok: (SNAPSHOT.memory.errors || 0) + (SNAPSHOT.memory.decisions || 0) > 0,
  },
  { id: "git", label: "Git repository", ok: !!SNAPSHOT.git.branch },
  { id: "config", label: "Config", ok: !!SNAPSHOT.system.config },
];

SNAPSHOT.health.checks = checks;
SNAPSHOT.health.status = checks.every((c) => c.ok)
  ? "ok"
  : checks.filter((c) => !c.ok).length <= 2
    ? "warning"
    : "degraded";

/**
 * Agent-prompt detection contract (fs half).
 *
 * The project transcript store lives at
 * `~/.cursor/projects/<project-slug>/agent-transcripts/<id>/<id>.jsonl`, where
 * `<project-slug>` is the repo root path with slashes turned into dashes (the
 * same derivation used for the terminals directory). Each `<id>` directory
 * holds one main transcript file named after the id; nested `subagents/`
 * transcripts are ignored so a worker question never masquerades as a user
 * prompt. The scan is read-only and bounded: it skips transcripts outside a
 * 30-day recency window, skips files larger than the byte cap, reads at most
 * MAX_TRANSCRIPT_FILES of the most recent, and returns at most
 * MAX_AGENT_PROMPTS items. The awaiting-a-reply decision itself lives in
 * `detectAwaitingPrompt`. A missing or unreadable store yields an empty list,
 * never an error state.
 */
function collectAgentPrompts() {
  if (!withinSnapshotBudget(800)) return [];
  const projectsDir = resolve(process.env.HOME || "~", ".cursor", "projects");
  const slug = ROOT.replace(/\//g, "-").replace(/^-/, "");
  const transcriptsDir = join(projectsDir, slug, "agent-transcripts");
  if (!existsSync(transcriptsDir)) return [];

  const prompts = [];
  try {
    const now = Date.now();
    const candidates = [];
    for (const dirent of readdirSync(transcriptsDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const id = dirent.name;
      const file = join(transcriptsDir, id, `${id}.jsonl`);
      if (!existsSync(file)) continue;
      let stat;
      try {
        stat = statSync(file);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs > TRANSCRIPT_RECENCY_MS) continue;
      if (stat.size > MAX_TRANSCRIPT_BYTES) continue;
      candidates.push({ id, file, mtime: stat.mtime });
    }
    candidates.sort((a, b) => b.mtime - a.mtime);

    for (const candidate of candidates.slice(0, MAX_TRANSCRIPT_FILES)) {
      let raw;
      try {
        raw = readFileSync(candidate.file, "utf-8");
      } catch {
        continue;
      }
      const entries = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed));
        } catch {
          // Ignore a malformed line; a partial write must not drop the transcript.
        }
      }
      const awaiting = detectAwaitingPrompt(entries);
      if (!awaiting) continue;
      prompts.push({
        chatId: candidate.id,
        label: awaiting.label,
        // Untruncated detection value for lifecycle clear (FR-SAC-01); not rendered.
        labelFull: awaiting.labelFull,
        chatSnippet: extractChatSnippet(entries),
        quietAt: candidate.mtime.toISOString(),
      });
      if (prompts.length >= MAX_AGENT_PROMPTS) break;
    }
  } catch {
    return [];
  }
  return prompts;
}

/**
 * External review report scan (fs half).
 *
 * Reports written by `/plan-external-review` live directly in
 * `.cursor/memory/` as `plan-monitor-<slug>.md`. The scan is read-only and
 * bounded: it skips reports outside a 90-day recency window, skips files
 * larger than the byte cap, and reads at most MAX_REPORT_FILES of the most
 * recent; `buildExternalReportItems` then caps the surfaced items at
 * MAX_EXTERNAL_REPORTS. The triaged-or-not decision itself
 * lives in `isReportTriaged`. A missing or unreadable `.cursor/memory/`
 * directory yields an empty list, never an error state.
 */
function collectExternalReports() {
  if (!withinSnapshotBudget(600)) return [];
  const memoryDir = join(ROOT, ".cursor", "memory");
  if (!existsSync(memoryDir)) return [];

  const reports = [];
  try {
    const now = Date.now();
    const candidates = [];
    for (const name of readdirSync(memoryDir)) {
      if (!EXTERNAL_REPORT_FILE_RE.test(name)) continue;
      const file = join(memoryDir, name);
      let stat;
      try {
        stat = statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > REPORT_RECENCY_MS) continue;
      if (stat.size > MAX_REPORT_BYTES) continue;
      candidates.push({ name, file, mtime: stat.mtime });
    }
    candidates.sort((a, b) => b.mtime - a.mtime);

    for (const candidate of candidates.slice(0, MAX_REPORT_FILES)) {
      let content;
      try {
        content = readFileSync(candidate.file, "utf-8");
      } catch {
        continue;
      }
      const report = parseExternalReport({
        file: candidate.name,
        content,
        modifiedAt: candidate.mtime.toISOString(),
      });
      if (!report) continue;
      reports.push(report);
    }
  } catch {
    return [];
  }
  return reports;
}

/**
 * Task subagent run scan (fs half of the lifecycle contract).
 *
 * Worker transcripts live beside the main chat transcript, at
 * `~/.cursor/projects/<project-slug>/agent-transcripts/<parent>/subagents/<id>.jsonl`
 * — the same store `collectAgentPrompts` walks, whose nested `subagents/`
 * directories it deliberately skips so a worker question never masquerades as a
 * user prompt. This scan reads only those nested files.
 *
 * Read-only and bounded: parents outside a 6-hour recency window are skipped
 * (the Crew Monitor is a live feed, not an archive), at most
 * MAX_SUBAGENT_PARENTS parent directories and MAX_SUBAGENT_FILES transcripts are
 * read, oversized transcripts are skipped, and only the first and last records
 * of each file are parsed — the phase decision needs the dispatch prompt and the
 * terminal record, nothing between. A missing or unreadable store yields an
 * empty list, never an error state. The phase/actor decision itself lives in
 * `parseSubagentRun`.
 */
function collectSubagentRuns() {
  if (!withinSnapshotBudget(700)) return [];
  const projectsDir = resolve(process.env.HOME || "~", ".cursor", "projects");
  const slug = ROOT.replace(/\//g, "-").replace(/^-/, "");
  const transcriptsDir = join(projectsDir, slug, "agent-transcripts");
  if (!existsSync(transcriptsDir)) return [];

  const runs = [];
  try {
    const now = Date.now();
    const candidates = [];
    for (const dirent of readdirSync(transcriptsDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const subDir = join(transcriptsDir, dirent.name, "subagents");
      if (!existsSync(subDir)) continue;
      let dirStat;
      try {
        dirStat = statSync(subDir);
      } catch {
        continue;
      }
      if (now - dirStat.mtimeMs > SUBAGENT_RECENCY_MS) continue;
      candidates.push({ parentId: dirent.name, dir: subDir, mtime: dirStat.mtimeMs });
    }
    candidates.sort((a, b) => b.mtime - a.mtime);

    const files = [];
    for (const parent of candidates.slice(0, MAX_SUBAGENT_PARENTS)) {
      let names;
      try {
        names = readdirSync(parent.dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const match = SUBAGENT_TRANSCRIPT_FILE_RE.exec(name);
        if (!match) continue;
        const file = join(parent.dir, name);
        let stat;
        try {
          stat = statSync(file);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        if (now - stat.mtimeMs > SUBAGENT_RECENCY_MS) continue;
        if (stat.size > MAX_SUBAGENT_BYTES) continue;
        files.push({ id: match[1], parentId: parent.parentId, file, mtime: stat.mtime });
      }
    }
    files.sort((a, b) => b.mtime - a.mtime);

    for (const candidate of files.slice(0, MAX_SUBAGENT_FILES)) {
      let raw;
      try {
        raw = readFileSync(candidate.file, "utf-8");
      } catch {
        continue;
      }
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length === 0) continue;
      const run = parseSubagentRun({
        id: candidate.id,
        parentId: candidate.parentId,
        firstLine: lines[0],
        lastLine: lines[lines.length - 1],
        modifiedAt: candidate.mtime.toISOString(),
      });
      if (run) runs.push(run);
    }
  } catch {
    return [];
  }
  return runs;
}

// 14. Mission Control semantic view model (now / activity / attention)
let readinessPending = [];
const readinessPath = join(ROOT, ".cursor", "context", "readiness.json");
if (existsSync(readinessPath)) {
  try {
    const readiness = JSON.parse(readFileSync(readinessPath, "utf-8"));
    readinessPending = collectReadinessPendingFromReport(readiness);
  } catch {
    readinessPending = [];
  }
}

/**
 * Explicit non-essential deferrals from config (checkId + reason).
 * allowlistConfig strips deferredItems from the public snapshot; Mission Control
 * still needs them so Checklist can clear advisories without inventing ready.
 */
function collectOnboardingDeferredCheckIds() {
  if (!existsSync(configPath)) return [];
  try {
    const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    return collectDeferredCheckIds(rawConfig);
  } catch {
    return [];
  }
}

/**
 * Local Field Report dismissals (IDs only). Missing or unreadable file → [].
 * Path is gitignored like readiness.json; never carries transcript body.
 */
function collectFieldReportDismissedIds() {
  const dismissalsPath = join(ROOT, ".cursor", "context", "field-report-dismissals.json");
  if (!existsSync(dismissalsPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(dismissalsPath, "utf-8"));
    return dismissedAttentionIds(parseFieldReportDismissals(raw));
  } catch {
    return [];
  }
}

/**
 * Local Current mission timing ledger. Missing or unreadable → empty ledger.
 * Gitignored observation store; not a UI mutation API.
 */
function collectMissionTimingLedger() {
  const ledgerPath = join(ROOT, MISSION_TIMING_LEDGER_REL);
  if (!existsSync(ledgerPath)) return parseMissionTimingLedger(null);
  try {
    const raw = JSON.parse(readFileSync(ledgerPath, "utf-8"));
    return parseMissionTimingLedger(raw);
  } catch {
    return parseMissionTimingLedger(null);
  }
}

/**
 * Field Report activity cadence ledger. Missing or unreadable → empty.
 * Agents bump via field-report-cadence-bump.sh; dashboard only reads.
 */
function collectCadenceLedger() {
  const ledgerPath = join(ROOT, FIELD_REPORT_CADENCE_LEDGER_REL);
  if (!existsSync(ledgerPath)) return parseCadenceLedger(null);
  try {
    const raw = JSON.parse(readFileSync(ledgerPath, "utf-8"));
    return parseCadenceLedger(raw);
  } catch {
    return parseCadenceLedger(null);
  }
}

/** Cadence config from local config.json (defaults when missing). */
function collectCadenceConfig() {
  if (!existsSync(configPath)) return parseFieldReportReviewCadenceConfig(null);
  try {
    const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    return parseFieldReportReviewCadenceConfig(rawConfig);
  } catch {
    return parseFieldReportReviewCadenceConfig(null);
  }
}

/** Persist ledger only when serialized content changes (avoids SSE watch loops). */
function persistMissionTimingLedger(nextLedger) {
  const ledgerPath = join(ROOT, MISSION_TIMING_LEDGER_REL);
  const nextText = serializeMissionTimingLedger(nextLedger);
  let prevText = "";
  if (existsSync(ledgerPath)) {
    try {
      prevText = readFileSync(ledgerPath, "utf-8");
    } catch {
      prevText = "";
    }
  }
  if (prevText === nextText) return;
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, nextText, "utf-8");
}

/** Flight Log history ledger (past Gaps). Write-on-change like mission timing. */
function collectFlightLogLedger() {
  const ledgerPath = join(ROOT, FLIGHT_LOG_LEDGER_REL);
  if (!existsSync(ledgerPath)) return parseFlightLogLedger(null);
  try {
    const raw = JSON.parse(readFileSync(ledgerPath, "utf-8"));
    return parseFlightLogLedger(raw);
  } catch {
    return parseFlightLogLedger(null);
  }
}

function persistFlightLogLedger(nextLedger) {
  const ledgerPath = join(ROOT, FLIGHT_LOG_LEDGER_REL);
  const nextText = serializeFlightLogLedger(nextLedger);
  let prevText = "";
  if (existsSync(ledgerPath)) {
    try {
      prevText = readFileSync(ledgerPath, "utf-8");
    } catch {
      prevText = "";
    }
  }
  if (prevText === nextText) return;
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, nextText, "utf-8");
}

/** Prior inventory baseline from serve.mjs (JSON); cold start → no inventory events. */
function readPreviousInventory() {
  const raw = process.env.AGENT_KIT_PREV_INVENTORY;
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

{
  const missionControl = buildMissionControlView({
    plans: SNAPSHOT.plans,
    handoff: SNAPSHOT.system.handoff || null,
    gitLogLines: SNAPSHOT._gitRecentLog || [],
    terminals: SNAPSHOT.terminals,
    readinessPending,
    deferredCheckIds: collectOnboardingDeferredCheckIds(),
    agentPrompts: collectAgentPrompts(),
    externalReports: collectExternalReports(),
    subagentRuns: collectSubagentRuns(),
    dismissedIds: collectFieldReportDismissedIds(),
    archivedPlanFiles,
    agents: SNAPSHOT.agents,
    skills: SNAPSHOT.skills,
    commands: SNAPSHOT.commands,
    memory: SNAPSHOT.memory,
    previousInventory: readPreviousInventory(),
    timingLedger: collectMissionTimingLedger(),
    flightLogLedger: collectFlightLogLedger(),
    cadenceLedger: collectCadenceLedger(),
    cadenceConfig: collectCadenceConfig(),
  });
  persistMissionTimingLedger(missionControl.timingLedger);
  persistFlightLogLedger(missionControl.flightLogLedger);
  // Do not expose the writable ledger blobs on the public snapshot wire.
  const {
    timingLedger: _timingLedger,
    flightLogLedger: _flightLogLedger,
    ...missionControlPublic
  } = missionControl;
  SNAPSHOT.missionControl = missionControlPublic;
}
SNAPSHOT._gitRecentLog = undefined;

process.stdout.write(JSON.stringify(SNAPSHOT, null, 2));
