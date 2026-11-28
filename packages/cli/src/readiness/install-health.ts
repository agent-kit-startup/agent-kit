/**
 * Install health for `agent-kit doctor` and Mission Control Health.
 *
 * Four read-only checks about how the kit is installed on this machine,
 * not about the repository:
 *   (a) global-cli    the CLI on PATH vs npm `latest` (both package names);
 *   (b) node-manager  the CLI lives inside a per-version node dir (mise, nvm,
 *                     nvm-windows, fnm), so its globals vanish on the next node
 *                     switch or patch;
 *   (c) home-install  a home-level kit install under `~/.cursor` older than
 *                     this repo's kit (its rules/hooks apply in every workspace);
 *   (d) registry-pin  a semver `registry.ref` pin older than the CLI, so
 *                     `update` would re-apply an old tree.
 *
 * Every check is a pure function over injected inputs (paths, env, versions,
 * fetched latest). The gatherer reads the filesystem through injectable
 * helpers and never moves, installs or writes anything except the snapshot
 * that Mission Control reads (`.cursor/context/install-health.json`).
 */

import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  CLI_NPM_PACKAGES,
  type CliNpmLatest,
  compareSemver,
  isFactoryOrDevRegistry,
  normalizeSemver,
  updateCheckAllowed,
} from "../lifecycle/check-updates.js";
import { writeJson } from "../utils/fs.js";

export const INSTALL_HEALTH_SNAPSHOT_RELATIVE_PATH = ".cursor/context/install-health.json";

/**
 * The working mise tool entry (checked 2026-11-24, mise 2026.11.10, Linux).
 * A bare `mise use -g npm:<pkg>` fails: the npm backend refuses packages under
 * 1000 weekly downloads, and the default minimum release age resolves `latest`
 * to an older release.
 */
export function miseToolEntry(packageName: string): string {
  return `"npm:${packageName}" = { version = "latest", allow_low_downloads = true, minimum_release_age = "0s" }`;
}

export type InstallHealthCheckId = "global-cli" | "node-manager" | "home-install" | "registry-pin";

/** `info` = nothing to fix, but the check could not fully run (offline, no binary, …). */
export type InstallHealthSeverity = "ok" | "warning" | "info";

export interface InstallHealthCheck {
  id: InstallHealthCheckId;
  label: string;
  severity: InstallHealthSeverity;
  /** One line: what was found and where (paths home-relative). */
  detail: string;
  /** Copy-paste remedy, or null when nothing needs fixing. */
  fix: string | null;
  /**
   * `command` runs as is in a terminal; `config-line` goes into the file named
   * in `detail`; `template` is a command with a placeholder (`<new>`) the
   * operator fills in first, so Mission Control never offers it as a terminal copy.
   */
  fixKind: "command" | "config-line" | "template" | null;
}

export interface InstallHealthReport {
  status: "ok" | "warning";
  checks: InstallHealthCheck[];
}

const LABELS: Record<InstallHealthCheckId, string> = {
  "global-cli": "Global CLI vs npm latest",
  "node-manager": "Node version manager",
  "home-install": "Home-level install",
  "registry-pin": "Registry pin",
};

function check(
  id: InstallHealthCheckId,
  severity: InstallHealthSeverity,
  detail: string,
  fix: string | null = null,
  fixKind: InstallHealthCheck["fixKind"] = null,
): InstallHealthCheck {
  return { id, label: LABELS[id], severity, detail, fix, fixKind: fix ? fixKind : null };
}

/** `~/...` for paths under `homeDir` (either separator style). */
export function homeRelative(p: string, homeDir: string): string {
  if (!homeDir) return p;
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const home = norm(homeDir);
  const target = norm(p);
  if (target === home) return "~";
  if (target.startsWith(`${home}/`)) return `~${target.slice(home.length)}`;
  return p;
}

/** npm package that owns a CLI binary name (`agent-kit` → `@dadado/agent-kit-cli`). */
export function packageForBin(binName: string | null): string {
  const base = (binName ?? "").replace(/\.(cmd|exe|bat|ps1)$/i, "");
  return CLI_NPM_PACKAGES.find((pkg) => pkg.bin === base)?.name ?? CLI_NPM_PACKAGES[0].name;
}

// ── (a) global CLI vs npm latest ────────────────────────────────────────────

export interface GlobalCliInput {
  /** First PATH hit for `agent-kit` / `missionkit`, or null. */
  binPath: string | null;
  /** Version read from that binary's package.json, or null. */
  binVersion: string | null;
  /** Whether doctor asked npm at all (false: CI, opt-out or a test without a fetcher). */
  latestChecked: boolean;
  /** Highest npm `latest` across both package names; null when npm did not answer. */
  latest: CliNpmLatest | null;
  homeDir: string;
}

export function assessGlobalCli(input: GlobalCliInput): InstallHealthCheck {
  if (!input.binPath) {
    const names = CLI_NPM_PACKAGES.map((pkg) => pkg.bin).join(" or ");
    return check("global-cli", "info", `No ${names} binary on PATH (npx-only use is fine)`);
  }
  const where = homeRelative(input.binPath, input.homeDir);
  const installed = input.binVersion ? normalizeSemver(input.binVersion) : null;
  if (!installed) {
    return check("global-cli", "info", `Could not read the version of ${where}`);
  }
  if (!input.latestChecked) {
    return check(
      "global-cli",
      "info",
      `v${installed} at ${where}; npm latest not checked (CI or updateCheck.enabled: false)`,
    );
  }
  if (!input.latest) {
    return check(
      "global-cli",
      "info",
      `v${installed} at ${where}; npm registry did not answer, not compared`,
    );
  }
  const { version: latest, packageName } = input.latest;
  if (compareSemver(installed, latest) < 0) {
    return check(
      "global-cli",
      "warning",
      `v${installed} at ${where} is behind npm latest v${latest} (${packageName})`,
      `npm i -g ${packageName}@${latest}`,
      "command",
    );
  }
  return check(
    "global-cli",
    "ok",
    compareSemver(installed, latest) === 0
      ? `v${installed} at ${where} matches npm latest`
      : `v${installed} at ${where} is ahead of npm latest v${latest} (dev build)`,
  );
}

// ── (b) per-version node managers ───────────────────────────────────────────

export type NodeManager =
  | "mise"
  | "nvm"
  | "nvm-windows"
  | "fnm"
  | "volta"
  | "homebrew"
  | "mise-shim"
  | "other";

export interface NodeManagerMatch {
  manager: NodeManager;
  /** Node version dir the path lives in (per-version managers only). */
  nodeVersion: string | null;
}

/** Per-version managers drop npm globals when node changes; the rest keep them. */
export const PER_VERSION_MANAGERS: ReadonlySet<NodeManager> = new Set([
  "mise",
  "nvm",
  "nvm-windows",
  "fnm",
]);

/**
 * Which node manager owns `p` (a PATH hit or its realpath), from the string
 * alone. Windows paths are matched case-insensitively with either separator.
 * mise shims cannot be classified from a path (their realpath is mise itself),
 * so they are reported as `mise-shim` and never flagged.
 */
export function classifyNodeManagerPath(p: string, platform: NodeJS.Platform): NodeManagerMatch {
  const win = platform === "win32";
  const norm = p.replace(/\\/g, "/");
  const s = win ? norm.toLowerCase() : norm;
  const version = (re: RegExp): string | null => {
    const m = re.exec(s);
    return m?.[1] ?? null;
  };

  // mise: …/mise/installs/node/<ver>/bin (POSIX) or …\mise\installs\node\<ver>\ (Windows).
  // Anchored to installs/node/ so a CLI installed as a mise npm: tool
  // (…/mise/installs/npm-…) is clean.
  const mise = version(/\/mise\/installs\/node\/([^/]+)\//);
  if (mise) return { manager: "mise", nodeVersion: mise };
  if (/\/mise\/shims\//.test(s)) return { manager: "mise-shim", nodeVersion: null };

  // nvm (POSIX): $NVM_DIR/versions/node/v<ver>/bin, NVM_DIR usually ~/.nvm.
  const nvm = version(/\/\.?nvm\/versions\/node\/(v?\d[^/]*)\//);
  if (nvm) return { manager: "nvm", nodeVersion: nvm };

  // fnm: …/fnm/node-versions/<ver>/installation/bin (POSIX, macOS) or
  // …\fnm\node-versions\<ver>\installation\ (Windows). The PATH entry is a
  // fnm_multishells symlink; its realpath lands here.
  const fnm = version(/\/\.?fnm\/node-versions\/([^/]+)\/installation\//);
  if (fnm) return { manager: "fnm", nodeVersion: fnm };

  // nvm-windows: %NVM_HOME%\v<ver>\ (default %APPDATA%\nvm). The PATH entry is
  // the NVM_SYMLINK junction (C:\Program Files\nodejs); its realpath lands here.
  if (win) {
    const nvmWin = version(/\/nvm\/(v\d+\.\d+\.\d+[^/]*)\//);
    if (nvmWin) return { manager: "nvm-windows", nodeVersion: nvmWin };
  }

  if (/\/\.?volta\//.test(s)) return { manager: "volta", nodeVersion: null };
  if (/^\/opt\/homebrew\/|^\/usr\/local\/cellar\/|\/\.linuxbrew\//i.test(norm)) {
    return { manager: "homebrew", nodeVersion: null };
  }
  return { manager: "other", nodeVersion: null };
}

export interface NodeManagerInput {
  /** PATH hit of the CLI binary, or null when none. */
  binPath: string | null;
  /** Realpath of that hit (symlinks followed), or null when unreadable. */
  binRealPath: string | null;
  /** The running node (process.execPath), to name the version node resolves to now. */
  nodeExecPath: string | null;
  platform: NodeJS.Platform;
  homeDir: string;
}

function nodeManagerFix(
  manager: NodeManager,
  packageName: string,
  oldVersion: string,
  newVersion: string | null,
): { fix: string; fixKind: "command" | "config-line" | "template"; also?: string } {
  const known = Boolean(newVersion && newVersion !== oldVersion);
  const target = known ? (newVersion as string) : "<new>";
  const kind = known ? "command" : "template";
  switch (manager) {
    case "mise":
      return { fix: miseToolEntry(packageName), fixKind: "config-line" };
    case "nvm":
      return {
        fix: `nvm install ${target} --reinstall-packages-from=${oldVersion}`,
        fixKind: kind,
        also: `or install under a fixed prefix outside nvm: npm i -g --prefix ~/.local ${packageName} (with ~/.local/bin on PATH)`,
      };
    case "nvm-windows":
      return { fix: `nvm use ${target} && npm i -g ${packageName}`, fixKind: kind };
    default:
      return { fix: `fnm use ${target} && npm i -g ${packageName}`, fixKind: kind };
  }
}

export function assessNodeManager(input: NodeManagerInput): InstallHealthCheck {
  if (!input.binPath) {
    return check("node-manager", "ok", "No global CLI on PATH; nothing tied to a node version");
  }
  const candidates = [input.binRealPath, input.binPath].filter((p): p is string => Boolean(p));
  let match: NodeManagerMatch = { manager: "other", nodeVersion: null };
  for (const candidate of candidates) {
    const found = classifyNodeManagerPath(candidate, input.platform);
    if (PER_VERSION_MANAGERS.has(found.manager)) {
      match = found;
      break;
    }
    if (match.manager === "other") match = found;
  }
  const where = homeRelative(input.binPath, input.homeDir);
  if (!PER_VERSION_MANAGERS.has(match.manager) || !match.nodeVersion) {
    const kind =
      match.manager === "volta"
        ? "Volta"
        : match.manager === "homebrew"
          ? "Homebrew node"
          : match.manager === "mise-shim"
            ? "a mise shim (not classified)"
            : "a node install that keeps globals";
    return check("node-manager", "ok", `${where} comes from ${kind}`);
  }

  const running = input.nodeExecPath
    ? classifyNodeManagerPath(input.nodeExecPath, input.platform)
    : null;
  const runningVersion = running && running.manager === match.manager ? running.nodeVersion : null;
  const packageName = packageForBin(path.basename(input.binPath));
  const remedy = nodeManagerFix(match.manager, packageName, match.nodeVersion, runningVersion);
  const drift =
    runningVersion && runningVersion !== match.nodeVersion
      ? `; node now resolves to ${runningVersion}, so this copy is already orphaned`
      : "";
  const where2 =
    match.manager === "mise"
      ? "; add the fix line under [tools] in ~/.config/mise/config.toml"
      : remedy.also
        ? `; ${remedy.also}`
        : "";
  return check(
    "node-manager",
    "warning",
    `${where} lives in ${match.manager} node ${match.nodeVersion}: npm globals vanish on the next node switch or patch${drift}${where2}`,
    remedy.fix,
    remedy.fixKind,
  );
}

// ── (c) home-level install under ~/.cursor ──────────────────────────────────

/** Paths a home-level install leaves under `~/.cursor` that apply in every workspace. */
export const HOME_INSTALL_RELS = [
  ".cursor/agent-kit.json",
  ".cursor/rules",
  ".cursor/hooks.json",
  ".cursor/commands",
] as const;

export interface HomeInstallInput {
  homeDir: string;
  cwd: string;
  /** `version` of `~/.cursor/agent-kit.json`, or null when there is no such manifest. */
  homeManifestVersion: string | null;
  /** Which of HOME_INSTALL_RELS exist under home. */
  presentRels: string[];
  /** This repo's manifest version, or null when the repo has no kit. */
  repoVersion: string | null;
  /** The running CLI version, used when the repo has no kit. */
  cliVersion: string;
}

export function assessHomeInstall(input: HomeInstallInput): InstallHealthCheck {
  if (path.resolve(input.cwd) === path.resolve(input.homeDir)) {
    return check("home-install", "ok", "Running in the home directory: this is the home install");
  }
  if (!input.homeManifestVersion) {
    return check("home-install", "ok", "No home-level install (~/.cursor/agent-kit.json absent)");
  }
  const home = normalizeSemver(input.homeManifestVersion);
  const reference = normalizeSemver(input.repoVersion ?? input.cliVersion);
  const against = input.repoVersion ? "this repo's kit" : "the running CLI";
  if (!home || !reference) {
    return check(
      "home-install",
      "info",
      `Home-level install v${input.homeManifestVersion} under ~/.cursor; version not comparable`,
    );
  }
  if (compareSemver(home, reference) >= 0) {
    return check("home-install", "ok", `Home-level install v${home} is current with ${against}`);
  }
  const paths = input.presentRels
    .map((rel) => `~/${rel}${rel.endsWith(".json") ? "" : "/"}`)
    .join(", ");
  // No fix line on purpose: update or remove the home install is the
  // operator's call; doctor only names the paths and never moves them.
  return check(
    "home-install",
    "warning",
    `Home-level install v${home} is older than ${against} v${reference}; its rules and hooks still apply in every workspace: ${paths}. Nothing was moved`,
  );
}

// ── (d) stale registry.ref pin ──────────────────────────────────────────────

export interface RegistryPinInput {
  /** Manifest present at all. */
  hasManifest: boolean;
  installedVersion: string | null;
  registryUrl: string | null;
  registryRef: string | null;
  cliVersion: string;
}

export function assessRegistryPin(input: RegistryPinInput): InstallHealthCheck {
  if (!input.hasManifest) {
    return check("registry-pin", "ok", "No .cursor/agent-kit.json in this repo");
  }
  if (!input.registryRef) {
    return check("registry-pin", "ok", "No registry.ref pin");
  }
  if (isFactoryOrDevRegistry(input.registryUrl, input.registryRef)) {
    return check("registry-pin", "ok", `Factory/dev registry (${input.registryRef}); not checked`);
  }
  const pin = normalizeSemver(input.registryRef);
  if (!pin) {
    return check("registry-pin", "ok", `registry.ref ${input.registryRef} is a branch, not a pin`);
  }
  const versions = [input.installedVersion, input.cliVersion]
    .map((v) => (v ? normalizeSemver(v) : null))
    .filter((v): v is string => Boolean(v));
  const newest = versions.reduce<string | null>(
    (best, v) => (!best || compareSemver(v, best) > 0 ? v : best),
    null,
  );
  if (!newest || compareSemver(pin, newest) >= 0) {
    return check("registry-pin", "ok", `registry.ref ${input.registryRef} is current`);
  }
  return check(
    "registry-pin",
    "warning",
    `registry.ref ${input.registryRef} in .cursor/agent-kit.json is older than v${newest}; update would re-apply the v${pin} tree`,
    `agent-kit update --ref v${newest}`,
    "command",
  );
}

// ── report + gatherer ───────────────────────────────────────────────────────

export function summarizeInstallHealth(checks: InstallHealthCheck[]): InstallHealthReport {
  return {
    status: checks.some((c) => c.severity === "warning") ? "warning" : "ok",
    checks,
  };
}

export interface InstallHealthGatherOptions {
  cwd: string;
  cliVersion: string;
  /** null = not checked; otherwise the fetch outcome (latest may be null). */
  npm: { checked: boolean; latest: CliNpmLatest | null };
  /** PATH hit + its version (from assessEnvironment's bin resolution). */
  binPath: string | null;
  binVersion: string | null;
  manifest: { version: string; registryUrl: string | null; registryRef: string | null } | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
  nodeExecPath?: string;
  realpathImpl?: (p: string) => Promise<string>;
  readFileImpl?: (p: string) => Promise<string>;
  existsImpl?: (p: string) => Promise<boolean>;
}

async function defaultExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Run the four checks. Read-only, never throws. */
export async function assessInstallHealth(
  options: InstallHealthGatherOptions,
): Promise<InstallHealthReport> {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const realpathImpl = options.realpathImpl ?? realpath;
  const readFileImpl = options.readFileImpl ?? ((p: string) => readFile(p, "utf8"));
  const existsImpl = options.existsImpl ?? defaultExists;

  let binRealPath: string | null = null;
  if (options.binPath) {
    binRealPath = await realpathImpl(options.binPath).catch(() => null);
  }

  let homeManifestVersion: string | null = null;
  try {
    const raw = JSON.parse(await readFileImpl(path.join(homeDir, ".cursor", "agent-kit.json"))) as {
      version?: unknown;
    };
    if (typeof raw.version === "string" && raw.version) homeManifestVersion = raw.version;
  } catch {
    // No home manifest, or unreadable: no home-level install to report.
  }
  const presentRels: string[] = [];
  if (homeManifestVersion) {
    for (const rel of HOME_INSTALL_RELS) {
      if (await existsImpl(path.join(homeDir, rel)).catch(() => false)) presentRels.push(rel);
    }
  }

  const checks: InstallHealthCheck[] = [
    assessGlobalCli({
      binPath: options.binPath,
      binVersion: options.binVersion,
      latestChecked: options.npm.checked,
      latest: options.npm.latest,
      homeDir,
    }),
    assessNodeManager({
      binPath: options.binPath,
      binRealPath,
      nodeExecPath: options.nodeExecPath ?? process.execPath,
      platform,
      homeDir,
    }),
    assessHomeInstall({
      homeDir,
      cwd: options.cwd,
      homeManifestVersion,
      presentRels,
      repoVersion: options.manifest?.version ?? null,
      cliVersion: options.cliVersion,
    }),
    assessRegistryPin({
      hasManifest: options.manifest != null,
      installedVersion: options.manifest?.version ?? null,
      registryUrl: options.manifest?.registryUrl ?? null,
      registryRef: options.manifest?.registryRef ?? null,
      cliVersion: options.cliVersion,
    }),
  ];
  // A reinstall into the same per-version node dir vanishes again on the next
  // node switch: point the global-CLI fix at the node-manager line instead.
  const [globalCli, nodeManager] = checks;
  if (globalCli?.severity === "warning" && nodeManager?.severity === "warning" && nodeManager.fix) {
    checks[0] = {
      ...globalCli,
      detail: `${globalCli.detail}; use the ${nodeManager.label} fix so the upgrade survives the next node switch`,
      fix: null,
      fixKind: null,
    };
  }
  return summarizeInstallHealth(checks);
}

/**
 * Whether doctor may ask npm for `latest`: off under CI, with the env opt-out
 * and when the config says `updateCheck.enabled: false` explicitly (an absent
 * key does not opt out; ADR 2026-07-27 Amend 2026-11-26).
 */
export function npmLatestCheckAllowed(env: NodeJS.ProcessEnv, config: unknown): boolean {
  return updateCheckAllowed(env, config);
}

/** Persist the report for Mission Control Health (gitignored, home-relative paths only). */
export async function writeInstallHealthSnapshot(
  rootDir: string,
  report: InstallHealthReport,
  generatedAt: string = new Date().toISOString(),
): Promise<string> {
  const snapshotPath = path.join(rootDir, INSTALL_HEALTH_SNAPSHOT_RELATIVE_PATH);
  await writeJson(snapshotPath, { version: 1, generatedAt, ...report });
  return snapshotPath;
}
