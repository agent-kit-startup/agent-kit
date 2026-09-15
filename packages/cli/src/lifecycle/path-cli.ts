/**
 * PATH `agent-kit` vs the CLI that is actually running (npx vs a stale global).
 * Does not execute the PATH binary. Version comes from env-checks (package.json).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { type EnvironmentReport, assessEnvironment } from "../readiness/env-checks.js";
import { isNonInteractive } from "../utils/terminal.js";
import { compareSemver, normalizeSemver } from "./check-updates.js";
import { KIT_VERSION, pinnedCliSpec } from "./version.js";

export type PathCliStatus = "current" | "missing" | "behind" | "unknown";

export interface PathCliSyncOptions {
  runtimeVersion?: string;
  env?: EnvironmentReport;
  /** When false, never spawn npm i -g. Default: interactive TTY (not CI / --yes). */
  autoInstall?: boolean;
  npmInstallImpl?: (spec: string) => Promise<{ ok: boolean; error?: unknown }>;
  assessEnvironmentImpl?: () => Promise<EnvironmentReport>;
}

export interface PathCliSyncResult {
  status: PathCliStatus;
  env: EnvironmentReport;
  upgraded: boolean;
  lines: string[];
}

export function npxPinned(runtimeVersion: string, subcommand: string): string {
  return `npx -y ${pinnedCliSpec(runtimeVersion)} ${subcommand}`;
}

export function isBinUnderPrefix(binPath: string, prefix: string): boolean {
  const bin = path.resolve(binPath);
  const root = path.resolve(prefix);
  return bin === root || bin.startsWith(`${root}${path.sep}`);
}

export function pathCliStatus(env: EnvironmentReport, runtimeVersion: string): PathCliStatus {
  if (!env.binOnPath || !env.binPath) return "missing";
  const running = normalizeSemver(runtimeVersion);
  const pathVer = env.binVersion ? normalizeSemver(env.binVersion) : null;
  if (!pathVer || !running) return "unknown";
  try {
    return compareSemver(pathVer, running) >= 0 ? "current" : "behind";
  } catch {
    return "unknown";
  }
}

function driftLines(env: EnvironmentReport, runtimeVersion: string): string[] {
  const pathVer = env.binVersion ?? "unknown";
  const where = env.binPath ?? "(unresolved)";
  return [
    `This CLI is v${runtimeVersion}. PATH \`agent-kit\` is v${pathVer} at:`,
    `  ${where}`,
    "Do not run bare `agent-kit update` or `init` from that binary. It re-stamps the old version.",
    "Keep using the pinned npx form until PATH matches:",
    `  ${npxPinned(runtimeVersion, "update")}`,
    `  ${npxPinned(runtimeVersion, "status")}`,
  ];
}

function isShadow(env: EnvironmentReport): boolean {
  if (!env.binPath || !env.npmPrefix.prefix) return false;
  return !isBinUnderPrefix(env.binPath, env.npmPrefix.prefix);
}

export async function spawnNpmGlobalInstall(
  spec: string,
): Promise<{ ok: boolean; error?: unknown }> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["i", "-g", spec], { stdio: "inherit" });
    child.on("error", (error) => resolve({ ok: false, error }));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: new Error(`npm exited with code ${code ?? "unknown"}`) });
    });
  });
}

/**
 * After npx install/update: never send the operator to a stale PATH binary.
 * Interactive + writable prefix: `npm i -g @dadado/agent-kit-cli@<running>`.
 * `--yes` / CI never mutate the global install; they print the pin instead.
 */
export async function syncPathCliToRuntime(
  options: PathCliSyncOptions = {},
): Promise<PathCliSyncResult> {
  const runtimeVersion = options.runtimeVersion ?? KIT_VERSION;
  const assess = options.assessEnvironmentImpl ?? assessEnvironment;
  let env = options.env ?? (await assess());
  const autoInstall = options.autoInstall ?? !isNonInteractive();
  const lines: string[] = [];

  let status = pathCliStatus(env, runtimeVersion);
  if (status === "current") {
    return { status, env, upgraded: false, lines };
  }

  if (status === "behind" || status === "unknown") {
    lines.push(...driftLines(env, runtimeVersion));
    if (isShadow(env)) {
      lines.push(
        "That PATH hit is not npm's global bin, so `npm i -g` may not replace it.",
        "Run `hash -r` and `which -a agent-kit`. Put npm's global bin first, or remove the stale shim.",
      );
    }
  }

  if (!autoInstall) {
    return { status, env, upgraded: false, lines };
  }

  if (status === "missing") {
    lines.push("No bare `agent-kit` on PATH yet (npx is ephemeral).");
  }

  if (!env.npmPrefixWritable) {
    lines.push(
      "npm's global prefix is not writable, so this process cannot upgrade PATH.",
      `Run ${npxPinned(runtimeVersion, "setup-global")} (or fix prefix permissions).`,
    );
    return { status, env, upgraded: false, lines };
  }

  const spec = pinnedCliSpec(runtimeVersion);
  const install = options.npmInstallImpl ?? spawnNpmGlobalInstall;
  lines.push(`Installing ${spec} into the writable npm prefix...`);
  const outcome = await install(spec);
  if (!outcome.ok) {
    const detail = outcome.error instanceof Error ? outcome.error.message : "npm i -g failed";
    lines.push(`Global install failed: ${detail}`);
    return { status, env, upgraded: false, lines };
  }

  env = await assess();
  status = pathCliStatus(env, runtimeVersion);
  if (status === "current") {
    lines.push(
      `PATH \`agent-kit\` is now v${env.binVersion ?? runtimeVersion}.`,
      "If this shell still shows the old version, run `hash -r` or open a new terminal.",
    );
    return { status, env, upgraded: true, lines };
  }

  lines.push(
    `Installed ${spec}, but PATH still resolves to v${env.binVersion ?? "unknown"} at:`,
    `  ${env.binPath ?? "(unresolved)"}`,
    "Run `hash -r` and `which -a agent-kit`. Until PATH matches, keep using the npx pin above.",
  );
  return { status, env, upgraded: true, lines };
}
