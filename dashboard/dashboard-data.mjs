#!/usr/bin/env node
// dashboard/dashboard-data.mjs
// Data fetcher for Startup Kit Dashboard
// Scans .cursor/plans, HANDOFF, memory, config, git status, terminals, processes
// Outputs JSON to stdout (consumed by dashboard.html)

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  MAX_STRING,
  MAX_REPO_ROOT,
  truncateStr,
  parseGitStatusShort,
  allowlistConfig,
} from './lib/guards.mjs';
import {
  parseHandoffMarkdown,
  buildMissionControlView,
  detectAwaitingPrompt,
  parseExternalReport,
  EXTERNAL_REPORT_FILE_RE,
  MAX_AGENT_PROMPTS,
  MAX_GIT_ACTIVITY,
} from './lib/semantic-model.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const MAX_TERMINALS = 20;
const MAX_PROCESSES = 25;
const MAX_TERMINAL_BYTES = 64 * 1024;
const MAX_LAST_OUTPUT_LINES = 15;
const MAX_LAST_OUTPUT_CHARS = 1200;

// Agent-prompt scan bounds (fs half of the detection contract in semantic-model.mjs).
const MAX_TRANSCRIPT_FILES = 60; // cap directory reads per snapshot
const MAX_TRANSCRIPT_BYTES = 1024 * 1024; // skip oversized transcripts, degrade quietly
const TRANSCRIPT_RECENCY_MS = 30 * 24 * 60 * 60 * 1000; // 30-day recency window

// External review report scan bounds (fs half of the triage contract).
const MAX_REPORT_FILES = 20; // cap memory reads per snapshot
const MAX_REPORT_BYTES = 512 * 1024; // skip oversized reports, degrade quietly
const REPORT_RECENCY_MS = 90 * 24 * 60 * 60 * 1000; // 90-day recency window

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
      const sep = match.includes('=') ? '=' : ':';
      const key = match.split(sep)[0];
      return `${key}${sep}***`;
    });
  }
  return out;
}

/** Last N lines of terminal body after YAML header, char-capped and redacted. */
function extractLastOutput(rawContent) {
  const lines = rawContent.split('\n');
  let headerEnd = 0;
  let dashCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      dashCount++;
      if (dashCount === 2) {
        headerEnd = i + 1;
        break;
      }
    }
  }
  if (headerEnd === 0) headerEnd = 10;

  const bodyLines = lines.slice(headerEnd).filter((l) => l.trim() && !l.startsWith('---'));
  if (bodyLines.length === 0) return null;

  const tail = bodyLines.slice(-MAX_LAST_OUTPUT_LINES);
  let text = redactTerminalOutput(tail.join('\n'));
  text = truncateStr(text, MAX_LAST_OUTPUT_CHARS);
  return text && text.trim() ? text : null;
}

const SNAPSHOT = {
  _schema: {
    version: '1.2.0',
    description: 'Mission Control dashboard data model',
    fields: {
      generatedAt: 'ISO-8601 timestamp of snapshot generation',
      dashboardDataVersion: 'Semantic version of the data model schema',
      plans: 'Active plans from .cursor/plans/*.plan.md with frontmatter parsing',
      system: 'System metadata: handoff state, allowlisted config summary, package info, version, name, repoRoot, contextPacks',
      agents: 'Agent definitions from .cursor/agents/*.md',
      commands: 'Slash commands from .cursor/commands/*.md',
      memory: 'Memory records: error count, decision count, recent decisions',
      git: 'Git repository state: branch, dirty status, commit, ahead/behind, bounded files[]',
      terminals: 'Active Cursor terminal sessions with metadata, output line count, and capped lastOutput',
      processes: 'Running process snapshots (node, serve.mjs, git operations)',
      skills: 'Available skills discovered in .cursor/skills/',
      health: 'Aggregated health status with per-check results',
      missionControl:
        'Normalized now/activity/attention/plans view model (source-backed; bounded)',
    },
  },
  generatedAt: new Date().toISOString(),
  dashboardDataVersion: '1.2.0',
  plans: [],
  system: {},
  agents: [],
  commands: [],
  memory: {},
  git: {},
  terminals: [],
  processes: [],
  skills: [],
  health: { status: 'ok', checks: [] },
  missionControl: null,
};

// 1. Plans
const plansDir = join(ROOT, '.cursor', 'plans');
if (existsSync(plansDir)) {
  const files = readdirSync(plansDir).filter(f => f.endsWith('.plan.md'));
  for (const file of files) {
    const content = readFileSync(join(plansDir, file), 'utf-8');
    const stats = statSync(join(plansDir, file));
    const todos = [];
    let overview = '';
    let name = file.replace(/\.plan\.md$/, '');

    // Parse frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim();
      const overviewMatch = fm.match(/^overview:\s*"(.+)"$/m);
      if (overviewMatch) overview = overviewMatch[1];

      // Parse todos
      const todoRegex = /^\s*-\s+id:\s*(\S+)\s*\n\s*content:\s*"(.+)"\s*\n\s*status:\s*(\S+)/gm;
      let m;
      while ((m = todoRegex.exec(fm)) !== null) {
        todos.push({ id: m[1], content: m[2], status: m[3] });
      }
    }

    const totalTodos = todos.length;
    const doneTodos = todos.filter(t => t.status === 'completed').length;
    const progress = totalTodos > 0 ? Math.round((doneTodos / totalTodos) * 100) : 0;

    SNAPSHOT.plans.push({
      id: name,
      file,
      path: `.cursor/plans/${file}`,
      overview,
      progress,
      todos: {
        total: totalTodos,
        completed: doneTodos,
        pending: todos.filter(t => t.status === 'pending').length,
        inProgress: todos.filter(t => t.status === 'in_progress').length,
        items: todos,
      },
      modifiedAt: stats.mtime.toISOString(),
    });
  }
}

// 2. HANDOFF (rich parse for Mission Control now/attention)
const handoffPath = join(ROOT, '.cursor', 'HANDOFF.md');
if (existsSync(handoffPath)) {
  const content = readFileSync(handoffPath, 'utf-8');
  const handoff = parseHandoffMarkdown(content);
  if (handoff) SNAPSHOT.system.handoff = handoff;
}

// 3. Agents
const agentsDir = join(ROOT, '.cursor', 'agents');
if (existsSync(agentsDir)) {
  const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const content = readFileSync(join(agentsDir, file), 'utf-8');
    const name = file.replace(/\.md$/, '');
    const descMatch = content.match(/(?:description|summary|#+ .+?)\n*([^#\n]{30,200})/);
    SNAPSHOT.agents.push({
      id: name,
      file,
      path: `.cursor/agents/${file}`,
      description: descMatch ? descMatch[1].trim().slice(0, 120) : '',
    });
  }
}

// 4. Commands
const commandsDir = join(ROOT, '.cursor', 'commands');
if (existsSync(commandsDir)) {
  const files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const name = file.replace(/\.md$/, '');
    SNAPSHOT.commands.push({ id: name, file, path: `.cursor/commands/${file}` });
  }
}

// 5. Memory
const memoryErrorsDir = join(ROOT, '.cursor', 'memory', 'errors');
const memoryDecisionsDir = join(ROOT, '.cursor', 'memory', 'decisions');
if (existsSync(memoryErrorsDir)) {
  SNAPSHOT.memory.errors = readdirSync(memoryErrorsDir).filter(f => f.endsWith('.md')).length;
}
if (existsSync(memoryDecisionsDir)) {
  const files = readdirSync(memoryDecisionsDir).filter(f => f.endsWith('.md'));
  SNAPSHOT.memory.decisions = files.length;
  SNAPSHOT.memory.recentDecisions = files.slice(-5).reverse().map(f => ({
    id: f.replace(/\.md$/, ''),
    path: `.cursor/memory/decisions/${f}`,
  }));
}

// 6. Git
try {
  const gitOpts = { cwd: ROOT, encoding: 'utf-8', timeout: 5000 };
  const branch = execSync('git rev-parse --abbrev-ref HEAD', gitOpts).trim();
  const status = execSync('git status --short', gitOpts).trim();
  const lastCommit = execSync('git log -1 --oneline', gitOpts).trim();
  let ahead = 0;
  let behind = 0;
  try {
    ahead = parseInt(execSync('git rev-list --count origin/main..HEAD', gitOpts).trim(), 10) || 0;
  } catch { /* no upstream */ }
  try {
    behind = parseInt(execSync('git rev-list --count HEAD..origin/main', gitOpts).trim(), 10) || 0;
  } catch { /* no upstream */ }

  const parsed = parseGitStatusShort(status);
  let recentLog = [];
  try {
    recentLog = execSync(`git log --oneline -n ${MAX_GIT_ACTIVITY}`, gitOpts)
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    recentLog = [];
  }

  SNAPSHOT.git = {
    branch: truncateStr(branch, MAX_STRING.branch),
    dirty: parsed.total > 0,
    dirtyCount: parsed.total,
    files: parsed.files,
    filesTruncated: parsed.truncated,
    lastCommit: truncateStr(lastCommit, MAX_STRING.lastCommit),
    ahead,
    behind,
  };
  SNAPSHOT._gitRecentLog = recentLog;
} catch {
  SNAPSHOT.git = { error: 'unable to read git state' };
  SNAPSHOT._gitRecentLog = [];
}

// 7. Terminals (read from Cursor terminal files)
const terminalsDir = resolve(process.env.HOME || '~', '.cursor', 'projects');
// Derive project path from ROOT rather than hardcoding a specific slug
const projectSlug = ROOT.replace(/\//g, '-').replace(/^-/, '');
const terminalProjectPath = join(terminalsDir, projectSlug, 'terminals');

if (existsSync(terminalProjectPath)) {
  try {
    const files = readdirSync(terminalProjectPath).filter(f => f.endsWith('.txt')).slice(0, MAX_TERMINALS);
    for (const file of files) {
      const full = join(terminalProjectPath, file);
      const raw = readFileSync(full, 'utf-8');
      // Cap huge terminal dumps: only header meta + a line count estimate is needed
      const content = raw.length > MAX_TERMINAL_BYTES ? raw.slice(0, MAX_TERMINAL_BYTES) : raw;
      const lines = content.split('\n');
      const meta = {};
      for (const line of lines.slice(0, 15)) {
        if (line.startsWith('pid:')) meta.pid = line.slice(4).trim();
        if (line.startsWith('cwd:')) meta.cwd = line.slice(4).trim();
        if (line.startsWith('command:')) meta.lastCommand = line.slice(8).trim();
        if (line.startsWith('last_command:')) meta.lastCommand = line.slice(13).trim();
        if (line.startsWith('last_exit_code:')) meta.lastExitCode = line.slice(15).trim();
      }
      const outputLines = lines.slice(10).filter(l => {
        return l.trim() && !l.startsWith('---');
      }).length;
      const lastOutput = extractLastOutput(content);
      const entry = {
        id: file,
        ...redactTerminalMeta(meta),
        outputLines,
      };
      if (lastOutput) entry.lastOutput = lastOutput;
      SNAPSHOT.terminals.push(entry);
    }
  } catch {
    // Ignore terminal read errors
  }
}

// 8. Config
const configPath = join(ROOT, '.cursor', 'context', 'config.json');
if (existsSync(configPath)) {
  try {
    const rawConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    SNAPSHOT.system.config = allowlistConfig(rawConfig);
  } catch {
    SNAPSHOT.system.config = { error: 'parse error' };
  }
}

// 9. Package.json + workspace root (for Cursor-native file open URIs)
SNAPSHOT.system.repoRoot = truncateStr(ROOT, MAX_REPO_ROOT);
const pkgPath = join(ROOT, 'package.json');
if (existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    SNAPSHOT.system.version = pkg.version;
    SNAPSHOT.system.name = pkg.name;
  } catch {
    // ignore
  }
}

// 11. Context Packs
const contextCurrentDir = join(ROOT, '.cursor', 'context', 'current');
if (existsSync(contextCurrentDir)) {
  try {
    const contextFiles = readdirSync(contextCurrentDir).filter(f => f.endsWith('.md'));
    SNAPSHOT.system.contextPacks = contextFiles.map(f => ({
      id: f.replace(/\.md$/, ''),
      file: f,
      path: `.cursor/context/current/${f}`,
    }));
  } catch {
    SNAPSHOT.system.contextPacks = [];
  }
}

// 12. Skills discovery
const skillsDir = join(ROOT, '.cursor', 'skills');
if (existsSync(skillsDir)) {
  try {
    function scanSkills(dir, category = '') {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanSkills(fullPath, entry.name);
        } else if (entry.name === 'SKILL.md') {
          const relativeDir = dir.replace(skillsDir + '/', '');
          const raw = readFileSync(fullPath, 'utf-8');
          const titleMatch = raw.match(/^# (.+)$/m);
          const descMatch = raw.match(/\n\n(.{20,200})/);
          SNAPSHOT.skills.push({
            id: relativeDir,
            category: category || 'root',
            title: titleMatch ? titleMatch[1].trim() : relativeDir.split('/').pop(),
            description: descMatch ? descMatch[1].trim().slice(0, 150) : '',
            file: fullPath.replace(ROOT + '/', ''),
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
  const psOutput = execSync('ps -axo pid=,pcpu=,pmem=,command=', {
    encoding: 'utf-8',
    timeout: 3000,
  }).trim();
  if (psOutput) {
    const interesting = [];
    for (const line of psOutput.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!/node|git|serve\.mjs|dashboard/i.test(trimmed)) continue;
      if (/grep|dashboard-data/.test(trimmed)) continue;
      const parts = trimmed.split(/\s+/);
      const pid = parts[0];
      const cpu = parts[1];
      const mem = parts[2];
      const cmd = parts.slice(3).join(' ') || 'unknown';
      let label = 'other';
      if (cmd.includes('serve.mjs') || cmd.includes('node dashboard')) label = 'dashboard-server';
      else if (/\bgit\b/.test(cmd)) label = 'git';
      else if (cmd.includes('node')) label = 'node';
      interesting.push({
        pid,
        cpu,
        mem,
        command: truncateStr(cmd, MAX_STRING.processCommand),
        label,
      });
      if (interesting.length >= MAX_PROCESSES) break;
    }
    SNAPSHOT.processes = interesting;
  }
} catch {
  SNAPSHOT.processes = [];
}

// 10. Health checks (originally)
const checks = [
  { id: 'plans', label: 'Plans directory', ok: existsSync(plansDir) && SNAPSHOT.plans.length > 0 },
  { id: 'handoff', label: 'HANDOFF.md', ok: !!SNAPSHOT.system.handoff?.plan },
  { id: 'agents', label: 'Agents', ok: SNAPSHOT.agents.length > 0 },
  { id: 'commands', label: 'Commands', ok: SNAPSHOT.commands.length > 0 },
  { id: 'memory', label: 'Memory (errors + decisions)', ok: (SNAPSHOT.memory.errors || 0) + (SNAPSHOT.memory.decisions || 0) > 0 },
  { id: 'git', label: 'Git repository', ok: !!SNAPSHOT.git.branch },
  { id: 'config', label: 'Config', ok: !!SNAPSHOT.system.config },
];

SNAPSHOT.health.checks = checks;
SNAPSHOT.health.status = checks.every(c => c.ok) ? 'ok' : checks.filter(c => !c.ok).length <= 2 ? 'warning' : 'degraded';

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
  const projectsDir = resolve(process.env.HOME || '~', '.cursor', 'projects');
  const slug = ROOT.replace(/\//g, '-').replace(/^-/, '');
  const transcriptsDir = join(projectsDir, slug, 'agent-transcripts');
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
        raw = readFileSync(candidate.file, 'utf-8');
      } catch {
        continue;
      }
      const entries = [];
      for (const line of raw.split('\n')) {
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
  const memoryDir = join(ROOT, '.cursor', 'memory');
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
        content = readFileSync(candidate.file, 'utf-8');
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

// 14. Mission Control semantic view model (now / activity / attention)
let readinessPending = [];
const readinessPath = join(ROOT, '.cursor', 'context', 'readiness.json');
if (existsSync(readinessPath)) {
  try {
    const readiness = JSON.parse(readFileSync(readinessPath, 'utf-8'));
    if (Array.isArray(readiness.pendingActions)) {
      readinessPending = readiness.pendingActions;
    }
  } catch {
    readinessPending = [];
  }
}

SNAPSHOT.missionControl = buildMissionControlView({
  plans: SNAPSHOT.plans,
  handoff: SNAPSHOT.system.handoff || null,
  gitLogLines: SNAPSHOT._gitRecentLog || [],
  terminals: SNAPSHOT.terminals,
  readinessPending,
  agentPrompts: collectAgentPrompts(),
  externalReports: collectExternalReports(),
});
delete SNAPSHOT._gitRecentLog;

process.stdout.write(JSON.stringify(SNAPSHOT, null, 2));