import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// This file ships to the public mirror (packages/cli/src/dashboard/** is public-synced),
// so it may only import what the mirror also has. The "does the allowlist cover these
// paths?" assertion lives in the private tree instead: scripts/sync-public-guards.test.mjs.

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const contractRel = "docs/contracts/mission-control-skins.json";
const contract = JSON.parse(readFileSync(join(repoRoot, contractRel), "utf8")) as {
  version: string;
  attribute: string;
  storageKey: string;
  defaultSkin: string;
  aliases: Record<string, string>;
  surfaceTokens: string[];
  sharedTokens: Record<string, string>;
  skins: Record<string, { label: string; logo: string; tokens: Record<string, string> }>;
};
const html = readFileSync(join(repoRoot, "dashboard/dashboard.html"), "utf8");

/** CSS custom properties of one rule block, comments stripped, `--` dropped. */
function tokens(block: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const body = (block ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

describe("Mission Control skins token contract (docs/contracts/mission-control-skins.json)", () => {
  it("is SemVer-versioned and names bare-metal (default) and legacy", () => {
    expect(contract.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(contract.skins)).toEqual(["bare-metal", "legacy"]);
    expect(contract.defaultSkin).toBe("bare-metal");
    expect(contract.aliases).toEqual({ cursor: "bare-metal" });
    expect(contract.attribute).toBe("data-dashboard-skin");
    expect(contract.storageKey).toBe("agent-kit:dashboard-skin");
    expect(JSON.stringify(contract)).not.toMatch(/logo-cursor/);
  });

  it("matches the shared :root tokens and both skin blocks in dashboard.html", () => {
    expect(tokens(html.match(/\n:root\s*\{([\s\S]*?)\n\}/)?.[1])).toEqual(contract.sharedTokens);
    for (const [id, skin] of Object.entries(contract.skins)) {
      const block = html.match(
        new RegExp(`\\nhtml\\[data-dashboard-skin="${id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`),
      )?.[1];
      expect(block, id).toBeTruthy();
      expect(tokens(block), id).toEqual(skin.tokens);
      expect(Object.keys(skin.tokens), id).toEqual(contract.surfaceTokens);
      expect(existsSync(join(repoRoot, skin.logo)), skin.logo).toBe(true);
      // Menu label and option id stay in step with the contract.
      expect(html).toMatch(
        new RegExp(`data-dashboard-skin-option="${id}"[^>]*>\\s*${skin.label}\\s*<\\/button>`),
      );
    }
    // Surface tokens never leak into the shared block.
    for (const name of contract.surfaceTokens) {
      expect(contract.sharedTokens[name], name).toBeUndefined();
    }
  });

  it("matches the runtime default, skin list and aliases", () => {
    expect(html).toContain(`const DASHBOARD_SKIN_KEY = '${contract.storageKey}';`);
    expect(html).toContain(`const DASHBOARD_SKIN_DEFAULT = '${contract.defaultSkin}';`);
    const skins = Object.keys(contract.skins)
      .map((id) => `'${id}'`)
      .join(", ");
    expect(html).toContain(`const DASHBOARD_SKINS = [${skins}];`);
    const aliases = Object.entries(contract.aliases)
      .map(([from, to]) => `${from}: '${to}'`)
      .join(", ");
    expect(html).toContain(`const DASHBOARD_SKIN_ALIASES = { ${aliases} };`);
  });
});
