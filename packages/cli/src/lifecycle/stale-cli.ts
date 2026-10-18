import path from "node:path";
import { compareSemver, normalizeSemver, readLocalKitVersion } from "./check-updates.js";
import { KIT_PACKAGE_SPEC, KIT_VERSION } from "./version.js";

export interface StaleCli {
  cliVersion: string;
  registryVersion: string;
}

/**
 * install and update stamp .cursor/agent-kit.json with this binary's
 * KIT_VERSION, so an apply can never deliver a version newer than the CLI
 * running it. Returns the two versions when the registry is ahead, so the
 * caller can refuse instead of writing a capped manifest.
 */
export async function detectStaleCli(
  registryRoot: string,
  options: { warn: (message: string) => void; cliVersion?: string },
): Promise<StaleCli | null> {
  const registryVersionRaw = await readLocalKitVersion(registryRoot);
  const registryVersion = registryVersionRaw ? normalizeSemver(registryVersionRaw) : null;
  const cliVersion = normalizeSemver(options.cliVersion ?? KIT_VERSION);
  if (!registryVersion) {
    // Not every registry checkout carries a package.json; that is not a
    // reason to block an apply.
    options.warn(
      "Could not read a version from the registry checkout - skipping the CLI freshness check.",
    );
    return null;
  }
  if (cliVersion && compareSemver(cliVersion, registryVersion) < 0) {
    return { cliVersion, registryVersion };
  }
  return null;
}

const SHELL_SAFE = /^[A-Za-z0-9_./:@=+,-]+$/;

function shellQuote(value: string): string {
  return SHELL_SAFE.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Re-render the flags the operator actually passed, in `flags` order, so a
 * refusal's "re-run" line does not silently drop --claude, -y, --cwd or a
 * registry pin. `cwd` is left out when it is the current directory (its
 * default); `yes` renders as `-y`.
 */
export function formatRerunFlags(
  args: Record<string, unknown>,
  flags: readonly string[],
  currentDir: string = process.cwd(),
): string {
  const out: string[] = [];
  for (const flag of flags) {
    const value = args[flag];
    if (value === true) {
      out.push(flag === "yes" ? "-y" : `--${flag}`);
    } else if (typeof value === "string" && value.length > 0) {
      if (flag === "cwd" && path.resolve(value) === path.resolve(currentDir)) continue;
      out.push(`--${flag}`, shellQuote(value));
    }
  }
  return out.join(" ");
}

export function formatStaleCliRefusal(input: {
  command: "install" | "update";
  stale: StaleCli;
  /** Everything after the subcommand, already formatted (see formatRerunFlags). */
  rerun: string;
}): { error: string; recovery: string } {
  const { command, stale, rerun } = input;
  const { cliVersion, registryVersion } = stale;
  const tail = rerun ? ` ${rerun}` : "";
  return {
    error: `This CLI is v${cliVersion}, older than the registry it would apply (v${registryVersion}).`,
    recovery: [
      "",
      `\`agent-kit ${command}\` syncs registry content but stamps .cursor/agent-kit.json with the`,
      `version of the CLI running it, so applying now would write v${cliVersion} again, not v${registryVersion}.`,
      "",
      "Upgrade the binary first, then re-run:",
      `  npm i -g ${KIT_PACKAGE_SPEC}@${registryVersion}`,
      `  agent-kit ${command}${tail}`,
      "",
      "Or run that version once without a global install:",
      `  npx -y ${KIT_PACKAGE_SPEC}@${registryVersion} ${command}${tail}`,
      "",
      `If npm has no ${registryVersion} yet, the release is still mid-publish`,
      "(content sync and npm publish run in parallel) - retry shortly.",
      "",
      "Factory/dev checkouts that intend to apply newer content with an older",
      "binary can pass --allow-stale-cli.",
      "",
    ].join("\n"),
  };
}

/** Thrown by performInstall so the command can print the refusal with the operator's flags. */
export class StaleCliError extends Error {
  constructor(readonly stale: StaleCli) {
    super(
      `This CLI is v${stale.cliVersion}, older than the registry it would apply (v${stale.registryVersion}).`,
    );
    this.name = "StaleCliError";
  }
}
