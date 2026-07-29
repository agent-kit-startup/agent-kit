import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineCommand } from "citty";
import { readStdinJson } from "../hooks/read-stdin-json.js";
import { validateHandoffText } from "../invariants/handoff-schema.js";
import { validatePlanFrontmatterText } from "../invariants/plan-schema.js";

async function resolveEditedPath(
  cwd: string,
  explicit?: string,
): Promise<{ filePath: string; content: string } | null> {
  if (explicit) {
    const filePath = path.resolve(cwd, explicit);
    try {
      return { filePath, content: await readFile(filePath, "utf8") };
    } catch {
      return null;
    }
  }
  const payload = await readStdinJson<{
    file_path?: string;
    path?: string;
    file?: string;
  }>();
  const rel =
    (typeof payload.file_path === "string" && payload.file_path) ||
    (typeof payload.path === "string" && payload.path) ||
    (typeof payload.file === "string" && payload.file) ||
    "";
  if (!rel) return null;
  const filePath = path.isAbsolute(rel) ? rel : path.resolve(cwd, rel);
  try {
    return { filePath, content: await readFile(filePath, "utf8") };
  } catch {
    return null;
  }
}

function isHandoffPath(filePath: string): boolean {
  return filePath.replace(/\\/g, "/").endsWith(".cursor/HANDOFF.md");
}

function isPlanPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  return norm.includes("/.cursor/plans/") && norm.endsWith(".plan.md");
}

export const validateCommand = defineCommand({
  meta: {
    name: "validate",
    description: "Advisory validators for HANDOFF / plan frontmatter (afterFileEdit adapter)",
  },
  subCommands: {
    handoff: defineCommand({
      meta: { name: "handoff", description: "Validate HANDOFF machine fields" },
      args: {
        cwd: { type: "string", default: process.cwd() },
        file: { type: "string", description: "Path to HANDOFF.md" },
        json: { type: "boolean", default: true },
      },
      async run({ args }) {
        const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
        const fileArg = typeof args.file === "string" ? args.file : undefined;
        const filePath = fileArg
          ? path.resolve(cwd, fileArg)
          : path.join(path.resolve(cwd), ".cursor", "HANDOFF.md");
        let content = "";
        try {
          content = await readFile(filePath, "utf8");
        } catch {
          console.log(JSON.stringify({ ok: true, warnings: [], note: "file missing" }));
          return;
        }
        const warnings = validateHandoffText(content);
        console.log(JSON.stringify({ ok: warnings.length === 0, warnings }));
      },
    }),
    plan: defineCommand({
      meta: { name: "plan", description: "Validate plan frontmatter" },
      args: {
        cwd: { type: "string", default: process.cwd() },
        file: { type: "string", description: "Path to *.plan.md" },
        json: { type: "boolean", default: true },
      },
      async run({ args }) {
        const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
        const fileArg = typeof args.file === "string" ? args.file : undefined;
        if (!fileArg) {
          console.log(JSON.stringify({ ok: false, warnings: [{ message: "file required" }] }));
          process.exitCode = 2;
          return;
        }
        const filePath = path.resolve(cwd, fileArg);
        let content = "";
        try {
          content = await readFile(filePath, "utf8");
        } catch {
          console.log(JSON.stringify({ ok: true, warnings: [], note: "file missing" }));
          return;
        }
        const warnings = validatePlanFrontmatterText(content);
        console.log(JSON.stringify({ ok: warnings.length === 0, warnings }));
      },
    }),
    "after-edit": defineCommand({
      meta: {
        name: "after-edit",
        description: "Advisory afterFileEdit: annotate HANDOFF/plan issues (never block)",
      },
      args: {
        cwd: { type: "string", default: process.cwd() },
      },
      async run({ args }) {
        const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
        const resolved = await resolveEditedPath(path.resolve(cwd));
        if (!resolved) {
          console.log(JSON.stringify({}));
          return;
        }
        const { filePath, content } = resolved;
        if (isHandoffPath(filePath)) {
          const warnings = validateHandoffText(content);
          if (!warnings.length) {
            console.log(JSON.stringify({}));
            return;
          }
          const msg = warnings.map((w) => w.message).join(" ");
          console.log(
            JSON.stringify({
              user_message: msg,
              agent_message: `${msg} Cite: agent-kit validate handoff.`,
            }),
          );
          return;
        }
        if (isPlanPath(filePath)) {
          const warnings = validatePlanFrontmatterText(content);
          if (!warnings.length) {
            console.log(JSON.stringify({}));
            return;
          }
          const msg = warnings.map((w) => w.message).join(" ");
          console.log(
            JSON.stringify({
              user_message: msg,
              agent_message: `${msg} Cite: agent-kit validate plan.`,
            }),
          );
          return;
        }
        console.log(JSON.stringify({}));
      },
    }),
  },
});
