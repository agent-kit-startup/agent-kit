import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CLI_SKIN_ID,
  createSkinBannerPrinter,
  loadCliRunPlanSkin,
  loadSkinPack,
  resolveCliSkinId,
} from "./skin-banners.js";

async function writeSkin(root: string, id: string, body: Record<string, unknown>): Promise<void> {
  const dir = path.join(root, "registry", "skins", "core", id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "skin.json"), `${JSON.stringify(body, null, 2)}\n`);
}

describe("skin-banners", () => {
  const logs: string[] = [];
  afterEach(() => {
    logs.length = 0;
    vi.restoreAllMocks();
  });

  it("defaults cli skin id to ghost-runner when config missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-skin-"));
    expect(await resolveCliSkinId(root)).toBe(DEFAULT_CLI_SKIN_ID);
  });

  it("reads workspaceSkin.modes[cli-run-plan] from config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-skin-"));
    const cfgDir = path.join(root, ".cursor", "context");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(
      path.join(cfgDir, "config.json"),
      JSON.stringify({
        workspaceSkin: { modes: { "cli-run-plan": "night-shift" } },
      }),
    );
    expect(await resolveCliSkinId(root)).toBe("night-shift");
  });

  it("returns null when skin.json is missing (fail soft)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-skin-"));
    expect(await loadSkinPack(root, "ghost-runner")).toBeNull();
    expect(await loadCliRunPlanSkin(root)).toBeNull();
  });

  it("loads skin pack and prints tick banners via kolorist prefixes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-skin-"));
    await writeSkin(root, "ghost-runner", {
      id: "ghost-runner",
      displayName: "Ghost Runner",
      cliBanners: {
        tickStart: "[GR] spectre online",
        tickEnd: "[GR] spectre clear",
        phaseComplete: "[GR] phase ghosted",
      },
      ansiPalette: { primary: "white", secondary: "gray", accent: "green" },
    });

    const pack = await loadCliRunPlanSkin(root);
    expect(pack?.id).toBe("ghost-runner");

    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const banners = createSkinBannerPrinter(pack);
    expect(banners).not.toBeNull();
    if (!banners) {
      throw new Error("expected skin banner printer");
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

  it("createSkinBannerPrinter returns null without cliBanners", () => {
    expect(createSkinBannerPrinter({ id: "x" })).toBeNull();
    expect(createSkinBannerPrinter(null)).toBeNull();
  });
});
