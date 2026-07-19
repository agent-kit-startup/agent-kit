import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

export type BackendId = "cursor-agent" | "claude";

export interface BackendRunOptions {
  workspace: string;
  prompt: string;
  model?: string;
  logPath: string;
}

export interface BackendRunResult {
  exitCode: number;
}

export interface AgentBackend {
  id: BackendId;
  /** Resolve binary path or name; null if not on PATH / not found. */
  resolve(): Promise<string | null>;
  /** Run one headless tick; stream stdout/stderr to console and logPath. */
  run(opts: BackendRunOptions): Promise<BackendRunResult>;
}

async function which(bin: string): Promise<string | null> {
  try {
    const out = execFileSync("which", [bin], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function spawnLogged(command: string, args: string[], logPath: string): Promise<BackendRunResult> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(logPath, { flags: "w" });
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onData = (chunk: Buffer) => {
      process.stdout.write(chunk);
      out.write(chunk);
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => {
      out.end();
      reject(err);
    });
    child.on("close", (code) => {
      out.end(() => resolve({ exitCode: code ?? 1 }));
    });
  });
}

export const cursorAgentBackend: AgentBackend = {
  id: "cursor-agent",
  async resolve() {
    return which("cursor-agent");
  },
  async run(opts) {
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
    if (opts.model) {
      args.push("--model", opts.model);
    }
    args.push(opts.prompt);
    return spawnLogged("cursor-agent", args, opts.logPath);
  },
};

/**
 * Claude Code backend placeholder. Same tick contract; invocation flags TBD.
 * Selecting `--backend claude` fails clearly until a stable CLI surface is wired.
 */
export const claudeBackend: AgentBackend = {
  id: "claude",
  async resolve() {
    return which("claude");
  },
  async run(_opts) {
    throw new Error(
      "Backend 'claude' is reserved but not implemented yet. Use --backend cursor-agent.",
    );
  },
};

const BACKENDS: Record<BackendId, AgentBackend> = {
  "cursor-agent": cursorAgentBackend,
  claude: claudeBackend,
};

export function getBackend(id: string): AgentBackend {
  const backend = BACKENDS[id as BackendId];
  if (!backend) {
    throw new Error(`Unknown backend '${id}'. Supported: ${Object.keys(BACKENDS).join(", ")}`);
  }
  return backend;
}

export function listBackendIds(): BackendId[] {
  return Object.keys(BACKENDS) as BackendId[];
}
