import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CLI_PERSONA_ID,
  createPersonaBannerPrinter,
  loadCliRunPlanPersona,
  loadPersonaPack,
  resolveCliPersonaId,
} from "./persona-banners.js";

async function writePersona(
  root: string,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  const dir = path.join(root, "registry", "personas", "core", id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "persona.json"), `${JSON.stringify(body, null, 2)}\n`);
}

describe("persona-banners", () => {
  const logs: string[] = [];
  afterEach(() => {
    logs.length = 0;
    vi.restoreAllMocks();
  });

  it("defaults cli persona id to ghost-runner when config missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-persona-"));
    expect(await resolveCliPersonaId(root)).toBe(DEFAULT_CLI_PERSONA_ID);
  });

  it("reads agentPersona.modes[cli-run-plan] from config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-persona-"));
    const cfgDir = path.join(root, ".cursor", "context");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(
      path.join(cfgDir, "config.json"),
      JSON.stringify({
        agentPersona: { modes: { "cli-run-plan": "night-shift" } },
      }),
    );
    expect(await resolveCliPersonaId(root)).toBe("night-shift");
  });

  it("falls back to legacy workspaceSkin when agentPersona is absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-persona-"));
    const cfgDir = path.join(root, ".cursor", "context");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(
      path.join(cfgDir, "config.json"),
      JSON.stringify({
        workspaceSkin: { modes: { "cli-run-plan": "autopilot" } },
      }),
    );
    expect(await resolveCliPersonaId(root)).toBe("autopilot");
  });

  it("prefers agentPersona when both keys are present", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-persona-"));
    const cfgDir = path.join(root, ".cursor", "context");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(
      path.join(cfgDir, "config.json"),
      JSON.stringify({
        agentPersona: { modes: { "cli-run-plan": "ghost-runner" } },
        workspaceSkin: { modes: { "cli-run-plan": "night-shift" } },
      }),
    );
    expect(await resolveCliPersonaId(root)).toBe("ghost-runner");
  });

  it("returns null when persona.json is missing (fail soft)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-persona-"));
    expect(await loadPersonaPack(root, "ghost-runner")).toBeNull();
    expect(await loadCliRunPlanPersona(root)).toBeNull();
  });

  it("loads persona pack and prints tick banners via kolorist prefixes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-persona-"));
    await writePersona(root, "ghost-runner", {
      id: "ghost-runner",
      displayName: "Ghost Runner",
      cliBanners: {
        tickStart: "👻 [GR] spectre online",
        tickEnd: "💨 [GR] spectre clear",
        phaseComplete: "✅ [GR] phase ghosted",
      },
      ansiPalette: { primary: "white", secondary: "gray", accent: "green" },
    });

    const pack = await loadCliRunPlanPersona(root);
    expect(pack?.id).toBe("ghost-runner");

    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const banners = createPersonaBannerPrinter(pack);
    expect(banners).not.toBeNull();
    if (!banners) {
      throw new Error("expected persona banner printer");
    }
    banners.tickStart("=== tick 1/2 ===");
    banners.tickEnd("pending: 1");
    banners.sleep(5);
    banners.phaseComplete("after 1 tick(s)");
    banners.stop("budget reached");

    expect(logs[0]).toContain("[GR] spectre online");
    expect(logs[0]).toContain("=== tick 1/2 ===");
    expect(logs[1]).toContain("[GR] spectre clear");
    expect(logs[2]).toContain("sleep 5s");
    expect(logs[3]).toContain("[GR] phase ghosted");
    expect(logs[4]).toContain("budget reached");
  });

  it("createPersonaBannerPrinter returns null without cliBanners", () => {
    expect(createPersonaBannerPrinter({ id: "x" })).toBeNull();
    expect(createPersonaBannerPrinter(null)).toBeNull();
  });

  it("keeps shipped core cliBanners prefixes at or under 40 characters", async () => {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    let repoRoot: string | null = null;
    for (;;) {
      if (
        existsSync(path.join(dir, "registry", "personas", "core", "ghost-runner", "persona.json"))
      ) {
        repoRoot = dir;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    expect(repoRoot).not.toBeNull();
    const coreDir = path.join(repoRoot ?? "", "registry", "personas", "core");
    const ids = await readdir(coreDir);
    expect(ids.length).toBeGreaterThan(0);
    let packs = 0;
    for (const id of ids) {
      const personaPath = path.join(coreDir, id, "persona.json");
      if (!existsSync(personaPath)) continue;
      packs += 1;
      const raw = await readFile(personaPath, "utf8");
      const pack = JSON.parse(raw) as { cliBanners?: Record<string, string> };
      for (const [key, value] of Object.entries(pack.cliBanners ?? {})) {
        expect(value.length, `${id} ${key}`).toBeLessThanOrEqual(40);
      }
    }
    expect(packs).toBeGreaterThan(0);
  });
});
