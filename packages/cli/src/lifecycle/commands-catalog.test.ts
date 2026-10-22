import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RUN_CATALOG } from "../plan-loop/dispatch.js";
import {
  buildCommandsCatalog,
  COMMANDS_CATALOG_VERSION,
  FACTORY_COMMAND_IDS,
  KIT_COMMAND_IDS,
  renderCommandsCatalog,
} from "./commands-catalog.js";
import { KIT_VERSION } from "./version.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const schema = JSON.parse(
  readFileSync(join(repoRoot, "docs/contracts/commands-catalog.schema.json"), "utf8"),
) as SchemaNode & { version: string };

type SchemaNode = {
  type?: string;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  enum?: unknown[];
  pattern?: string;
};

function jsonType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Minimal checker for the keywords the contract uses (type, required, properties, items, enum, pattern). */
function schemaErrors(node: SchemaNode, value: unknown, at = "$"): string[] {
  const errors: string[] = [];
  if (node.type && jsonType(value) !== node.type)
    errors.push(`${at}: ${jsonType(value)} is not ${node.type}`);
  if (node.enum && !node.enum.includes(value)) errors.push(`${at}: ${String(value)} not in enum`);
  if (node.pattern && typeof value === "string" && !new RegExp(node.pattern).test(value))
    errors.push(`${at}: ${value} does not match ${node.pattern}`);
  if (jsonType(value) === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of node.required ?? []) if (!(key in obj)) errors.push(`${at}.${key}: missing`);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      if (key in obj) errors.push(...schemaErrors(child, obj[key], `${at}.${key}`));
    }
  }
  if (jsonType(value) === "array" && node.items) {
    (value as unknown[]).forEach((item, i) => {
      errors.push(...schemaErrors(node.items as SchemaNode, item, `${at}[${i}]`));
    });
  }
  return errors;
}

function scratchWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ak-commands-catalog-"));
  mkdirSync(join(dir, ".cursor", "commands"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, ".cursor", "commands", name), body);
  }
  return dir;
}

describe("commands catalog", () => {
  it("lists every command file of this repo as kit or factory, and matches the schema", async () => {
    const catalog = await buildCommandsCatalog(repoRoot);
    const files = readdirSync(join(repoRoot, ".cursor", "commands"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    expect(catalog.catalogVersion).toBe(COMMANDS_CATALOG_VERSION);
    expect(catalog.kitVersion).toBe(KIT_VERSION);
    expect(catalog.commands.map((c) => c.name)).toEqual(files);
    // The kit repo adds no commands of its own; the public mirror has no factory files.
    for (const c of catalog.commands) expect(["kit", "factory"]).toContain(c.layer);
    for (const c of catalog.commands) {
      expect(c.layer).toBe(FACTORY_COMMAND_IDS.has(c.name) ? "factory" : "kit");
    }
    expect(schemaErrors(schema, catalog)).toEqual([]);
  });

  it("keeps the schema version, the kit set and the factory set consistent", () => {
    expect(schema.version).toBe(COMMANDS_CATALOG_VERSION);
    expect(KIT_COMMAND_IDS.size).toBeGreaterThan(0);
    for (const id of FACTORY_COMMAND_IDS) expect(KIT_COMMAND_IDS.has(id)).toBe(false);
    // review-pack is an L0 command (registry row, synced publicly), not factory-only.
    expect(KIT_COMMAND_IDS.has("review-pack")).toBe(true);
  });

  it("flags headless from RUN_CATALOG only; promote commands are never headless", async () => {
    const catalog = await buildCommandsCatalog(repoRoot);
    const byName = new Map(catalog.commands.map((c) => [c.name, c]));
    for (const c of catalog.commands) {
      expect(c.headless).toBe((RUN_CATALOG as readonly string[]).includes(c.name));
    }
    for (const id of RUN_CATALOG) expect(byName.get(id)?.headless).toBe(true);
    expect(byName.get("git-prod")?.headless).toBe(false);
    const kitProd = byName.get("kit-prod");
    if (kitProd) expect(kitProd).toMatchObject({ layer: "factory", headless: false });
  });

  it("labels workspace-added commands as project and drops unsafe or description-less rows", async () => {
    const dir = scratchWorkspace({
      "deploy-site.md": "---\nname: deploy-site\ndescription: Ship the site.\n---\n\nbody\n",
      "run-plan.md": "---\nname: run-plan\ndescription: Run the plan.\n---\n",
      "Bad_Name.md": "---\ndescription: Uppercase and underscore.\n---\n",
      "-leading.md": "---\ndescription: Leading dash.\n---\n",
      "no-desc.md": "---\nname: no-desc\n---\n",
      "agent-kit.md": "---\ndescription: Reserved refresh name.\n---\n",
      "notes.txt": "not a command",
    });
    try {
      const catalog = await buildCommandsCatalog(dir);
      expect(catalog.commands).toEqual([
        { name: "deploy-site", description: "Ship the site.", layer: "project", headless: false },
        { name: "run-plan", description: "Run the plan.", layer: "kit", headless: true },
      ]);
      expect(schemaErrors(schema, catalog)).toEqual([]);
      expect(renderCommandsCatalog(catalog).split("\n")).toEqual([
        "/deploy-site  [project] Ship the site.",
        "/run-plan     [kit, headless] Run the plan.",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty catalog when the workspace has no .cursor/commands/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ak-commands-catalog-empty-"));
    try {
      const catalog = await buildCommandsCatalog(dir);
      expect(catalog.commands).toEqual([]);
      expect(renderCommandsCatalog(catalog)).toBe("No slash commands found in .cursor/commands/.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
