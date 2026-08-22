import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectContext } from "../scanner/detect-repository.js";
import { fileExists } from "../utils/fs.js";
import {
  AGENT_KIT_COMMAND_REL,
  CLAUDE_MD_REL,
  generateClaudeKitLoadArtifacts,
  renderAgentKitCommand,
  renderClaudeMd,
} from "./claude-kit-load.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const factoryClaudePath = path.join(REPO_ROOT, CLAUDE_MD_REL);
const factoryCommandPath = path.join(REPO_ROOT, AGENT_KIT_COMMAND_REL);
/** Factory dogfood files are private-only; public-sync does not allowlist them. */
const factoryKitLoadPresent = existsSync(factoryClaudePath) && existsSync(factoryCommandPath);

describe("generateClaudeKitLoadArtifacts", () => {
  it("carves out the sanctioned SessionStart adapter without reopening rules/agents mirrors (ADR 2026-08-13, amended 2026-08-21)", () => {
    const claudeMd = renderClaudeMd();
    expect(claudeMd).toContain(
      "Not a copy of Cursor hooks beyond the opt-in SessionStart context adapter (`agent-kit hook session-start --format claude`)",
    );
    expect(claudeMd).toContain("no `.claude/rules/` mirrors");
    expect(claudeMd).toContain("no `.claude/agents/` generated from the registry");
  });

  it("matches the pack-contract canonical fences", async () => {
    const docs = await readFile(path.join(REPO_ROOT, "docs/claude-cli-kit-load.md"), "utf8");
    expect(docs).toContain(renderClaudeMd().trimEnd());
    expect(docs).toContain(renderAgentKitCommand().trimEnd());
  });

  it.skipIf(!factoryKitLoadPresent)(
    "keeps factory dogfood files identical to generator snippets",
    async () => {
      expect(await readFile(factoryClaudePath, "utf8")).toBe(renderClaudeMd());
      expect(await readFile(factoryCommandPath, "utf8")).toBe(renderAgentKitCommand());
    },
  );

  it("writes CLAUDE.md and /agent-kit on first run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-load-"));
    const results = await generateClaudeKitLoadArtifacts(root);

    expect(results).toEqual([
      { relativePath: CLAUDE_MD_REL, status: "applied" },
      { relativePath: AGENT_KIT_COMMAND_REL, status: "applied" },
    ]);

    expect(await readFile(path.join(root, CLAUDE_MD_REL), "utf8")).toBe(renderClaudeMd());
    expect(await readFile(path.join(root, AGENT_KIT_COMMAND_REL), "utf8")).toBe(
      renderAgentKitCommand(),
    );

    const context = await detectContext(root);
    expect(context.hasAgentGuidance).toBe(true);
    expect(context.sources).toEqual(
      expect.arrayContaining([{ source: "file", value: "CLAUDE.md:agent guidance" }]),
    );
  });

  it("skips existing consumer files without overwriting them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-load-skip-"));
    await writeFile(path.join(root, CLAUDE_MD_REL), "# Existing Claude notes\n", "utf8");

    const results = await generateClaudeKitLoadArtifacts(root);

    expect(results).toContainEqual({
      relativePath: CLAUDE_MD_REL,
      status: "skipped-customized",
    });
    expect(results).toContainEqual({
      relativePath: AGENT_KIT_COMMAND_REL,
      status: "applied",
    });
    expect(await readFile(path.join(root, CLAUDE_MD_REL), "utf8")).toBe(
      "# Existing Claude notes\n",
    );
    expect(await fileExists(path.join(root, AGENT_KIT_COMMAND_REL))).toBe(true);
  });
});
