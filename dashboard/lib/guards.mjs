// dashboard/lib/guards.mjs
// Pure helpers for Mission Control snapshot redaction and serve lockdown (testable).

import { resolve } from 'node:path';

export const DEFAULT_HOST = '127.0.0.1';

export const MAX_STRING = {
  branch: 64,
  lastCommit: 120,
  terminalCwd: 200,
  terminalCommand: 120,
  processCommand: 80,
};

export const MAX_GIT_FILES = 50;
export const MAX_GIT_PATH = 240;
export const MAX_REPO_ROOT = 400;

/** Repo-relative path safe to join onto a trusted root (no traversal / schemes). */
export function isSafeRepoRelativePath(relPath) {
  if (typeof relPath !== 'string') return false;
  const p = relPath.trim().replace(/\\/g, '/');
  if (!p || p.length > MAX_GIT_PATH) return false;
  if (p.startsWith('/') || /^[A-Za-z]:\//.test(p)) return false;
  if (p.includes('\0') || p.includes('://')) return false;
  const parts = p.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  return true;
}

/** Join trusted absolute repo root with a safe relative path, or null. */
export function joinRepoRoot(repoRoot, relPath) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) return null;
  if (!isSafeRepoRelativePath(relPath)) return null;
  const root = repoRoot.trim().replace(/[/\\]+$/, '').replace(/\\/g, '/');
  const rel = relPath.trim().replace(/\\/g, '/');
  return `${root}/${rel}`;
}

/**
 * Build Cursor / VS Code file URIs for opening a local absolute path in the IDE.
 * Simple Browser may hand these to the host protocol handler; external browsers vary.
 */
export function buildEditorFileUris(absPath) {
  if (typeof absPath !== 'string' || !absPath.trim()) return null;
  let normalized = absPath.trim().replace(/\\/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  return {
    vscode: `vscode://file${normalized}`,
    cursor: `cursor://file${normalized}`,
  };
}

export function resolveBindHost(envHost) {
  return envHost || DEFAULT_HOST;
}

export function truncateStr(value, maxLen) {
  if (value == null) return value;
  const s = String(value);
  return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
}

/** Parse `git status --short` into bounded file entries (paths only, no contents). */
export function parseGitStatusShort(output) {
  if (!output || !String(output).trim()) {
    return { files: [], total: 0, truncated: false };
  }
  const lines = String(output)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0);
  const files = [];
  let truncated = false;

  for (const line of lines) {
    if (files.length >= MAX_GIT_FILES) {
      truncated = true;
      break;
    }
    if (line.length < 3) continue;

    const status = line.slice(0, 2);
    let rest = line.slice(2).trimStart();
    if (!rest) continue;

    let path = rest;
    let oldPath = null;
    if (rest.includes(' -> ')) {
      const arrowIdx = rest.indexOf(' -> ');
      oldPath = rest.slice(0, arrowIdx).trim();
      path = rest.slice(arrowIdx + 4).trim() || oldPath;
    }

    const untracked = status === '??' || status[0] === '?' || status[1] === '?';
    const staged = !untracked && status[0] !== ' ' && status[0] !== '?';
    const unstaged = !untracked && status[1] !== ' ' && status[1] !== '?';

    const entry = {
      path: truncateStr(path, MAX_GIT_PATH),
      status,
      staged,
      unstaged,
      untracked,
    };
    if (oldPath) {
      entry.oldPath = truncateStr(oldPath, MAX_GIT_PATH);
      entry.renamed = status[0] === 'R' || status[1] === 'R' || status[0] === 'C' || status[1] === 'C';
    }

    files.push(entry);
  }

  return { files, total: lines.length, truncated };
}

/** Export only safe, UI-relevant config fields (no full nested onboarding checks). */
export function allowlistConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'invalid' };
  }
  const summary = {};
  if (typeof raw.onboarded === 'boolean') summary.onboarded = raw.onboarded;
  if (typeof raw.autoHandoff === 'boolean') summary.autoHandoff = raw.autoHandoff;
  if (raw.onboarding && typeof raw.onboarding === 'object') {
    summary.onboarding = {
      status: typeof raw.onboarding.status === 'string' ? raw.onboarding.status : 'unknown',
      contractVersion: raw.onboarding.contractVersion,
    };
  }
  if (raw.externalPlanReview && typeof raw.externalPlanReview === 'object') {
    summary.externalPlanReview = { enabled: !!raw.externalPlanReview.enabled };
  }
  if (raw.workspaceSkin && typeof raw.workspaceSkin === 'object') {
    const modes = {};
    if (raw.workspaceSkin.modes && typeof raw.workspaceSkin.modes === 'object') {
      for (const [mode, skin] of Object.entries(raw.workspaceSkin.modes)) {
        modes[mode] = truncateStr(skin, 64);
      }
    }
    summary.workspaceSkin = {
      default: truncateStr(raw.workspaceSkin.default, 64),
      modes,
    };
  }
  return summary;
}

export function isAllowedOrigin(origin, port) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const resolvedPort = url.port || (url.protocol === 'https:' ? '443' : '80');
    return (
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      resolvedPort === String(port)
    );
  } catch {
    return false;
  }
}

export function applyCorsHeaders(req, res, port) {
  const origin = req.headers?.origin;
  if (isAllowedOrigin(origin, port)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    return true;
  }
  return false;
}

export function isUnderDashboard(resolvedPath, dashboardReal) {
  return resolvedPath === dashboardReal || resolvedPath.startsWith(`${dashboardReal}/`);
}

/**
 * Resolve a static pathname to an absolute file under dashboardReal, or null if blocked.
 * fs hooks default to node:fs for production; tests may inject mocks.
 */
export function resolveDashboardStatic(
  pathname,
  { dashboardDir, dashboardReal, existsSync, realpathSync },
) {
  let rel = pathname;
  if (rel === '/' || rel === '') {
    rel = '/dashboard.html';
  }

  if (!rel.startsWith('/') || rel.includes('..') || rel.includes('\\')) {
    return null;
  }

  for (const segment of rel.split('/').filter(Boolean)) {
    if (segment.startsWith('.')) {
      return null;
    }
  }

  const candidate = resolve(dashboardDir, `.${rel}`);
  if (!isUnderDashboard(candidate, dashboardReal)) {
    return null;
  }

  if (!existsSync(candidate)) {
    return null;
  }

  try {
    const fileReal = realpathSync(candidate);
    if (!isUnderDashboard(fileReal, dashboardReal)) {
      return null;
    }
    return fileReal;
  } catch {
    return null;
  }
}
