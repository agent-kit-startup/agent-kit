/**
 * Commands catalog: the machine-readable list of the workspace's slash commands that an IDE
 * host (Colony) reads instead of keeping its own list. ADR
 * 2026-10-22_colony-commands-catalog-contract (Decision 1-6); JSON Schema in
 * docs/contracts/commands-catalog.schema.json.
 *
 * Rows come from the workspace's own `.cursor/commands/*.md` frontmatter (the file the agent
 * resolves when the slash is typed), never from a copied list. A file is dropped when its name
 * fails `COMMAND_NAME_RE`, it has no `description:` line, or it is the reserved `agent-kit`
 * refresh name (`discoverInstalledCommands`).
 *
 * Catalog 1.1.0 (ADR amend 2026-11-16, run with context) adds `context`, `interactiveOnly` and
 * `audience`, read from the same frontmatter so a new command declares itself. A file without
 * them gets the defaults (`none`, `false`, `user`); an unknown value falls back the same way.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CURSOR_COMMANDS_DIR_REL,
  discoverInstalledCommands,
} from "../generator/claude-command-adapters.js";
import { RUN_CATALOG, RUN_PROMOTE_BLOCKED } from "../plan-loop/dispatch.js";
import { L0_ARTIFACTS } from "./l0.js";
import { KIT_VERSION } from "./version.js";

/** Semver of the catalog shape: an added optional field is a minor, a removed or retyped one a major. */
export const COMMANDS_CATALOG_VERSION = "1.1.0";

/** Catalog names are untrusted repo text: rows that do not match are dropped (ADR Decision 6). */
export const COMMAND_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const COMMANDS_PREFIX = ".cursor/commands/";

/**
 * Registry `kind: command` rows that are not L0: pack members (L1) and curated rows (L2). The CLI
 * does not ship the registry, so these stay a literal; scripts/sync-public-guards.test.mjs pins it
 * to registry/registry.json.
 */
export const NON_L0_KIT_COMMAND_IDS: ReadonlySet<string> = new Set(["context-status", "tips"]);

/**
 * Kit commands: every registry `kind: command` id. The L0 part is read from `L0_ARTIFACTS`, the
 * list `scripts/build-registry.mjs` generates the registry's L0 rows from.
 */
export const KIT_COMMAND_IDS: ReadonlySet<string> = new Set([
  ...L0_ARTIFACTS.filter((a) => a.source.startsWith(COMMANDS_PREFIX)).map((a) =>
    a.source.slice(COMMANDS_PREFIX.length).replace(/\.md$/, ""),
  ),
  ...NON_L0_KIT_COMMAND_IDS,
]);

/**
 * Factory-only commands: no registry row and excluded from the public mirror by
 * `scripts/public-sync.manifest` (parity pinned by scripts/sync-public-guards.test.mjs).
 * Consumer workspaces never receive these files, so their catalog has no factory rows.
 */
export const FACTORY_COMMAND_IDS: ReadonlySet<string> = new Set([
  "kit-prod",
  "kit-staging",
  "public-inbound-radar",
  "public-issue-triage",
]);

export type CommandLayer = "kit" | "factory" | "project";

/** What a host may append to `/name` as the one context argument. */
export const COMMAND_CONTEXTS = ["none", "goal", "plan", "branch", "pr", "sha"] as const;
export type CommandContext = (typeof COMMAND_CONTEXTS)[number];

/** `meta` = exists to build or ship the kit itself; hosts hide it outside the factory workspace. */
export const COMMAND_AUDIENCES = ["user", "meta"] as const;
export type CommandAudience = (typeof COMMAND_AUDIENCES)[number];

/**
 * Production promote commands: interactive only, never headless, the driver or a pre-answer.
 * This floor holds whatever the frontmatter says, so a workspace file cannot relax it.
 */
export const INTERACTIVE_ONLY_COMMAND_IDS: ReadonlySet<string> = new Set(RUN_PROMOTE_BLOCKED);

export interface CommandRunMeta {
  context: CommandContext;
  interactiveOnly: boolean;
  audience: CommandAudience;
}

/** Reads `context`, `interactiveOnly` and `audience` from a command file's frontmatter. */
export function parseCommandRunMeta(name: string, raw: string): CommandRunMeta {
  const body = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? "";
  const field = (key: string) => new RegExp(`^${key}:\\s*(\\S+)\\s*$`, "m").exec(body)?.[1];
  const context = field("context");
  const audience = field("audience");
  return {
    context: (COMMAND_CONTEXTS as readonly string[]).includes(context ?? "")
      ? (context as CommandContext)
      : "none",
    interactiveOnly: INTERACTIVE_ONLY_COMMAND_IDS.has(name) || field("interactiveOnly") === "true",
    audience: (COMMAND_AUDIENCES as readonly string[]).includes(audience ?? "")
      ? (audience as CommandAudience)
      : "user",
  };
}

export interface CatalogCommand {
  name: string;
  description: string;
  layer: CommandLayer;
  /** The kit can dispatch this slash headless (`RUN_CATALOG`). A hint, never a run grant. */
  headless: boolean;
  /** What a host may append as the one context argument (catalog 1.1.0). */
  context: CommandContext;
  /** Interactive session only: never headless, the driver or a pre-answer (catalog 1.1.0). */
  interactiveOnly: boolean;
  /** `meta` rows are hidden outside the factory workspace (catalog 1.1.0). */
  audience: CommandAudience;
}

export interface CommandsCatalog {
  catalogVersion: string;
  kitVersion: string;
  commands: CatalogCommand[];
}

export function commandLayer(name: string): CommandLayer {
  if (KIT_COMMAND_IDS.has(name)) return "kit";
  if (FACTORY_COMMAND_IDS.has(name)) return "factory";
  return "project";
}

export async function buildCommandsCatalog(rootDir: string): Promise<CommandsCatalog> {
  const headless = new Set<string>(RUN_CATALOG);
  const dir = path.join(rootDir, CURSOR_COMMANDS_DIR_REL);
  const rows = (await discoverInstalledCommands(rootDir)).filter((c) =>
    COMMAND_NAME_RE.test(c.name),
  );
  const commands = (
    await Promise.all(
      rows.map(async (c) => {
        const raw = await readFile(path.join(dir, `${c.name}.md`), "utf8").catch(() => "");
        return {
          name: c.name,
          description: c.description,
          layer: commandLayer(c.name),
          headless: headless.has(c.name),
          ...parseCommandRunMeta(c.name, raw),
        };
      }),
    )
  ).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { catalogVersion: COMMANDS_CATALOG_VERSION, kitVersion: KIT_VERSION, commands };
}

export function renderCommandsCatalog(catalog: CommandsCatalog): string {
  if (catalog.commands.length === 0) return "No slash commands found in .cursor/commands/.";
  const width = Math.max(...catalog.commands.map((c) => c.name.length)) + 1;
  return catalog.commands
    .map((c) => {
      const tags = [
        c.layer,
        ...(c.headless ? ["headless"] : []),
        ...(c.interactiveOnly ? ["interactive-only"] : []),
        ...(c.audience === "meta" ? ["meta"] : []),
        ...(c.context !== "none" ? [`context: ${c.context}`] : []),
      ].join(", ");
      return `/${c.name.padEnd(width)} [${tags}] ${c.description}`;
    })
    .join("\n");
}
