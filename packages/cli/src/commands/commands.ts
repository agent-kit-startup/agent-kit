import path from "node:path";
import { defineCommand } from "citty";
import { buildCommandsCatalog, renderCommandsCatalog } from "../lifecycle/commands-catalog.js";

/**
 * Slash commands catalog for IDE hosts (Colony's command palette) and humans. The JSON shape is
 * the versioned contract in docs/contracts/commands-catalog.schema.json.
 */
export const commandsCommand = defineCommand({
  meta: {
    name: "commands",
    description: "List the workspace's slash commands (name, description, layer, headless hint)",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
      description: "Workspace root to read .cursor/commands/ from",
    },
    json: { type: "boolean", description: "Print the versioned catalog as JSON", default: false },
  },
  async run({ args }) {
    const catalog = await buildCommandsCatalog(path.resolve(args.cwd));
    process.stdout.write(
      args.json ? `${JSON.stringify(catalog, null, 2)}\n` : `${renderCommandsCatalog(catalog)}\n`,
    );
  },
});
