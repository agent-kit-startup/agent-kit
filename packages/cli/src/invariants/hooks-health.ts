import { execFile } from "node:child_process";
import { constants, access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type HooksHealthStatus = "active" | "degraded" | "missing";

export interface HooksHealthReport {
  status: HooksHealthStatus;
  reasons: string[];
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
 * Visible fail-open posture: active when hooks.json wires Node adapters that
 * exist, are executable, and the CLI resolves; degraded otherwise; missing
 * when no hooks.json.
 */
export async function assessHooksHealth(rootDir: string): Promise<HooksHealthReport> {
  const root = path.resolve(rootDir);
  const hooksJsonPath = ".cursor/hooks.json";
  const hooksJsonAbs = path.join(root, hooksJsonPath);
  const reasons: string[] = [];
  const wiredEvents: string[] = [];

  if (!(await exists(hooksJsonAbs))) {
    return {
      status: "missing",
      reasons: ["`.cursor/hooks.json` not found"],
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

  const resolveLib = path.join(root, ".cursor", "hooks", "agent", "resolve-agent-kit.sh");
  if (!(await exists(resolveLib))) {
    reasons.push("missing `.cursor/hooks/agent/resolve-agent-kit.sh` (thin adapter resolver)");
  } else if (!(await isExecutable(resolveLib))) {
    reasons.push("`.cursor/hooks/agent/resolve-agent-kit.sh` is not executable (chmod +x)");
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
      "agent-kit CLI not resolvable (PATH, node_modules/.bin/agent-kit, or packages/cli/dist)",
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
    hooksJsonPath,
    expectedEvents: [...EXPECTED_EVENTS],
    wiredEvents,
  };
}
