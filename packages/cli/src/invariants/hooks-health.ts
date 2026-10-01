import { execFile } from "node:child_process";
import { constants, access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  CLAUDE_SETTINGS_REL,
  GUARD_SHELL_HOOK_MARKER,
  RESOLVE_AGENT_KIT_REL,
  SESSION_START_HOOK_MARKER,
} from "../generator/claude-session-start-hook.js";

const execFileAsync = promisify(execFile);

export type HooksHealthStatus = "active" | "degraded" | "missing";

/** Canonical kit hook scripts compared against installed `.git/hooks/` copies. */
export const GIT_HOOK_CANONICAL_NAMES = ["pre-commit", "pre-push", "prepare-commit-msg"] as const;

export interface HooksHealthReport {
  status: HooksHealthStatus;
  reasons: string[];
  /** Soft advisories (e.g. git-hooks install drift). Do not flip status alone. */
  advisories: string[];
  hooksJsonPath: string;
  expectedEvents: string[];
  wiredEvents: string[];
}

const EXPECTED_EVENTS = [
  "sessionStart",
  "preCompact",
  "beforeShellExecution",
  "afterFileEdit",
  "beforeSubmitPrompt",
] as const;

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** True when `agent-kit` resolves via PATH, local bin, or dogfood dist. */
export async function resolveAgentKitCli(rootDir: string): Promise<string | null> {
  const root = path.resolve(rootDir);
  const candidates = [
    path.join(root, "node_modules", ".bin", "agent-kit"),
    path.join(root, "packages", "cli", "dist", "index.js"),
  ];
  for (const c of candidates) {
    if (await exists(c)) return c;
  }
  try {
    const { stdout } = await execFileAsync("which", ["agent-kit"], { encoding: "utf8" });
    const hit = stdout.trim().split("\n")[0]?.trim();
    if (hit) return hit;
  } catch {
    /* not on PATH */
  }
  return null;
}

function commandLooksLikeAdapter(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  // Prefer `.cursor/hooks/agent/*.sh` paths from hooks.json.
  const m = trimmed.match(/(\.cursor\/hooks\/agent\/[A-Za-z0-9._-]+\.sh)\b/);
  return m?.[1] ?? null;
}

/**
 * Soft advisory: compare versioned `git-hooks/*` to installed `.git/hooks/*`.
 * Install is operator `cp` (see git-hooks/README.md); drift does not degrade status.
 * When `core.hooksPath` already points at `git-hooks`, skip (no install copy).
 */
export async function assessGitHooksInstallDrift(rootDir: string): Promise<string[]> {
  const root = path.resolve(rootDir);
  const canonicalDir = path.join(root, "git-hooks");
  if (!(await exists(canonicalDir))) return [];

  let hooksPathCfg = "";
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "config", "--get", "core.hooksPath"],
      { encoding: "utf8" },
    );
    hooksPathCfg = stdout.trim();
  } catch {
    /* unset or not a git repo */
  }
  if (hooksPathCfg) {
    const resolved = path.isAbsolute(hooksPathCfg)
      ? path.normalize(hooksPathCfg)
      : path.normalize(path.join(root, hooksPathCfg));
    if (resolved === path.normalize(canonicalDir)) {
      return [];
    }
  }

  const gitDir = path.join(root, ".git");
  if (!(await exists(gitDir))) return [];
  // Worktree / bare: `.git` may be a file; only compare when hooks live under `.git/hooks`.
  try {
    const st = await stat(gitDir);
    if (!st.isDirectory()) return [];
  } catch {
    return [];
  }

  const installedDir = path.join(gitDir, "hooks");
  const advisories: string[] = [];
  const installHint =
    "Install or refresh with: `cp git-hooks/<name> .git/hooks/<name> && chmod +x .git/hooks/<name>` (see git-hooks/README.md)";

  let names: string[] = [...GIT_HOOK_CANONICAL_NAMES];
  try {
    const listed = await readdir(canonicalDir);
    const fromDisk = listed.filter((n) =>
      (GIT_HOOK_CANONICAL_NAMES as readonly string[]).includes(n),
    );
    if (fromDisk.length > 0) names = fromDisk;
  } catch {
    /* use default names */
  }

  for (const name of names) {
    const canonical = path.join(canonicalDir, name);
    const installed = path.join(installedDir, name);
    if (!(await exists(canonical))) continue;
    if (!(await exists(installed))) {
      advisories.push(
        `git-hooks drift: \`.git/hooks/${name}\` missing (canonical \`git-hooks/${name}\` present). ${installHint}`,
      );
      continue;
    }
    try {
      const [a, b] = await Promise.all([readFile(canonical, "utf8"), readFile(installed, "utf8")]);
      if (a !== b) {
        advisories.push(
          `git-hooks drift: \`.git/hooks/${name}\` differs from \`git-hooks/${name}\`. ${installHint}`,
        );
      }
    } catch {
      advisories.push(
        `git-hooks drift: could not compare \`git-hooks/${name}\` with \`.git/hooks/${name}\`. ${installHint}`,
      );
    }
  }

  return advisories;
}

/**
 * Soft advisory: the /git-staging signature gate runs `sh git-hooks/prepare-commit-msg --check -`
 * and a missing file exits 127 (red). `assessGitHooksInstallDrift` returns early when
 * `git-hooks/` is absent, so consumers never saw it. Kit marker = `autogit/gitupdate.md`
 * (the staging routine that runs the gate); silent without it.
 */
export async function assessSignatureGateHook(rootDir: string): Promise<string[]> {
  const root = path.resolve(rootDir);
  if (!(await exists(path.join(root, "autogit", "gitupdate.md")))) return [];
  if (await exists(path.join(root, "git-hooks", "prepare-commit-msg"))) return [];
  return [
    "signature gate hook missing: `git-hooks/prepare-commit-msg` (/git-staging runs `sh git-hooks/prepare-commit-msg --check -`; a missing file exits 127 and reads as red). Run `agent-kit update` to restore it.",
  ];
}

/** Same order as `resolve-agent-kit.sh`; returns argv (`[bin]` or `["node", script]`) or null. */
async function resolveGuardProbeArgv(root: string): Promise<string[] | null> {
  const hookBin = process.env.AGENT_KIT_HOOK_BIN;
  if (hookBin && (await isExecutable(hookBin))) return [hookBin];
  const local = path.join(root, "node_modules", ".bin", "agent-kit");
  if (await isExecutable(local)) return [local];
  const dist = path.join(root, "packages", "cli", "dist", "index.js");
  if (await exists(dist)) return [process.execPath, dist];
  try {
    const { stdout } = await execFileAsync("which", ["agent-kit"], { encoding: "utf8" });
    const hit = stdout.trim().split("\n")[0]?.trim();
    if (hit) return [hit];
  } catch {
    /* not on PATH */
  }
  return null;
}

/**
 * Capability probe for the Claude PreToolUse(Bash) guard. Silent when
 * `.claude/settings.json` is absent or unreadable. With the guard marker present, runs
 * the resolved CLI on a force-push to main and requires a `deny` decision; an older
 * or stale CLI would fail open at runtime, so this surfaces it. SessionStart marker
 * without the guard marker means the settings predate the guard hook.
 */
export async function assessClaudeGuardProbe(rootDir: string): Promise<string[]> {
  const root = path.resolve(rootDir);
  let text: string;
  try {
    text = await readFile(path.join(root, CLAUDE_SETTINGS_REL), "utf8");
  } catch {
    return [];
  }
  if (!text.includes(GUARD_SHELL_HOOK_MARKER)) {
    return text.includes(SESSION_START_HOOK_MARKER)
      ? [
          "Claude SessionStart hook is installed but the PreToolUse guard hook is absent from `.claude/settings.json`. Run `agent-kit install --claude`.",
        ]
      : [];
  }
  const stale =
    "Claude guard hook active but resolved CLI is too old or stale dist; update the CLI / rebuild.";
  const argv = await resolveGuardProbeArgv(root);
  if (!argv) return [`${stale} (agent-kit CLI not resolvable)`];
  const [bin, ...lead] = argv as [string, ...string[]];
  try {
    const { stdout } = await execFileAsync(
      bin,
      [
        ...lead,
        "guard",
        "shell",
        "--format",
        "claude",
        "--command",
        "git push --force origin main",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, ALLOW_MAIN_PUSH: "" },
      },
    );
    const decision = (
      JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecision?: string } }
    ).hookSpecificOutput?.permissionDecision;
    return decision === "deny" ? [] : [stale];
  } catch {
    return [stale];
  }
}

/**
 * Visible fail-open posture: active when hooks.json wires Node adapters that
 * exist, are executable, and the CLI resolves; degraded otherwise; missing
 * when no hooks.json. Git-hooks install drift is advisory only.
 */
export async function assessHooksHealth(rootDir: string): Promise<HooksHealthReport> {
  const root = path.resolve(rootDir);
  const hooksJsonPath = ".cursor/hooks.json";
  const hooksJsonAbs = path.join(root, hooksJsonPath);
  const reasons: string[] = [];
  const wiredEvents: string[] = [];
  const advisories = [
    ...(await assessGitHooksInstallDrift(root)),
    ...(await assessSignatureGateHook(root)),
    ...(await assessClaudeGuardProbe(root)),
  ];

  if (!(await exists(hooksJsonAbs))) {
    return {
      status: "missing",
      reasons: ["`.cursor/hooks.json` not found"],
      advisories,
      hooksJsonPath,
      expectedEvents: [...EXPECTED_EVENTS],
      wiredEvents,
    };
  }

  let parsed: { hooks?: Record<string, unknown[]> };
  try {
    parsed = JSON.parse(await readFile(hooksJsonAbs, "utf8")) as {
      hooks?: Record<string, unknown[]>;
    };
  } catch {
    return {
      status: "degraded",
      reasons: ["`.cursor/hooks.json` is not valid JSON"],
      advisories,
      hooksJsonPath,
      expectedEvents: [...EXPECTED_EVENTS],
      wiredEvents,
    };
  }

  const hooks = parsed.hooks ?? {};
  const adapterRels = new Set<string>();

  for (const event of EXPECTED_EVENTS) {
    const list = hooks[event];
    if (Array.isArray(list) && list.length > 0) {
      wiredEvents.push(event);
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const command = String((entry as { command?: string }).command ?? "");
        if (command.endsWith(".py") || command.includes("python")) {
          reasons.push(`${event} still points at a Python script (${command})`);
        }
        const rel = commandLooksLikeAdapter(command);
        if (rel) adapterRels.add(rel);
      }
    } else {
      reasons.push(`missing hook event: ${event}`);
    }
  }

  const resolveLib = path.join(root, RESOLVE_AGENT_KIT_REL);
  if (!(await exists(resolveLib))) {
    reasons.push(`missing \`${RESOLVE_AGENT_KIT_REL}\` (thin adapter resolver)`);
  } else if (!(await isExecutable(resolveLib))) {
    reasons.push(`\`${RESOLVE_AGENT_KIT_REL}\` is not executable (chmod +x)`);
  }

  for (const rel of adapterRels) {
    const abs = path.join(root, rel);
    if (!(await exists(abs))) {
      reasons.push(`missing adapter script: \`${rel}\``);
      continue;
    }
    try {
      const st = await stat(abs);
      if (!st.isFile()) {
        reasons.push(`adapter path is not a file: \`${rel}\``);
        continue;
      }
    } catch {
      reasons.push(`unreadable adapter script: \`${rel}\``);
      continue;
    }
    if (!(await isExecutable(abs))) {
      reasons.push(`adapter not executable: \`${rel}\` (chmod +x)`);
    }
  }

  const cli = await resolveAgentKitCli(root);
  if (!cli) {
    reasons.push(
      "agent-kit CLI not resolvable (node_modules/.bin/agent-kit, packages/cli/dist, or PATH)",
    );
  }

  // stop must never be registered
  if (Array.isArray(hooks.stop) && hooks.stop.length > 0) {
    reasons.push("`stop` hook is registered (forbidden; remove it)");
  }

  const status: HooksHealthStatus =
    reasons.length === 0 && wiredEvents.length === EXPECTED_EVENTS.length ? "active" : "degraded";

  return {
    status,
    reasons,
    advisories,
    hooksJsonPath,
    expectedEvents: [...EXPECTED_EVENTS],
    wiredEvents,
  };
}
