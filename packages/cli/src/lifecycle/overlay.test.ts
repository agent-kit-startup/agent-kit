import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROTECTED_PATHS } from "../manifest/types.js";
import { installPack } from "../registry/install.js";
import { copyRegistryFile, emptyStats, recordOutcome } from "./apply.js";
import { L0_ARTIFACTS } from "./l0.js";
import { KNOWN_SHIPPED_OVERLAY_HASHES } from "./overlay-known-hashes.js";
import {
  MANAGED_HASHES_REL,
  contentHash,
  isConsumerOverlayPath,
  loadManagedHashLedger,
  seedManagedHashLedger,
  shouldPreserveCustomizedOverlay,
} from "./overlay.js";
import { installL0 } from "./sync.js";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("KNOWN_SHIPPED_OVERLAY_HASHES coverage", () => {
  it("includes every current L0 overlay artifact body", async () => {
    const overlay = L0_ARTIFACTS.filter((a) => isConsumerOverlayPath(a.target));
    expect(overlay.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const artifact of overlay) {
      const body = await readFile(path.join(kitRoot, artifact.source), "utf8");
      if (!KNOWN_SHIPPED_OVERLAY_HASHES.has(contentHash(body))) {
        missing.push(artifact.source);
      }
    }
    expect(missing).toEqual([]);
  });

  it("includes every registry skill SKILL.md body (core + community)", async () => {
    const reg = JSON.parse(
      await readFile(path.join(kitRoot, "registry/registry.json"), "utf8"),
    ) as {
      skills?: {
        core?: Array<{ path: string; id: string }>;
        community?: Array<{ path: string; id: string }>;
      };
    };
    const entries = [...(reg.skills?.core || []), ...(reg.skills?.community || [])];
    expect(entries.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const skill of entries) {
      const source = path.join(skill.path, "SKILL.md");
      const body = await readFile(path.join(kitRoot, source), "utf8");
      if (!KNOWN_SHIPPED_OVERLAY_HASHES.has(contentHash(body))) {
        missing.push(source);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("consumer overlay path detection", () => {
  it("matches agents, skills, and commands only", () => {
    expect(isConsumerOverlayPath(".cursor/agents/foo.md")).toBe(true);
    expect(isConsumerOverlayPath(".cursor/skills/core/clean-code/SKILL.md")).toBe(true);
    expect(isConsumerOverlayPath(".cursor/commands/start-project.md")).toBe(true);
    expect(isConsumerOverlayPath(".cursor/rules/ux-tone.mdc")).toBe(false);
    expect(isConsumerOverlayPath(".cursor/HANDOFF.md")).toBe(false);
  });

  it("preserves customized or unknown when ledger-absent; refreshes known shipped", () => {
    const custom = "custom\n";
    expect(shouldPreserveCustomizedOverlay(custom, undefined)).toBe(true);
    expect(shouldPreserveCustomizedOverlay(custom, contentHash(custom))).toBe(false);
    expect(shouldPreserveCustomizedOverlay(custom, contentHash("kit\n"))).toBe(true);

    const knownBody = "shipped kit body\n";
    const known = new Set([contentHash(knownBody)]);
    expect(shouldPreserveCustomizedOverlay(knownBody, undefined, known)).toBe(false);
    expect(shouldPreserveCustomizedOverlay(custom, undefined, known)).toBe(true);
  });
});

describe("consumer overlay apply policy", () => {
  it("preserves customized kit command when ledger marks prior managed hash", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-overlay-preserve-"));
    const cmdRel = ".cursor/commands/summary.md";
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });
    const custom = "# Custom summary\nlocal edit\n";
    await writeFile(path.join(project, cmdRel), custom, "utf8");

    // Seed ledger as if the previous managed content was kit-owned (not custom).
    const ledgerPath = path.join(project, MANAGED_HASHES_REL);
    await writeFile(
      ledgerPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          hashes: { [cmdRel]: contentHash("# Command: /summary\n\nManaged.\n") },
        },
        null,
        2,
      ),
      "utf8",
    );

    const outcome = await copyRegistryFile(kitRoot, project, cmdRel, cmdRel, [
      ...DEFAULT_PROTECTED_PATHS,
    ]);
    expect(outcome).toBe("preserved-customized");
    expect(await readFile(path.join(project, cmdRel), "utf8")).toBe(custom);
  });

  it("preserves customized kit command when no ledger present (R1)", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-overlay-no-ledger-custom-"));
    const cmdRel = ".cursor/commands/summary.md";
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });
    const custom = "# Custom summary\nlocal edit before ledger existed\n";
    await writeFile(path.join(project, cmdRel), custom, "utf8");
    // Intentionally no managed-hashes ledger (upgrade-into-overlay case).

    const kitContent = await readFile(path.join(kitRoot, cmdRel), "utf8");
    expect(custom).not.toBe(kitContent);

    const outcome = await copyRegistryFile(kitRoot, project, cmdRel, cmdRel, [
      ...DEFAULT_PROTECTED_PATHS,
    ]);
    expect(outcome).toBe("preserved-customized");
    expect(await readFile(path.join(project, cmdRel), "utf8")).toBe(custom);

    const ledger = await loadManagedHashLedger(project);
    // Seeded with incoming kit hash as last-managed so later updates keep preserving.
    expect(ledger.hashes[cmdRel]).toBe(contentHash(kitContent));
  });

  it("refreshes unedited kit command when no ledger and local matches known shipped hash", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-overlay-no-ledger-refresh-"));
    const registry = await mkdtemp(path.join(tmpdir(), "agent-kit-overlay-registry-"));
    const cmdRel = ".cursor/commands/summary.md";
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });
    await mkdir(path.join(registry, ".cursor/commands"), { recursive: true });

    const shipped = await readFile(path.join(kitRoot, cmdRel), "utf8");
    expect(KNOWN_SHIPPED_OVERLAY_HASHES.has(contentHash(shipped))).toBe(true);

    const newer = `${shipped}\n<!-- kit bump -->\n`;
    await writeFile(path.join(project, cmdRel), shipped, "utf8");
    await writeFile(path.join(registry, cmdRel), newer, "utf8");
    // No ledger.

    const outcome = await copyRegistryFile(registry, project, cmdRel, cmdRel, [
      ...DEFAULT_PROTECTED_PATHS,
    ]);
    expect(outcome).toBe("written");
    expect(await readFile(path.join(project, cmdRel), "utf8")).toBe(newer);
    const ledger = await loadManagedHashLedger(project);
    expect(ledger.hashes[cmdRel]).toBe(contentHash(newer));
  });

  it("end-to-end: ledger-absent update refreshes known shipped and preserves customized peers", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-overlay-e2e-update-"));
    const registry = await mkdtemp(path.join(tmpdir(), "agent-kit-overlay-registry-e2e-"));
    const uneditedRel = ".cursor/commands/summary.md";
    const customRel = ".cursor/commands/tips.md";
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });
    await mkdir(path.join(registry, ".cursor/commands"), { recursive: true });

    const shippedSummary = await readFile(path.join(kitRoot, uneditedRel), "utf8");
    const shippedTips = await readFile(path.join(kitRoot, customRel), "utf8");
    expect(KNOWN_SHIPPED_OVERLAY_HASHES.has(contentHash(shippedSummary))).toBe(true);

    const bumpedSummary = `${shippedSummary}\n<!-- bump summary -->\n`;
    const bumpedTips = `${shippedTips}\n<!-- bump tips -->\n`;
    const customTips = `${shippedTips}\n<!-- consumer edit -->\n`;

    await writeFile(path.join(project, uneditedRel), shippedSummary, "utf8");
    await writeFile(path.join(project, customRel), customTips, "utf8");
    await writeFile(path.join(registry, uneditedRel), bumpedSummary, "utf8");
    await writeFile(path.join(registry, customRel), bumpedTips, "utf8");

    const outcomes = {
      unedited: await copyRegistryFile(registry, project, uneditedRel, uneditedRel, [
        ...DEFAULT_PROTECTED_PATHS,
      ]),
      custom: await copyRegistryFile(registry, project, customRel, customRel, [
        ...DEFAULT_PROTECTED_PATHS,
      ]),
    };

    expect(outcomes.unedited).toBe("written");
    expect(outcomes.custom).toBe("preserved-customized");
    expect(await readFile(path.join(project, uneditedRel), "utf8")).toBe(bumpedSummary);
    expect(await readFile(path.join(project, customRel), "utf8")).toBe(customTips);
  });

  it("refreshes unedited kit command when local hash matches ledger", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-overlay-refresh-"));
    const cmdRel = ".cursor/commands/summary.md";
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });

    const kitContent = await readFile(path.join(kitRoot, cmdRel), "utf8");
    // Local matches ledger (unedited); registry source differs → refresh.
    const oldManaged = "# Command: /summary\n\nold managed\n";
    await writeFile(path.join(project, cmdRel), oldManaged, "utf8");
    await writeFile(
      path.join(project, MANAGED_HASHES_REL),
      JSON.stringify({ schemaVersion: 1, hashes: { [cmdRel]: contentHash(oldManaged) } }, null, 2),
      "utf8",
    );

    const outcome = await copyRegistryFile(kitRoot, project, cmdRel, cmdRel, [
      ...DEFAULT_PROTECTED_PATHS,
    ]);
    expect(outcome).toBe("written");
    expect(await readFile(path.join(project, cmdRel), "utf8")).toBe(kitContent);
    const ledger = await loadManagedHashLedger(project);
    expect(ledger.hashes[cmdRel]).toBe(contentHash(kitContent));
  });

  it("documents that user-added agent basenames are outside the L0 apply set", async () => {
    // L0 has no .cursor/agents/ sources; installL0 never writes that tree.
    // This only proves basename survival via non-membership, not overlay preserve.
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-overlay-user-agent-"));
    await mkdir(path.join(project, ".cursor/agents"), { recursive: true });
    const userAgent = "# My local agent\n";
    await writeFile(path.join(project, ".cursor/agents/my-local-agent.md"), userAgent, "utf8");

    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);
    expect(stats.written.some((p) => p.includes(".cursor/commands/"))).toBe(true);
    expect(stats.written.some((p) => p.includes(".cursor/agents/"))).toBe(false);
    expect(await readFile(path.join(project, ".cursor/agents/my-local-agent.md"), "utf8")).toBe(
      userAgent,
    );
  });

  it("preserves customized pack-installed agent on reinstall (R5)", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-overlay-pack-agent-"));
    const protectedGlobs = [...DEFAULT_PROTECTED_PATHS];
    const agentRel = ".cursor/agents/cleancode-refactor.md";

    const first = await installPack(kitRoot, project, "clean-code", { protectedGlobs });
    expect(first.written).toContain(agentRel);

    const kitBody = await readFile(path.join(project, agentRel), "utf8");
    const custom = `${kitBody}\n<!-- local agent customization -->\n`;
    await writeFile(path.join(project, agentRel), custom, "utf8");

    const second = await installPack(kitRoot, project, "clean-code", { protectedGlobs });
    expect(second.preservedCustomized).toContain(agentRel);
    expect(await readFile(path.join(project, agentRel), "utf8")).toBe(custom);
  });

  it("records preserved-customized in ApplyStats via recordOutcome", () => {
    const stats = emptyStats();
    recordOutcome(stats, ".cursor/commands/summary.md", "preserved-customized");
    expect(stats.preservedCustomized).toEqual([".cursor/commands/summary.md"]);
  });

  it("seeds managed-hash ledger from current local overlay files", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-seed-ledger-"));
    const cmdRel = ".cursor/commands/summary.md";
    const skillRel = ".cursor/skills/core/clean-code/SKILL.md";
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });
    await mkdir(path.join(project, ".cursor/skills/core/clean-code"), { recursive: true });
    await writeFile(path.join(project, cmdRel), "# Local summary\n", "utf8");
    await writeFile(path.join(project, skillRel), "# Local skill\n", "utf8");

    await seedManagedHashLedger(project);

    const ledger = await loadManagedHashLedger(project);
    expect(ledger.hashes[cmdRel]).toBe(contentHash("# Local summary\n"));
    expect(ledger.hashes[skillRel]).toBe(contentHash("# Local skill\n"));
  });

  it("does not overwrite existing ledger entries when seeding", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-seed-no-clobber-"));
    const cmdRel = ".cursor/commands/summary.md";
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });
    await writeFile(path.join(project, cmdRel), "# Local summary\n", "utf8");
    await writeFile(
      path.join(project, MANAGED_HASHES_REL),
      JSON.stringify({ schemaVersion: 1, hashes: { [cmdRel]: "existing-hash" } }, null, 2),
      "utf8",
    );

    await seedManagedHashLedger(project);

    const ledger = await loadManagedHashLedger(project);
    expect(ledger.hashes[cmdRel]).toBe("existing-hash");
  });
});
