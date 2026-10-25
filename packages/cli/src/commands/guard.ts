import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineCommand } from "citty";
import {
  extractGuardShellInput,
  formatGuardShellOutput,
  resolveGuardShellFormat,
} from "../hooks/format-guard-shell.js";
import { readStdinJson } from "../hooks/read-stdin-json.js";
import { scanTextForSecrets, secretsAdviseMessage } from "../invariants/secrets-scan.js";
import {
  evaluateShellCommand,
  type PrMergeTarget,
  prMergeKey,
  prMergeTargets,
  type ShellGuardResult,
} from "../invariants/shell-guard.js";

const execFileAsync = promisify(execFile);

async function detectCurrentBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      cwd,
    });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

/** `git remote -v` -> { name: url }, for resolving `git push <remote-name>` targets. */
async function detectRemotes(cwd: string): Promise<Record<string, string> | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "-v"], { encoding: "utf8", cwd });
    const remotes: Record<string, string> = {};
    for (const line of stdout.split("\n")) {
      const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
      if (m?.[1] && m[2]) remotes[m[1]] = m[2];
    }
    return Object.keys(remotes).length > 0 ? remotes : undefined;
  } catch {
    return undefined;
  }
}

/** Under the Cursor hook's 5 s budget, so a slow forge denies instead of timing the hook out. */
const PR_BASE_TIMEOUT_MS = 3000;

/** Base branch of the PR/MR a merge names (`gh pr view` / `glab mr view`); null when unresolved. */
async function resolvePrBase(target: PrMergeTarget, cwd: string): Promise<string | null> {
  const selector = target.selector ? [target.selector] : [];
  try {
    if (target.forge === "github") {
      const repo = target.repo ? ["--repo", target.repo] : [];
      const { stdout } = await execFileAsync(
        "gh",
        ["pr", "view", ...selector, ...repo, "--json", "baseRefName", "-q", ".baseRefName"],
        { encoding: "utf8", cwd, timeout: PR_BASE_TIMEOUT_MS },
      );
      return stdout.trim() || null;
    }
    const repo = target.repo ? ["-R", target.repo] : [];
    const { stdout } = await execFileAsync(
      "glab",
      ["mr", "view", ...selector, ...repo, "-F", "json"],
      {
        encoding: "utf8",
        cwd,
        timeout: PR_BASE_TIMEOUT_MS,
      },
    );
    const base = (JSON.parse(stdout) as { target_branch?: unknown }).target_branch;
    return typeof base === "string" && base ? base : null;
  } catch {
    return null;
  }
}

export interface GuardShellDeps {
  detectCurrentBranch: (cwd: string) => Promise<string | undefined>;
  detectRemotes: (cwd: string) => Promise<Record<string, string> | undefined>;
  resolvePrBase: (target: PrMergeTarget, cwd: string) => Promise<string | null>;
}

const defaultGuardShellDeps: GuardShellDeps = { detectCurrentBranch, detectRemotes, resolvePrBase };

/** Every deny rule targets `git`, `gh` or `glab`; other commands skip the spawns. */
const GIT_OR_FORGE_RE = /\b(git|gh|glab)\b/;

export async function evaluateGuardShell(
  command: string,
  cwd: string = process.cwd(),
  deps: GuardShellDeps = defaultGuardShellDeps,
): Promise<ShellGuardResult> {
  if (!GIT_OR_FORGE_RE.test(command)) return evaluateShellCommand(command);
  const targets = prMergeTargets(command);
  const [currentBranch, remotes, bases] = await Promise.all([
    deps.detectCurrentBranch(cwd),
    deps.detectRemotes(cwd),
    Promise.all(targets.map((t) => deps.resolvePrBase(t, cwd))),
  ]);
  const prMergeBases =
    targets.length > 0
      ? Object.fromEntries(targets.map((t, i) => [prMergeKey(t), bases[i] ?? null]))
      : undefined;
  return evaluateShellCommand(command, { currentBranch, remotes, prMergeBases });
}

export interface RunGuardShellHookDeps extends Partial<GuardShellDeps> {
  readStdin?: () => Promise<unknown>;
  /** `--command` flag; when set, stdin is not read. */
  command?: string;
  cwd?: string;
}

/**
 * `guard shell` body with injectable stdin/git (pattern: `runSessionStartHook`).
 * cursor: unchanged (`JSON.stringify(ShellGuardResult)`). claude: PreToolUse(Bash)
 * deny JSON or '' for allow; any throw, empty stdin or bad JSON -> '' (fail-open,
 * exit 0, no systemMessage) per ADR 2026-08-13 Amend (2026-09-27).
 */
export async function runGuardShellHook(
  formatArg: unknown,
  deps: RunGuardShellHookDeps = {},
): Promise<string> {
  const format = resolveGuardShellFormat(formatArg);
  const run = async (): Promise<string> => {
    let command = typeof deps.command === "string" ? deps.command : "";
    let cwd = deps.cwd ?? process.cwd();
    if (!command) {
      const readStdin = deps.readStdin ?? readStdinJson;
      const input = extractGuardShellInput(await readStdin(), format);
      command = input.command;
      if (input.cwd) cwd = input.cwd;
    }
    const result = await evaluateGuardShell(command, cwd, {
      detectCurrentBranch: deps.detectCurrentBranch ?? defaultGuardShellDeps.detectCurrentBranch,
      detectRemotes: deps.detectRemotes ?? defaultGuardShellDeps.detectRemotes,
      resolvePrBase: deps.resolvePrBase ?? defaultGuardShellDeps.resolvePrBase,
    });
    return formatGuardShellOutput(result, format);
  };
  if (format !== "claude") return run();
  try {
    return await run();
  } catch {
    return "";
  }
}

export const guardCommand = defineCommand({
  meta: {
    name: "guard",
    description: "Deny/annotate guards (shell, prompt). Hooks are thin adapters.",
  },
  subCommands: {
    shell: defineCommand({
      meta: {
        name: "shell",
        description:
          "Evaluate a shell command against the git-workflow / protected-branch deny-list (git checkout|restore|reset --hard|clean -fd + pushes to main/master/prod + gh pr merge / glab mr merge into main/master/prod or an unresolved base + any gh pr merge / glab mr merge not at the head of its own segment (loop body, if, !, xargs, bash -c / sh -c) + any gh api / glab api merge call + direct git push/gh pr create|merge against the public repo). A script file that runs a merge is out of reach. Not a general destructive-command guard: rm -rf, chmod, dd are allowed.",
      },
      args: {
        json: {
          type: "boolean",
          default: true,
          description: "Print Cursor beforeShellExecution JSON (default)",
        },
        format: {
          type: "string",
          default: "cursor",
          description:
            "cursor (default, beforeShellExecution JSON) | claude (PreToolUse deny JSON, empty on allow)",
        },
        command: {
          type: "string",
          description:
            "Command string (otherwise read from stdin: JSON.command, or tool_input.command with --format claude)",
        },
      },
      async run({ args }) {
        const command = typeof args.command === "string" ? args.command : undefined;
        const out = await runGuardShellHook(args.format, { command });
        // claude allow is empty stdout: print nothing, not a bare newline.
        if (out) console.log(out);
      },
    }),
    prompt: defineCommand({
      meta: {
        name: "prompt",
        description: "Scan prompt text for secret patterns (advisory; fail-open at hook)",
      },
      args: {
        json: {
          type: "boolean",
          default: true,
        },
      },
      async run() {
        const payload = await readStdinJson<{ prompt?: string; text?: string }>();
        const text =
          (typeof payload.prompt === "string" && payload.prompt) ||
          (typeof payload.text === "string" && payload.text) ||
          "";
        const hits = scanTextForSecrets(text);
        if (hits.length === 0) {
          // beforeSubmitPrompt: continue (empty / allow-style)
          console.log(JSON.stringify({ continue: true, hits: [] }));
          return;
        }
        // Annotate only: do not block the session (fail-open posture).
        // Omit raw excerpts from hook stdout (pattern ids only).
        console.log(
          JSON.stringify({
            continue: true,
            user_message: secretsAdviseMessage(hits),
            agent_message: secretsAdviseMessage(hits),
            hits: hits.map((h) => ({ patternId: h.patternId })),
          }),
        );
      },
    }),
  },
});
