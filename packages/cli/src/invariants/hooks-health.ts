import { access, readFile } from "node:fs/promises";
import path from "node:path";

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

/**
 * Visible fail-open posture: active when hooks.json wires Node adapters;
 * degraded when missing CLI resolve path or python leftovers; missing when no hooks.json.
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
      }
    } else {
      reasons.push(`missing hook event: ${event}`);
    }
  }

  const resolveLib = path.join(root, ".cursor", "hooks", "agent", "resolve-agent-kit.sh");
  if (!(await exists(resolveLib))) {
    reasons.push("missing `.cursor/hooks/agent/resolve-agent-kit.sh` (thin adapter resolver)");
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
