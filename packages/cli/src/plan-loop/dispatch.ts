import type { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../utils/fs.js";
import type {
  BackendId,
  BackendRunResult,
  ClaudeRunCaps,
  HitlRunOptions,
  SpawnInfo,
  VersionFn,
} from "./backends.js";
import {
  checkClaudeVersion,
  claudeChildEnv,
  claudeHeadlessArgs,
  claudeRedactions,
  claudeRunCaps,
  redactSecrets,
  resolveHitlRunOptions,
  spawnLogged,
} from "./backends.js";
import type { StreamSink } from "./stream-render.js";

/** Project-run L0 set. `run-plan` aliases the existing loop; the rest dispatch the file. */
export const RUN_CATALOG = [
  "run-plan",
  "run-plan-all",
  "continue-plan",
  "start-project",
  "backlog-add",
  "backlog-edit",
  "backlog-delete",
  "backlog-cancel",
  "git-staging",
  "kit-staging",
] as const;

export type RunCatalogSlash = (typeof RUN_CATALOG)[number];

/** Citty names that already implement a catalog slash (do not rewrite to `run`). */
export const FIRST_CLASS_SLASH_COMMANDS = ["run-plan", "run-plan-all"] as const;

/** Omitted from auto-yes. Operator-gated slashes; never CLI --force promote. */
export const RUN_PROMOTE_BLOCKED = ["git-prod", "kit-prod"] as const;

export type SlashClass = "catalog" | "run-plan" | "promote-blocked" | "unknown";

export function normalizeSlashName(raw: string): string {
  return raw.replace(/^\//, "").replace(/\.md$/i, "").trim();
}

export function classifySlash(name: string): SlashClass {
  const n = normalizeSlashName(name);
  if ((RUN_PROMOTE_BLOCKED as readonly string[]).includes(n)) return "promote-blocked";
  if (n === "run-plan") return "run-plan";
  if ((RUN_CATALOG as readonly string[]).includes(n)) return "catalog";
  return "unknown";
}

/**
 * Map `agent-kit /run-plan-all` (and other catalog slashes) onto citty subcommands.
 * Bare `/run-plan-all` in zsh is a filesystem path; this only sees argv after `agent-kit`.
 */
export function rewriteRootArgvToRun(argv: string[]): string[] {
  const idx = argv.findIndex((arg) => arg.length > 0 && !arg.startsWith("-"));
  if (idx < 0) return argv;
  const token = argv[idx];
  if (!token || token === "run") return argv;

  const kind = classifySlash(token);
  if (kind === "unknown") return argv;

  const slash = normalizeSlashName(token);
  if ((FIRST_CLASS_SLASH_COMMANDS as readonly string[]).includes(slash)) {
    if (token === slash) return argv;
    const next = [...argv];
    next[idx] = slash;
    return next;
  }

  const next = [...argv];
  next.splice(idx, 1, "run", slash);
  return next;
}

export function commandMarkdownPath(root: string, name: string): string {
  return path.join(root, ".cursor", "commands", `${normalizeSlashName(name)}.md`);
}

export function buildDispatchPrompt(commandBody: string): string {
  return [
    "Follow the Agent Kit command below. This session is headless: use numbered-list HITL (Ask questions is Cursor-only). Before each numbered list print one line `HITL_GATE: <ask-id> | <label 1> | <label 2> | ...` (ask-id and labels from the hitl-gates skill), then wait; the operator's answer arrives as `HITL_REPLY: <ask-id> | operator reply <n> | <label>`. Never /git-prod. No CLI --force promote.",
    "",
    commandBody.trimEnd(),
    "",
  ].join("\n");
}

export function promoteBlockedMessage(name: string): string {
  const n = normalizeSlashName(name);
  return `${n} is operator-gated and omitted from agent-kit run. Use the Cursor slash /${n} (explicit yes). Never auto /git-prod.`;
}

export function unknownSlashMessage(name: string): string {
  return `Unknown or unsupported slash '${name}'. Catalog: ${RUN_CATALOG.join(", ")}. git-prod and kit-prod are omitted (operator-gated).`;
}

export async function readCommandFile(
  root: string,
  name: string,
): Promise<{ ok: true; path: string; body: string } | { ok: false; message: string }> {
  const filePath = commandMarkdownPath(root, name);
  if (!(await fileExists(filePath))) {
    return {
      ok: false,
      message: `Command file not found: ${filePath}. Install or refresh Agent Kit L0 so .cursor/commands/${normalizeSlashName(name)}.md exists.`,
    };
  }
  const body = await readFile(filePath, "utf8");
  return { ok: true, path: filePath, body };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

export function cursorAgentDispatchArgs(opts: {
  workspace: string;
  prompt: string;
  model?: string;
}): string[] {
  const args = [
    "-p",
    "--force",
    "--sandbox",
    "disabled",
    "--output-format",
    "stream-json",
    "--workspace",
    opts.workspace,
  ];
  if (opts.model) args.push("--model", opts.model);
  args.push(opts.prompt);
  return args;
}

/**
 * One-shot `claude -p` for `agent-kit run <slash>`: the same headless argv as
 * the plan-loop tick (`claudeHeadlessArgs` in backends.ts). The dispatched L0
 * bodies edit files and run git (git-staging, backlog-*, start-project), so
 * plain `-p` — which starts read-only with nobody to answer a prompt — would
 * have every Edit/Write/Bash denied while the run still exited 0. The prompt
 * itself goes to stdin as the first `user` event (stream-json relay).
 */
export function claudeDispatchArgs(opts: { model?: string } & ClaudeRunCaps = {}): string[] {
  return claudeHeadlessArgs(opts);
}

export async function runHeadlessDispatch(opts: {
  backendId: BackendId;
  bin: string;
  workspace: string;
  prompt: string;
  model?: string;
  logPath: string;
  /** Test seam: replacement for `node:child_process` spawn. */
  spawnFn?: typeof spawn;
  /** Test seam: `claude --version` reader (claude only). */
  versionFn?: VersionFn;
  /** Test seam: sink for operator tips (default: console.log). */
  log?: (line: string) => void;
  /** HITL relay policy (`--no-hitl` = `{ policy: "off" }`); absent = prompt on a TTY. */
  hitl?: HitlRunOptions;
  /** Terminal side of the tee (default: status lines); the live view injects its feed. */
  render?: StreamSink;
  /** Fired once the child is running (pid, stop handle). */
  onSpawn?: (info: SpawnInfo) => void;
}): Promise<BackendRunResult> {
  if (opts.backendId === "claude") {
    // Same env contract as claudeBackend.run: the child inherits process.env
    // minus the nested-session markers (ANTHROPIC_BASE_URL /
    // ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY pass through) and those values
    // are redacted in the console echo, the run-*.log and every error. No
    // `--cwd` exists on the claude root command, so the workspace is the
    // spawn cwd.
    const log = opts.log ?? ((line: string) => console.log(line));
    const env = claudeChildEnv();
    const redact = claudeRedactions(env);
    const version = checkClaudeVersion(opts.bin, opts.versionFn);
    if (!version.ok) throw new Error(`claude dispatch: ${version.message}`);
    if (version.warning) log(version.warning);
    const { caps, invalid } = claudeRunCaps(env);
    for (const problem of invalid)
      log(`claude dispatch: ignoring invalid ${problem}; running uncapped.`);
    try {
      return await spawnLogged(
        opts.bin,
        claudeDispatchArgs({ model: opts.model, ...caps }),
        opts.logPath,
        {
          cwd: opts.workspace,
          env,
          redact,
          spawnFn: opts.spawnFn,
          hitl: resolveHitlRunOptions(opts.hitl, {
            kind: "stdin-stream-json",
            firstPrompt: opts.prompt,
          }),
          render: opts.render,
          onSpawn: opts.onSpawn,
          backendId: "claude",
        },
      );
    } catch (err) {
      // No `cause`: the raw error may carry the secret (see spawnLogged).
      throw new Error(`claude dispatch failed to start: ${redactSecrets(String(err), redact)}`);
    }
  }
  const args = cursorAgentDispatchArgs({
    workspace: opts.workspace,
    prompt: opts.prompt,
    model: opts.model,
  });
  // cursor-agent inherits process.env untouched (no cwd, no env override), but
  // any ANTHROPIC_* value present there is redacted from the console echo,
  // the run-*.log and every error exactly as on the claude backend.
  return spawnLogged(opts.bin, args, opts.logPath, {
    spawnFn: opts.spawnFn,
    redact: claudeRedactions(process.env),
    hitl: resolveHitlRunOptions(opts.hitl, { kind: "none", backend: "cursor-agent" }),
    render: opts.render,
    onSpawn: opts.onSpawn,
    backendId: "cursor-agent",
  });
}

export async function ensureDispatchLogPath(root: string): Promise<string> {
  const logDir = path.join(root, ".cursor", "loop-logs");
  await mkdir(logDir, { recursive: true });
  return path.join(logDir, `run-${stamp()}.log`);
}
