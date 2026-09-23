import path from "node:path";
import { readJson } from "../utils/fs.js";

/** Relative path of the project context config (prefs, stamps, persona). */
export const CONTEXT_CONFIG_REL = path.join(".cursor", "context", "config.json");

export function contextConfigPath(cwd: string): string {
  return path.join(cwd, CONTEXT_CONFIG_REL);
}

/** Load `.cursor/context/config.json` or null when missing / unreadable. */
export async function loadContextConfig(cwd: string): Promise<Record<string, unknown> | null> {
  return readJson<Record<string, unknown>>(contextConfigPath(cwd));
}

/**
 * True when `lastCheckedAt` is absent, unparseable, or older than `intervalDays`.
 * Shared by kit updateCheck and cursorUpdateCheck preference gates.
 */
export function intervalElapsed(lastCheckedAt: string | null, intervalDays: number): boolean {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  if (Number.isNaN(last)) return true;
  return Date.now() - last >= intervalDays * 24 * 60 * 60 * 1000;
}
