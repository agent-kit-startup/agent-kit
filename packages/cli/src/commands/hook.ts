import path from "node:path";
import { defineCommand } from "citty";
import {
  SESSION_START_DEGRADED_MESSAGE,
  formatSessionStartOutput,
  resolveSessionStartFormat,
} from "../hooks/format-session-start.js";
import { buildPreCompactUserMessage } from "../hooks/pre-compact.js";
import { readStdinJson } from "../hooks/read-stdin-json.js";
import {
  type SessionStartPayload,
  buildSessionStartAdditionalContext,
  resolveSessionRoot,
} from "../hooks/session-start.js";

export interface RunSessionStartHookDeps {
  readStdin?: () => Promise<SessionStartPayload>;
  buildContext?: (
    root: string,
    payload: SessionStartPayload,
  ) => Promise<{ additional_context: string }>;
}

/**
 * Core session-start hook logic, extracted from the citty `run()` handler so
 * it is directly unit-testable (stdin/output are DI'd, not real process
 * streams). Fail-open: any error from stdin parsing or context generation is
 * swallowed and degrades to `SESSION_START_DEGRADED_MESSAGE` in the
 * requested format rather than a thrown error / non-zero exit.
 */
export async function runSessionStartHook(
  cwd: string,
  formatArg: unknown,
  deps: RunSessionStartHookDeps = {},
): Promise<string> {
  const format = resolveSessionStartFormat(formatArg);
  try {
    const readStdin = deps.readStdin ?? readStdinJson<SessionStartPayload>;
    const buildContext = deps.buildContext ?? buildSessionStartAdditionalContext;
    const payload = await readStdin();
    const root = resolveSessionRoot(payload, path.resolve(cwd));
    const out = await buildContext(root, payload);
    return formatSessionStartOutput(out.additional_context, format);
  } catch {
    return formatSessionStartOutput(SESSION_START_DEGRADED_MESSAGE, format);
  }
}

export const hookCommand = defineCommand({
  meta: {
    name: "hook",
    description: "Cursor + Claude Code hook adapters (session-start, pre-compact). CLI is SoT.",
  },
  subCommands: {
    "session-start": defineCommand({
      meta: {
        name: "session-start",
        description:
          "Emit sessionStart context (stdin: host payload). --format cursor (default, JSON additional_context) | claude (plain stdout)",
      },
      args: {
        cwd: {
          type: "string",
          default: process.cwd(),
        },
        format: {
          type: "string",
          default: "cursor",
          description: "cursor (default) | claude",
        },
      },
      async run({ args }) {
        const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
        console.log(await runSessionStartHook(cwd, args.format));
      },
    }),
    "pre-compact": defineCommand({
      meta: {
        name: "pre-compact",
        description: "Emit preCompact user_message JSON (stdin: Cursor payload)",
      },
      async run() {
        const payload = await readStdinJson<{
          context_usage_percent?: number;
          trigger?: string;
        }>();
        console.log(JSON.stringify(buildPreCompactUserMessage(payload)));
      },
    }),
  },
});
