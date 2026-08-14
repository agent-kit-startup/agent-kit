import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { loadAgentKitManifest } from "../manifest/index.js";
import type { AgentKitManifest } from "../manifest/types.js";
import {
  DEFAULT_REGISTRY_URL,
  assertSafeRegistrySource,
  resolveRegistryRoot,
} from "../registry/resolve.js";
import { readJson, writeJson } from "../utils/fs.js";
import { diffAgainstRegistry, summarizeDiff } from "./diff.js";

const execFileAsync = promisify(execFile);

const SEMVER_CORE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i;
const FACTORY_URL_MARKERS = ["agent-kit-dev"];
const FACTORY_REFS = new Set(["staging", "homologacao", "develop", "dev"]);

export type UpdateCheckStatus =
  | "up-to-date"
  | "update-available"
  | "ahead-of-public"
  | "skipped-factory"
  | "skipped-disabled"
  | "skipped-interval"
  | "skipped-no-manifest"
  | "error";

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  installedVersion: string | null;
  latestVersion: string | null;
  registryUrl: string | null;
  registryRef: string | null;
  /** Always false: check never applies L0 writes. */
  applyRecommended: false;
  message: string;
}

export interface UpdateCheckPrefs {
  enabled: boolean;
  intervalDays: number;
  lastCheckedAt: string | null;
}

export interface UpdateApplyPrefs {
  /** Must default false; never silent apply. */
  auto: boolean;
}

const DEFAULT_UPDATE_CHECK: UpdateCheckPrefs = {
  enabled: false,
  intervalDays: 7,
  lastCheckedAt: null,
};

const DEFAULT_UPDATE_APPLY: UpdateApplyPrefs = {
  auto: false,
};

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_ALLOW_PROTOCOL: "https" };
}

/** Compare two semver strings (optional leading v). Returns -1 / 0 / 1. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  if (!pa || !pb) {
    throw new Error(`Invalid semver for compare: "${a}" vs "${b}"`);
  }
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function parseSemverParts(version: string): [number, number, number] | null {
  const m = SEMVER_CORE.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Normalize tag/version to X.Y.Z without leading v. */
export function normalizeSemver(version: string): string | null {
  const parts = parseSemverParts(version);
  if (!parts) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

/**
 * Factory/dogfood installs must not be treated as public consumers.
 * Matches agent-kit-dev URL or non-public pre-prod refs (staging/develop/…).
 */
export function isFactoryOrDevRegistry(url?: string | null, ref?: string | null): boolean {
  if (url) {
    const lower = url.toLowerCase();
    if (FACTORY_URL_MARKERS.some((m) => lower.includes(m))) return true;
  }
  if (ref && FACTORY_REFS.has(ref.toLowerCase())) return true;
  return false;
}

/** Pick highest semver among git ls-remote tag lines (refs/tags/vX.Y.Z). */
export function pickLatestSemverTag(lsRemoteStdout: string): string | null {
  let best: string | null = null;
  for (const line of lsRemoteStdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const ref = trimmed.split(/\s+/)[1];
    if (!ref?.startsWith("refs/tags/")) continue;
    if (ref.endsWith("^{}")) continue;
    const tag = ref.slice("refs/tags/".length);
    const norm = normalizeSemver(tag);
    if (!norm) continue;
    if (!best || compareSemver(norm, best) > 0) best = norm;
  }
  return best;
}

export async function fetchLatestPublicVersion(
  registryUrl: string = DEFAULT_REGISTRY_URL,
): Promise<string | null> {
  assertSafeRegistrySource(registryUrl, "main");
  const { stdout } = await execFileAsync("git", ["ls-remote", "--tags", "--", registryUrl], {
    env: gitEnv(),
    timeout: 20_000,
  });
  return pickLatestSemverTag(stdout);
}

export function readUpdateCheckPrefs(config: unknown): UpdateCheckPrefs {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ...DEFAULT_UPDATE_CHECK };
  }
  const raw = (config as Record<string, unknown>).updateCheck;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_UPDATE_CHECK };
  }
  const uc = raw as Record<string, unknown>;
  const intervalDays =
    typeof uc.intervalDays === "number" && Number.isInteger(uc.intervalDays) && uc.intervalDays >= 1
      ? uc.intervalDays
      : DEFAULT_UPDATE_CHECK.intervalDays;
  return {
    enabled: uc.enabled === true,
    intervalDays,
    lastCheckedAt: typeof uc.lastCheckedAt === "string" ? uc.lastCheckedAt : null,
  };
}

export function readUpdateApplyPrefs(config: unknown): UpdateApplyPrefs {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ...DEFAULT_UPDATE_APPLY };
  }
  const raw = (config as Record<string, unknown>).updateApply;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_UPDATE_APPLY };
  }
  return {
    // Hard default: never true unless explicitly set (still never silent in product paths).
    auto: (raw as Record<string, unknown>).auto === true,
  };
}

function intervalElapsed(lastCheckedAt: string | null, intervalDays: number): boolean {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  if (Number.isNaN(last)) return true;
  const ms = intervalDays * 24 * 60 * 60 * 1000;
  return Date.now() - last >= ms;
}

async function loadContextConfig(cwd: string): Promise<Record<string, unknown> | null> {
  const configPath = path.join(cwd, ".cursor", "context", "config.json");
  return readJson<Record<string, unknown>>(configPath);
}

async function stampLastCheckedAt(cwd: string): Promise<void> {
  const configPath = path.join(cwd, ".cursor", "context", "config.json");
  const existing = (await loadContextConfig(cwd)) ?? {};
  const prev =
    existing.updateCheck && typeof existing.updateCheck === "object"
      ? { ...(existing.updateCheck as Record<string, unknown>) }
      : {};
  existing.updateCheck = {
    ...DEFAULT_UPDATE_CHECK,
    ...prev,
    lastCheckedAt: new Date().toISOString(),
  };
  await writeJson(configPath, existing);
}

export interface CheckForUpdatesOptions {
  /** When true, honor updateCheck.enabled + intervalDays from config. */
  respectPrefs?: boolean;
  /** Persist updateCheck.lastCheckedAt after a network check. */
  stamp?: boolean;
  /** Override public registry URL for tag lookup (HTTPS only). */
  publicRegistryUrl?: string;
  /** Local kit checkout (`--registry`). Compared instead of public tags. */
  registryPath?: string;
  /** Injected latest version (tests). */
  latestVersion?: string | null;
  /** Injected now (tests). */
  now?: Date;
}

async function readLocalKitVersion(registryRoot: string): Promise<string | null> {
  for (const rel of ["packages/cli/package.json", "package.json"] as const) {
    const data = await readJson<{ version?: unknown }>(path.join(registryRoot, rel));
    if (data && typeof data.version === "string" && data.version.length > 0) {
      return data.version;
    }
  }
  return null;
}

async function checkAgainstLocalRegistry(
  cwd: string,
  manifest: AgentKitManifest,
  options: CheckForUpdatesOptions,
): Promise<UpdateCheckResult> {
  const registryPath = options.registryPath;
  if (!registryPath) {
    throw new Error("checkAgainstLocalRegistry requires registryPath");
  }

  let resolved: Awaited<ReturnType<typeof resolveRegistryRoot>>;
  try {
    resolved = await resolveRegistryRoot({ cwd, registryPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      installedVersion: manifest.version,
      latestVersion: null,
      registryUrl: path.resolve(registryPath),
      registryRef: "local",
      applyRecommended: false,
      message: `Failed to resolve --registry: ${msg}`,
    };
  }

  const registryUrl = resolved.root;
  const registryRef = "local";

  try {
    let latest: string | null;
    if (options.latestVersion !== undefined) {
      latest = options.latestVersion;
    } else {
      const raw = await readLocalKitVersion(resolved.root);
      latest = raw ? normalizeSemver(raw) : null;
    }

    const summary = summarizeDiff(await diffAgainstRegistry(resolved.root, cwd, manifest));
    const hasFileDrift = summary.drift > 0 || summary["missing-local"] > 0;

    const installed = normalizeSemver(manifest.version);
    if (!installed) {
      return {
        status: "error",
        installedVersion: manifest.version,
        latestVersion: latest,
        registryUrl,
        registryRef,
        applyRecommended: false,
        message: `Installed version "${manifest.version}" is not valid semver.`,
      };
    }

    if (!latest) {
      return {
        status: "error",
        installedVersion: installed,
        latestVersion: null,
        registryUrl,
        registryRef,
        applyRecommended: false,
        message:
          "No semver found in the local --registry checkout (packages/cli/package.json or package.json).",
      };
    }

    const cmp = compareSemver(installed, latest);
    if (hasFileDrift) {
      return {
        status: "update-available",
        installedVersion: installed,
        latestVersion: latest,
        registryUrl,
        registryRef,
        applyRecommended: false,
        message: `Local registry has drift vs this install (drift=${summary.drift}, missing-local=${summary["missing-local"]}; source v${latest}). Run /update --registry <path> (Ask confirm) to apply; never silent.`,
      };
    }
    if (cmp === 0) {
      return {
        status: "up-to-date",
        installedVersion: installed,
        latestVersion: latest,
        registryUrl,
        registryRef,
        applyRecommended: false,
        message: `Installed v${installed} matches local registry v${latest}.`,
      };
    }
    if (cmp < 0) {
      return {
        status: "update-available",
        installedVersion: installed,
        latestVersion: latest,
        registryUrl,
        registryRef,
        applyRecommended: false,
        message: `Update available from local registry: v${installed} → v${latest}. Run /update --registry <path> (Ask confirm) to apply; never silent.`,
      };
    }
    return {
      status: "ahead-of-public",
      installedVersion: installed,
      latestVersion: latest,
      registryUrl,
      registryRef,
      applyRecommended: false,
      message: `Installed v${installed} is ahead of local registry v${latest}.`,
    };
  } finally {
    await resolved.unlock?.();
  }
}

/**
 * Check-only: compare installed manifest version to latest public tag,
 * or to a local `--registry` checkout when `registryPath` is set.
 * Never writes L0 / packs / skills. applyRecommended is always false.
 */
export async function checkForUpdates(
  cwd: string,
  options: CheckForUpdatesOptions = {},
): Promise<UpdateCheckResult> {
  const manifest = await loadAgentKitManifest(cwd);
  if (!manifest) {
    return {
      status: "skipped-no-manifest",
      installedVersion: null,
      latestVersion: null,
      registryUrl: null,
      registryRef: null,
      applyRecommended: false,
      message: "No .cursor/agent-kit.json — run agent-kit install first.",
    };
  }

  if (options.registryPath) {
    return checkAgainstLocalRegistry(cwd, manifest, options);
  }

  const registryUrl = options.publicRegistryUrl ?? manifest.registry?.url ?? null;
  const registryRef = manifest.registry?.ref ?? null;

  if (isFactoryOrDevRegistry(registryUrl, registryRef)) {
    return {
      status: "skipped-factory",
      installedVersion: manifest.version,
      latestVersion: null,
      registryUrl,
      registryRef,
      applyRecommended: false,
      message:
        "Factory/dev registry detected — skipping public update check. Use /update only with explicit consumer intent.",
    };
  }

  if (options.respectPrefs) {
    const config = await loadContextConfig(cwd);
    const prefs = readUpdateCheckPrefs(config);
    if (!prefs.enabled) {
      return {
        status: "skipped-disabled",
        installedVersion: manifest.version,
        latestVersion: null,
        registryUrl,
        registryRef,
        applyRecommended: false,
        message:
          "updateCheck.enabled is false (opt-in). Set true in .cursor/context/config.json to nudge.",
      };
    }
    if (!intervalElapsed(prefs.lastCheckedAt, prefs.intervalDays)) {
      return {
        status: "skipped-interval",
        installedVersion: manifest.version,
        latestVersion: null,
        registryUrl,
        registryRef,
        applyRecommended: false,
        message: `Within updateCheck.intervalDays (${prefs.intervalDays}); last check ${prefs.lastCheckedAt}.`,
      };
    }
  }

  let latest: string | null;
  try {
    latest =
      options.latestVersion !== undefined
        ? options.latestVersion
        : await fetchLatestPublicVersion(options.publicRegistryUrl ?? DEFAULT_REGISTRY_URL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      installedVersion: manifest.version,
      latestVersion: null,
      registryUrl,
      registryRef,
      applyRecommended: false,
      message: `Failed to fetch public tags: ${msg}`,
    };
  }

  if (options.stamp) {
    try {
      await stampLastCheckedAt(cwd);
    } catch {
      // Stamp is best-effort; check result still valid.
    }
  }

  const installed = normalizeSemver(manifest.version);
  if (!installed) {
    return {
      status: "error",
      installedVersion: manifest.version,
      latestVersion: latest,
      registryUrl,
      registryRef,
      applyRecommended: false,
      message: `Installed version "${manifest.version}" is not valid semver.`,
    };
  }

  if (!latest) {
    return {
      status: "error",
      installedVersion: installed,
      latestVersion: null,
      registryUrl,
      registryRef,
      applyRecommended: false,
      message: "No semver tags found on the public registry.",
    };
  }

  const cmp = compareSemver(installed, latest);
  if (cmp === 0) {
    return {
      status: "up-to-date",
      installedVersion: installed,
      latestVersion: latest,
      registryUrl,
      registryRef,
      applyRecommended: false,
      message: `Installed v${installed} matches latest public v${latest}.`,
    };
  }
  if (cmp < 0) {
    return {
      status: "update-available",
      installedVersion: installed,
      latestVersion: latest,
      registryUrl,
      registryRef,
      applyRecommended: false,
      message: `Update available: v${installed} → v${latest}. Run /update (Ask confirm) to apply; never silent.`,
    };
  }
  return {
    status: "ahead-of-public",
    installedVersion: installed,
    latestVersion: latest,
    registryUrl,
    registryRef,
    applyRecommended: false,
    message: `Installed v${installed} is ahead of latest public v${latest} (dev/local build).`,
  };
}
