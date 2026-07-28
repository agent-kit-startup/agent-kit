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

/** Default persona when config omits `agentPersona.modes["cli-run-plan"]`. */
export const DEFAULT_CLI_PERSONA_ID = "ghost-runner";

export interface PersonaCliBanners {
  tickStart?: string;
  tickEnd?: string;
  phaseComplete?: string;
}

export interface PersonaPack {
  id: string;
  displayName?: string;
  cliBanners?: PersonaCliBanners;
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

interface PersonaConfigFile {
  agentPersona?: {
    default?: string;
    modes?: Record<string, string>;
  };
  /** Legacy key; used only when `agentPersona` is absent. */
  workspaceSkin?: {
    default?: string;
    modes?: Record<string, string>;
  };
}

/**
 * Resolve CLI persona id from `.cursor/context/config.json`.
 * Prefer `agentPersona`; fall back to legacy `workspaceSkin`.
 * Fail soft: missing/invalid config -> ghost-runner.
 */
export async function resolveCliPersonaId(root: string): Promise<string> {
  try {
    const cfg = await readJson<PersonaConfigFile>(
      path.join(root, ".cursor", "context", "config.json"),
    );
    const modes = cfg?.agentPersona?.modes ?? cfg?.workspaceSkin?.modes;
    const id = modes?.[CLI_RUN_PLAN_MODE];
    if (typeof id === "string" && id.trim()) return id.trim();
  } catch {
    // ignore parse/IO errors
  }
  return DEFAULT_CLI_PERSONA_ID;
}

/**
 * Load `registry/personas/core/<id>/persona.json` relative to project root.
 * Fail soft: missing/invalid -> null (caller keeps plain console.log).
 */
export async function loadPersonaPack(
  root: string,
  personaId: string,
): Promise<PersonaPack | null> {
  try {
    const personaPath = path.join(root, "registry", "personas", "core", personaId, "persona.json");
    const pack = await readJson<PersonaPack>(personaPath);
    if (!pack || typeof pack.id !== "string") return null;
    return pack;
  } catch {
    return null;
  }
}

/** Resolve + load the active CLI run-plan persona, or null if unavailable. */
export async function loadCliRunPlanPersona(root: string): Promise<PersonaPack | null> {
  const id = await resolveCliPersonaId(root);
  return loadPersonaPack(root, id);
}

export interface PersonaBannerPrinter {
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
 * Build banner printers from a loaded persona.
 * Returns null when there is no usable `cliBanners` (plain logs).
 */
export function createPersonaBannerPrinter(
  persona: PersonaPack | null,
): PersonaBannerPrinter | null {
  if (!persona?.cliBanners) return null;
  const banners = persona.cliBanners;
  if (!banners.tickStart && !banners.tickEnd && !banners.phaseComplete) return null;

  const primary = resolveColor(persona.ansiPalette?.primary, white);
  const secondary = resolveColor(persona.ansiPalette?.secondary, gray);
  const accent = resolveColor(persona.ansiPalette?.accent, green);

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
