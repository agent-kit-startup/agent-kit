import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { bundledDashboardCandidates } from "../commands/dashboard.js";
import { DRIVER_PROTOCOL_VERSION } from "../plan-loop/driver-events.js";

/**
 * Engine manifest: what a host that runs this CLI as a managed engine (an IDE host) needs to
 * decide whether it supports this build. The engine artifact ships the same object as
 * `engine.json`; `agent-kit engine-info --json` prints it from a checkout or install.
 * ADR 2026-10-19_colony-managed-engine-distribution (Decision 2 and 4).
 */
export interface EngineManifest {
  /** Manifest shape version; bump on a breaking change to this object. */
  manifestVersion: 1;
  name: string;
  version: string;
  /** `engines.node` of the CLI package (a semver range, e.g. ">=22.12"). */
  node: string;
  /** Driver events protocol (docs/driver-events-protocol.md). */
  driverProtocol: string;
  /** Mission Control snapshot schema (`dashboardDataVersion`), null when no dashboard ships. */
  dashboardDataVersion: string | null;
  /** Entry point relative to the engine root. */
  entry: "dist/index.js";
  /** Mission Control server relative to the engine root. */
  dashboardServe: "dashboard/serve.mjs";
}

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
  engines?: { node?: unknown };
}

const require = createRequire(import.meta.url);

function loadPackageMetadata(): PackageMetadata {
  for (const packagePath of ["../package.json", "../../package.json"]) {
    try {
      const metadata = require(packagePath) as PackageMetadata;
      if (typeof metadata.version === "string" && metadata.name === "@dadado/agent-kit-cli") {
        return metadata;
      }
    } catch {
      // Source and bundled builds resolve the package root from different depths.
    }
  }
  throw new Error("Unable to resolve the Agent Kit CLI package.json");
}

const DATA_VERSION_RE = /^\s*dashboardDataVersion:\s*["'](\d+\.\d+\.\d+)["']/m;

/** `dashboardDataVersion` from the text of dashboard-data.mjs (never imported: it reads env on load). */
export function parseDashboardDataVersion(source: string): string | null {
  return DATA_VERSION_RE.exec(source)?.[1] ?? null;
}

function readDashboardDataVersion(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      const found = parseDashboardDataVersion(readFileSync(candidate, "utf8"));
      if (found) return found;
    } catch {
      // try next
    }
  }
  return null;
}

export function buildEngineManifest(
  opts: { metadata?: PackageMetadata; dashboardCandidates?: string[] } = {},
): EngineManifest {
  const metadata = opts.metadata ?? loadPackageMetadata();
  const candidates = opts.dashboardCandidates ?? bundledDashboardCandidates("dashboard-data.mjs");
  const node = metadata.engines?.node;
  return {
    manifestVersion: 1,
    name: String(metadata.name),
    version: String(metadata.version),
    node: typeof node === "string" ? node : "",
    driverProtocol: DRIVER_PROTOCOL_VERSION,
    dashboardDataVersion: readDashboardDataVersion(candidates),
    entry: "dist/index.js",
    dashboardServe: "dashboard/serve.mjs",
  };
}

export function renderEngineManifest(m: EngineManifest): string {
  return [
    `${m.name} ${m.version}`,
    `node ${m.node || "(unspecified)"}`,
    `driver protocol ${m.driverProtocol}`,
    `dashboard data ${m.dashboardDataVersion ?? "(no dashboard found)"}`,
    `entry ${m.entry}`,
    `dashboard server ${m.dashboardServe}`,
  ].join("\n");
}
