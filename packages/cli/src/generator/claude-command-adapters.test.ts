import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadManagedHashLedger } from "../lifecycle/overlay.js";
import {
  CLAUDE_COMMANDS_DIR_REL,
  CURSOR_COMMANDS_DIR_REL,
  discoverInstalledCommands,
  generateClaudeCommandAdapters,
  parseCommandFrontmatter,
  renderClaudeCommandAdapter,
} from "./claude-command-adapters.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const factoryClaudeCommandsDir = path.join(REPO_ROOT, CLAUDE_COMMANDS_DIR_REL);
/** Factory dogfood adapters are private-only; public-sync does not allowlist them. */
const factoryAdaptersPresent = existsSync(factoryClaudeCommandsDir);

async function seedCursorCommand(root: string, name: string, description: string): Promise<void> {
  const dir = path.join(root, CURSOR_COMMANDS_DIR_REL);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# Command: /${name}\n\nBody.\n`,
    "utf8",
  );
}

describe("parseCommandFrontmatter", () => {
  it("extracts the description field", () => {
    const raw = "---\nname: foo\ndescription: Does the thing.\n---\n\nBody\n";
    expect(parseCommandFrontmatter("foo", raw)).toEqual({
      name: "foo",
      description: "Does the thing.",
    });
  });

  it("returns null when there is no frontmatter fence or no description", () => {
    expect(parseCommandFrontmatter("foo", "# no frontmatter\n")).toBeNull();
    expect(parseCommandFrontmatter("foo", "---\nname: foo\n---\nbody\n")).toBeNull();
  });
});

describe("renderClaudeCommandAdapter", () => {
  it("is a thin pointer: frontmatter description + read-the-SoT body, no copied content", () => {
    const out = renderClaudeCommandAdapter({ name: "foo", description: "Does the thing." });
    expect(out).toContain("description: Does the thing.");
    expect(out).toContain("Read `.cursor/commands/foo.md` now and follow that contract exactly");
    expect(out).toContain("this file is only a thin adapter for Claude Code");
    expect(out).not.toContain("Body.");
  });

  it.skipIf(!factoryAdaptersPresent)(
    "matches every factory dogfood .claude/commands/*.md byte-for-byte",
    async () => {
      const commands = await discoverInstalledCommands(REPO_ROOT);
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        const actual = await readFile(
          path.join(factoryClaudeCommandsDir, `${command.name}.md`),
          "utf8",
        );
        expect(actual).toBe(renderClaudeCommandAdapter(command));
      }
    },
  );
});

describe("discoverInstalledCommands", () => {
  it("returns [] when .cursor/commands does not exist (not installed)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-cmds-none-"));
    expect(await discoverInstalledCommands(root)).toEqual([]);
  });

  it("excludes the reserved agent-kit name and skips unparseable sources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-cmds-reserved-"));
    await seedCursorCommand(root, "foo", "Foo command.");
    await seedCursorCommand(root, "agent-kit", "Should never be picked up here.");
    const dir = path.join(root, CURSOR_COMMANDS_DIR_REL);
    await writeFile(path.join(dir, "broken.md"), "no frontmatter here\n", "utf8");

    const commands = await discoverInstalledCommands(root);
    expect(commands).toEqual([{ name: "foo", description: "Foo command." }]);
  });
});

describe("generateClaudeCommandAdapters", () => {
  it("writes an adapter for exactly the installed command set (none for uninstalled commands)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-cmds-gen-"));
    await seedCursorCommand(root, "foo", "Foo command.");
    await seedCursorCommand(root, "bar", "Bar command.");

    const results = await generateClaudeCommandAdapters(root);
    expect(results).toEqual(
      expect.arrayContaining([
        { relativePath: ".claude/commands/foo.md", status: "applied" },
        { relativePath: ".claude/commands/bar.md", status: "applied" },
      ]),
    );
    expect(results).toHaveLength(2);
    expect(existsSync(path.join(root, ".claude/commands/foo.md"))).toBe(true);
    expect(existsSync(path.join(root, ".claude/commands/baz.md"))).toBe(false);
  });

  it("is idempotent: a second run with no source changes reports unchanged, no rewrite churn", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-cmds-idempotent-"));
    await seedCursorCommand(root, "foo", "Foo command.");

    await generateClaudeCommandAdapters(root);
    const second = await generateClaudeCommandAdapters(root);
    expect(second).toEqual([{ relativePath: ".claude/commands/foo.md", status: "unchanged" }]);
  });

  it("refreshes a stale-but-unedited adapter when the source description changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-cmds-refresh-"));
    await seedCursorCommand(root, "foo", "Old description.");
    await generateClaudeCommandAdapters(root);

    await seedCursorCommand(root, "foo", "New description.");
    const results = await generateClaudeCommandAdapters(root);
    expect(results).toEqual([{ relativePath: ".claude/commands/foo.md", status: "refreshed" }]);
    const body = await readFile(path.join(root, ".claude/commands/foo.md"), "utf8");
    expect(body).toContain("description: New description.");
  });

  it("preserves a hand-edited adapter instead of clobbering it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-cmds-preserve-"));
    await seedCursorCommand(root, "foo", "Old description.");
    await generateClaudeCommandAdapters(root);

    const customized =
      "---\ndescription: My own words.\n---\n\nCustom body, not the SoT pointer.\n";
    await writeFile(path.join(root, ".claude/commands/foo.md"), customized, "utf8");

    await seedCursorCommand(root, "foo", "New description.");
    const results = await generateClaudeCommandAdapters(root);
    expect(results).toEqual([
      { relativePath: ".claude/commands/foo.md", status: "preserved-customized" },
    ]);
    expect(await readFile(path.join(root, ".claude/commands/foo.md"), "utf8")).toBe(customized);
  });

  it("records generated adapters in the shared managed-hash ledger (overlay prefix)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-cmds-ledger-"));
    await seedCursorCommand(root, "foo", "Foo command.");
    await generateClaudeCommandAdapters(root);

    const ledger = await loadManagedHashLedger(root);
    expect(ledger.hashes[".claude/commands/foo.md"]).toBeDefined();
  });
});
