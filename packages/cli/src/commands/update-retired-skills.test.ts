import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentHash, MANAGED_HASHES_REL } from "../lifecycle/overlay.js";
import { updateCommand } from "./update.js";

// Real syncFromManifest against the repo's own registry; only the PATH CLI
// sync is stubbed so the test never touches a global npm install.
vi.mock("../lifecycle/path-cli.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lifecycle/path-cli.js")>()),
  syncPathCliToRuntime: async () => ({ status: "current", upgraded: false, lines: [] }),
}));

const here = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(here, "../../../..");

type Run = (ctx: { args: Record<string, unknown> }) => Promise<void>;

const GROOVY_SKILL = ".cursor/skills/community/cursor-skills-groovy/SKILL.md";
const GROOVY_RULE = ".cursor/rules/cursor-skills-groovy.mdc";
const NODE_SKILL = ".cursor/skills/community/cursor-skills-node/SKILL.md";
const GENERAL_RULE = ".cursor/rules/cursor-skills-general.mdc";
const DEVOPS_RULE = ".cursor/rules/cursor-skills-devops.mdc";

const OLD_NODE = "synthetic body standing in for the pre-rewrite node skill\n";
const OLD_GROOVY = "synthetic body standing in for the retired groovy skill\n";

async function put(root: string, rel: string, body: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), body, "utf8");
}

async function exists(root: string, rel: string): Promise<boolean> {
  try {
    await stat(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

/** A consumer installed before the rewrite: old files recorded in the managed-hash ledger. */
async function consumerBeforeRewrite(groovyBody: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ak-update-retired-"));
  await put(
    root,
    ".cursor/agent-kit.json",
    JSON.stringify({
      schemaVersion: 1,
      version: "6.0.0",
      packs: ["devops"],
      skills: ["cursor-skills-node", "cursor-skills-groovy"],
      protected: [],
    }),
  );
  await put(root, NODE_SKILL, OLD_NODE);
  await put(root, GROOVY_SKILL, groovyBody);
  await put(root, GENERAL_RULE, "old general\n");
  await put(root, DEVOPS_RULE, "old devops\n");
  await put(
    root,
    MANAGED_HASHES_REL,
    JSON.stringify({
      schemaVersion: 1,
      hashes: {
        [NODE_SKILL]: contentHash(OLD_NODE),
        [GROOVY_SKILL]: contentHash(OLD_GROOVY),
      },
    }),
  );
  return root;
}

function captureOutput(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const push = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  };
  const log = vi.spyOn(console, "log").mockImplementation(push);
  const err = vi.spyOn(console, "error").mockImplementation(push);
  return {
    lines,
    restore: () => {
      log.mockRestore();
      err.mockRestore();
    },
  };
}

async function runUpdate(cwd: string): Promise<string> {
  const out = captureOutput();
  try {
    await (updateCommand.run as unknown as Run)({
      args: {
        _: [],
        cwd,
        check: false,
        json: false,
        "respect-prefs": false,
        stamp: false,
        "seed-overlay": false,
        "allow-stale-cli": true,
        yes: true,
        "force-root": true,
        registry: KIT_ROOT,
        url: undefined,
        ref: undefined,
        refresh: false,
      },
    });
  } finally {
    out.restore();
  }
  return out.lines.join("\n");
}

describe("update after the cursor-skills clean-room rewrite", () => {
  const originalExitCode = process.exitCode;
  const originalEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

  beforeEach(async () => {
    const home = await mkdtemp(path.join(tmpdir(), "ak-update-retired-home-"));
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("replaces the old files in place, removes unedited groovy and drops it from the manifest", async () => {
    const consumer = await consumerBeforeRewrite(OLD_GROOVY);
    const text = await runUpdate(consumer);

    expect(process.exitCode ?? 0).toBe(0);
    // Same names, new kit-authored content; no second copy under another name.
    const nodeNow = await readFile(path.join(consumer, NODE_SKILL), "utf8");
    expect(nodeNow).toBe(
      await readFile(
        path.join(KIT_ROOT, "registry/skills/community/cursor-skills-node/SKILL.md"),
        "utf8",
      ),
    );
    expect(nodeNow).not.toContain("CURSOR-SKILLS");
    for (const rel of [GENERAL_RULE, DEVOPS_RULE]) {
      const body = await readFile(path.join(consumer, rel), "utf8");
      expect(body).toBe(await readFile(path.join(KIT_ROOT, rel), "utf8"));
    }
    // Groovy: file and directory gone, ledger entry gone, manifest id dropped, one line printed.
    expect(await exists(consumer, GROOVY_SKILL)).toBe(false);
    expect(await exists(consumer, path.dirname(GROOVY_SKILL))).toBe(false);
    expect(await exists(consumer, GROOVY_RULE)).toBe(false);
    const ledger = JSON.parse(await readFile(path.join(consumer, MANAGED_HASHES_REL), "utf8"));
    expect(ledger.hashes[GROOVY_SKILL]).toBeUndefined();
    const saved = JSON.parse(await readFile(path.join(consumer, ".cursor/agent-kit.json"), "utf8"));
    expect(saved.skills).toEqual(["cursor-skills-node"]);
    expect(text).toContain("Skill 'cursor-skills-groovy' was retired from the registry");
    expect(text).toContain(`- ${GROOVY_SKILL}`);
    expect(text).not.toContain("not found in registry");
    expect(text).toContain("Update complete");
  }, 60_000);

  it("keeps an edited groovy skill and reports it instead of deleting it", async () => {
    const edited = "# my own groovy notes\n";
    const consumer = await consumerBeforeRewrite(edited);
    const text = await runUpdate(consumer);

    expect(process.exitCode ?? 0).toBe(0);
    expect(await readFile(path.join(consumer, GROOVY_SKILL), "utf8")).toBe(edited);
    expect(text).toContain(GROOVY_SKILL);
    const saved = JSON.parse(await readFile(path.join(consumer, ".cursor/agent-kit.json"), "utf8"));
    expect(saved.skills).toEqual(["cursor-skills-node"]);
  }, 60_000);
});
