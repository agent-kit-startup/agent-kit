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
 */
import { discoverInstalledCommands } from "../generator/claude-command-adapters.js";
import { RUN_CATALOG } from "../plan-loop/dispatch.js";
import { L0_ARTIFACTS } from "./l0.js";
import { KIT_VERSION } from "./version.js";

/** Semver of the catalog shape: an added optional field is a minor, a removed or retyped one a major. */
export const COMMANDS_CATALOG_VERSION = "1.0.0";

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

export interface CatalogCommand {
  name: string;
  description: string;
  layer: CommandLayer;
  /** The kit can dispatch this slash headless (`RUN_CATALOG`). A hint, never a run grant. */
  headless: boolean;
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
  const commands = (await discoverInstalledCommands(rootDir))
    .filter((c) => COMMAND_NAME_RE.test(c.name))
    .map((c) => ({
      name: c.name,
      description: c.description,
      layer: commandLayer(c.name),
      headless: headless.has(c.name),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { catalogVersion: COMMANDS_CATALOG_VERSION, kitVersion: KIT_VERSION, commands };
}

export function renderCommandsCatalog(catalog: CommandsCatalog): string {
  if (catalog.commands.length === 0) return "No slash commands found in .cursor/commands/.";
  const width = Math.max(...catalog.commands.map((c) => c.name.length)) + 1;
  return catalog.commands
    .map((c) => {
      const tags = [c.layer, ...(c.headless ? ["headless"] : [])].join(", ");
      return `/${c.name.padEnd(width)} [${tags}] ${c.description}`;
    })
    .join("\n");
}
