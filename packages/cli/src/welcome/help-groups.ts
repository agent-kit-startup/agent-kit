/**
 * Grouped root --help for agent-kit (citty lists commands flat by default).
 */

import type { ArgsDef, CommandDef } from "citty";
import { bold, gray, underline } from "kolorist";
import { KIT_VERSION } from "../lifecycle/version.js";
import { shouldUseWelcomeColor } from "./screen.js";
import { SPACE_MARKS, shouldUseVisualMotion, tipAt } from "./visual-kit.js";

export type HelpGroupId = "setup" | "mission" | "dashboard" | "integrity" | "other";

export interface HelpGroup {
  id: HelpGroupId;
  title: string;
  commands: string[];
}

/** Command → group assignment for root help. Chat-only slash flows are omitted. */
export const CLI_HELP_GROUPS: HelpGroup[] = [
  {
    id: "setup",
    title: "SETUP",
    commands: ["init", "install", "doctor", "status", "update", "add", "scan"],
  },
  {
    id: "mission",
    title: "MISSION",
    commands: ["handoff", "run-plan"],
  },
  {
    id: "dashboard",
    title: "DASHBOARD",
    commands: ["dashboard", "dashboard-broadcast", "monitors"],
  },
  {
    id: "integrity",
    title: "INTEGRITY",
    commands: ["validate", "guard", "hook", "cursor-awareness", "diff", "contribute"],
  },
];

/** Resolve citty `Resolvable<CommandMeta>` (function | Promise | plain object). */
async function resolveCommandMeta(
  meta: CommandDef["meta"] | undefined,
): Promise<{ name?: string; version?: string; description?: string } | undefined> {
  if (meta == null) return undefined;
  const value = typeof meta === "function" ? await meta() : meta;
  return await Promise.resolve(value);
}

async function resolveSubMeta(subCommands: Record<string, unknown>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [name, raw] of Object.entries(subCommands)) {
    const resolved = typeof raw === "function" ? await raw() : raw;
    const def = resolved as CommandDef | undefined;
    const meta = await resolveCommandMeta(def?.meta);
    out.set(name, meta?.description ?? "");
  }
  return out;
}

/** Root help text with SETUP / MISSION / DASHBOARD / INTEGRITY groupings. */
export async function renderGroupedRootHelp<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
): Promise<string> {
  const color = shouldUseWelcomeColor();
  const u = (s: string) => (color ? underline(bold(s)) : s);
  const g = (s: string) => (color ? gray(s) : s);
  const meta = await resolveCommandMeta(cmd.meta);
  const name = meta?.name ?? "agent-kit";
  const version = meta?.version ?? KIT_VERSION;
  const description =
    meta?.description ?? "HITL framework for AI-assisted IDEs (Mission Kit family)";

  const subCommands = (await (typeof cmd.subCommands === "function"
    ? cmd.subCommands()
    : cmd.subCommands)) as Record<string, unknown> | undefined;
  const descriptions = subCommands ? await resolveSubMeta(subCommands) : new Map<string, string>();

  const placed = new Set(CLI_HELP_GROUPS.flatMap((grp) => grp.commands));
  const leftover = [...descriptions.keys()].filter((c) => !placed.has(c)).sort();
  const groups = [...CLI_HELP_GROUPS];
  if (leftover.length > 0) {
    groups.push({ id: "other", title: "OTHER", commands: leftover });
  }

  const lines: string[] = [
    g(`${description} (${name} v${version})`),
    "",
    `${u("USAGE")} \`${name} <command> [OPTIONS]\``,
    "",
  ];

  for (const group of groups) {
    const rows = group.commands.filter((c) => descriptions.has(c));
    if (rows.length === 0) continue;
    lines.push(u(group.title), "");
    const width = Math.max(...rows.map((c) => c.length));
    for (const c of rows) {
      const pad = " ".repeat(width - c.length + 2);
      lines.push(`  ${c}${pad}${descriptions.get(c) ?? ""}`);
    }
    lines.push("");
  }

  const tipMark = shouldUseVisualMotion() ? SPACE_MARKS.star : SPACE_MARKS.tick;
  const tip = tipAt([...version].reduce((n, c) => n + c.charCodeAt(0), 0));
  lines.push(
    g(`Use \`${name} <command> --help\` for more information about a command.`),
    g(
      "Chat-only HITL (start-project, backlog, git-staging/prod, run-plan-all) is not a CLI surface.",
    ),
    g(`${tipMark} ${tip}`),
    "",
  );
  return lines.join("\n");
}
