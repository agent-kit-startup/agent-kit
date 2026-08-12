import path from "node:path";
import { defineCommand } from "citty";
import { buildPreCompactUserMessage } from "../hooks/pre-compact.js";
import { readStdinJson } from "../hooks/read-stdin-json.js";
import {
  type SessionStartPayload,
  buildSessionStartAdditionalContext,
  resolveSessionRoot,
} from "../hooks/session-start.js";

export const hookCommand = defineCommand({
  meta: {
    name: "hook",
    description: "Cursor hook adapters (session-start, pre-compact). CLI is SoT.",
  },
  subCommands: {
    "session-start": defineCommand({
      meta: {
        name: "session-start",
        description: "Emit sessionStart additional_context JSON (stdin: Cursor payload)",
      },
      args: {
        cwd: {
          type: "string",
          default: process.cwd(),
        },
      },
      async run({ args }) {
        const payload = await readStdinJson<SessionStartPayload>();
        const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
        const root = resolveSessionRoot(payload, path.resolve(cwd));
        const out = await buildSessionStartAdditionalContext(root, payload);
        console.log(JSON.stringify(out));
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
