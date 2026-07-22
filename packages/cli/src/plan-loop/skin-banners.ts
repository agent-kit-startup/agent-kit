import path from "node:path";
import {
  blue,
  cyan,
  gray,
  green,
  lightGray,
  lightGreen,
  magenta,
  red,
  white,
  yellow,
} from "kolorist";
import { readJson } from "../utils/fs.js";

/** Config mode key for headless `agent-kit run-plan`. */
export const CLI_RUN_PLAN_MODE = "cli-run-plan";

/** Default skin when config omits `workspaceSkin.modes["cli-run-plan"]`. */
export const DEFAULT_CLI_SKIN_ID = "ghost-runner";

export interface SkinCliBanners {
  tickStart?: string;
  tickEnd?: string;
  phaseComplete?: string;
}

export interface SkinPack {
  id: string;
  displayName?: string;
  cliBanners?: SkinCliBanners;
  ansiPalette?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
}

type ColorFn = (s: string) => string;

const COLORS: Record<string, ColorFn> = {
  white,
  gray,
  green,
  cyan,
  magenta,
  yellow,
  red,
  blue,
  "light-green": lightGreen,
  lightgreen: lightGreen,
  "light-gray": lightGray,
  lightgray: lightGray,
};

function resolveColor(name: string | undefined, fallback: ColorFn): ColorFn {
  if (!name) return fallback;
  return COLORS[name.toLowerCase()] ?? fallback;
}

interface WorkspaceSkinConfig {
  workspaceSkin?: {
    default?: string;
    modes?: Record<string, string>;
  };
}

/**
 * Resolve CLI skin id from `.cursor/context/config.json`.
 * Fail soft: missing/invalid config -> ghost-runner.
 */
export async function resolveCliSkinId(root: string): Promise<string> {
  try {
    const cfg = await readJson<WorkspaceSkinConfig>(
      path.join(root, ".cursor", "context", "config.json"),
    );
    const id = cfg?.workspaceSkin?.modes?.[CLI_RUN_PLAN_MODE];
    if (typeof id === "string" && id.trim()) return id.trim();
  } catch {
    // ignore parse/IO errors
  }
  return DEFAULT_CLI_SKIN_ID;
}

/**
 * Load `registry/skins/core/<id>/skin.json` relative to project root.
 * Fail soft: missing/invalid -> null (caller keeps plain console.log).
 */
export async function loadSkinPack(root: string, skinId: string): Promise<SkinPack | null> {
  try {
    const skinPath = path.join(root, "registry", "skins", "core", skinId, "skin.json");
    const pack = await readJson<SkinPack>(skinPath);
    if (!pack || typeof pack.id !== "string") return null;
    return pack;
  } catch {
    return null;
  }
}

/** Resolve + load the active CLI run-plan skin, or null if unavailable. */
export async function loadCliRunPlanSkin(root: string): Promise<SkinPack | null> {
  const id = await resolveCliSkinId(root);
  return loadSkinPack(root, id);
}

export interface SkinBannerPrinter {
  /** Tick start: prefix from `cliBanners.tickStart` + detail line. */
  tickStart(detail: string): void;
  /** Tick end after agent returns. */
  tickEnd(detail?: string): void;
  /** Loop finished / phase ghosted. */
  phaseComplete(detail?: string): void;
  /** Optional quiet line before inter-tick sleep. */
  sleep(seconds: number): void;
  /** Optional chrome when the loop stops early. */
  stop(reason: string): void;
}

/**
 * Build banner printers from a loaded skin.
 * Returns null when there is no usable `cliBanners` (plain logs).
 */
export function createSkinBannerPrinter(skin: SkinPack | null): SkinBannerPrinter | null {
  if (!skin?.cliBanners) return null;
  const banners = skin.cliBanners;
  if (!banners.tickStart && !banners.tickEnd && !banners.phaseComplete) return null;

  const primary = resolveColor(skin.ansiPalette?.primary, white);
  const secondary = resolveColor(skin.ansiPalette?.secondary, gray);
  const accent = resolveColor(skin.ansiPalette?.accent, green);

  return {
    tickStart(detail: string) {
      if (banners.tickStart) {
        console.log(`${accent(banners.tickStart)} ${primary(detail)}`);
      } else {
        console.log(primary(detail));
      }
    },
    tickEnd(detail?: string) {
      if (!banners.tickEnd) return;
      const line = detail ? `${banners.tickEnd} ${detail}` : banners.tickEnd;
      console.log(secondary(line));
    },
    phaseComplete(detail?: string) {
      if (!banners.phaseComplete) return;
      const line = detail ? `${banners.phaseComplete} ${detail}` : banners.phaseComplete;
      console.log(accent(line));
    },
    sleep(seconds: number) {
      console.log(secondary(`sleep ${seconds}s`));
    },
    stop(reason: string) {
      if (banners.tickEnd) {
        console.log(secondary(`${banners.tickEnd} ${reason}`));
      }
    },
  };
}
