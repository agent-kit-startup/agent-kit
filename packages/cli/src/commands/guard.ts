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
import { type ShellGuardResult, evaluateShellCommand } from "../invariants/shell-guard.js";

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

export interface GuardShellDeps {
  detectCurrentBranch: (cwd: string) => Promise<string | undefined>;
  detectRemotes: (cwd: string) => Promise<Record<string, string> | undefined>;
}

const defaultGuardShellDeps: GuardShellDeps = { detectCurrentBranch, detectRemotes };

/** Every deny rule targets `git` or `gh`; other commands skip both git spawns. */
const GIT_OR_GH_RE = /\b(git|gh)\b/;

export async function evaluateGuardShell(
  command: string,
  cwd: string = process.cwd(),
  deps: GuardShellDeps = defaultGuardShellDeps,
): Promise<ShellGuardResult> {
  if (!GIT_OR_GH_RE.test(command)) return evaluateShellCommand(command);
  const [currentBranch, remotes] = await Promise.all([
    deps.detectCurrentBranch(cwd),
    deps.detectRemotes(cwd),
  ]);
  return evaluateShellCommand(command, { currentBranch, remotes });
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
          "Evaluate a shell command against the git-workflow / protected-branch deny-list (git checkout|restore|reset --hard|clean -fd + pushes to main/master/prod + direct git push/gh pr create|merge against the public repo). Not a general destructive-command guard: rm -rf, chmod, dd are allowed.",
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
