import { defineCommand } from "citty";
import { readStdinJson } from "../hooks/read-stdin-json.js";
import { scanTextForSecrets, secretsAdviseMessage } from "../invariants/secrets-scan.js";
import { evaluateShellCommand } from "../invariants/shell-guard.js";

export const guardCommand = defineCommand({
  meta: {
    name: "guard",
    description: "Mechanizable deny/annotate guards (shell, prompt). Hooks are thin adapters.",
  },
  subCommands: {
    shell: defineCommand({
      meta: {
        name: "shell",
        description: "Evaluate a shell command against the destructive deny-list",
      },
      args: {
        json: {
          type: "boolean",
          default: true,
          description: "Print Cursor beforeShellExecution JSON (default)",
        },
        command: {
          type: "string",
          description: "Command string (otherwise read from stdin JSON.command)",
        },
      },
      async run({ args }) {
        let command = typeof args.command === "string" ? args.command : "";
        if (!command) {
          const payload = await readStdinJson<{ command?: string }>();
          command = typeof payload.command === "string" ? payload.command : "";
        }
        const result = evaluateShellCommand(command);
        console.log(JSON.stringify(result));
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
        console.log(
          JSON.stringify({
            continue: true,
            user_message: secretsAdviseMessage(hits),
            agent_message: secretsAdviseMessage(hits),
            hits,
          }),
        );
      },
    }),
  },
});
