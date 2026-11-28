import { homedir } from "node:os";
import path from "node:path";
import { defineCommand } from "citty";
import {
  DEFAULT_SCAN_DEPTH,
  DEFAULT_SCAN_MAX_DIRS,
  type InstallEntry,
  InstallsRegistryError,
  listInstalls,
  pruneMissingInstalls,
  recordInstalls,
  resolveInstallsFile,
  scanForInstalls,
} from "../installs/index.js";
import { logger } from "../utils/logger.js";

/** Every `--root <dir>` / `--root=<dir>` value (citty keeps only the last one). */
export function collectRepeatedFlag(rawArgs: readonly string[], flag: string): string[] {
  const values: string[] = [];
  const long = `--${flag}`;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i] as string;
    if (arg === long) {
      const value = rawArgs[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        values.push(value);
        i += 1;
      }
    } else if (arg.startsWith(`${long}=`)) {
      values.push(arg.slice(long.length + 1));
    }
  }
  return values.filter((v) => v.trim() !== "");
}

function parsePositiveInt(value: unknown, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--${name} must be a non-negative integer (got ${String(value)})`);
  }
  return n;
}

const EMPTY_LIST =
  "No installs recorded yet. Run `agent-kit installs scan` or any install, update or doctor.";

export function renderInstallsTable(
  entries: readonly InstallEntry[],
  home = homedir(),
  empty = EMPTY_LIST,
): string {
  if (entries.length === 0) return empty;
  const display = (p: string) =>
    p === home ? "~" : p.startsWith(`${home}${path.sep}`) ? `~${p.slice(home.length)}` : p;
  const rows = entries.map((e) => [
    e.kind,
    e.kitVersion ?? "?",
    display(e.path),
    e.remote ?? "(no remote)",
    e.lastSeen.slice(0, 10),
  ]);
  const header = ["KIND", "KIT", "PATH", "REMOTE", "SEEN"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const fmt = (r: string[]) =>
    r
      .map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return [fmt(header), ...rows.map(fmt)].join("\n");
}

function reportRegistryError(err: unknown): boolean {
  if (err instanceof InstallsRegistryError) {
    logger.error(err.message);
    process.exitCode = 1;
    return true;
  }
  return false;
}

async function printInstallsList(json: boolean): Promise<void> {
  let entries: InstallEntry[];
  try {
    entries = await listInstalls();
  } catch (err) {
    if (reportRegistryError(err)) return;
    throw err;
  }
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ file: resolveInstallsFile(), installs: entries }, null, 2)}\n`,
    );
    return;
  }
  process.stdout.write(`${renderInstallsTable(entries)}\n`);
}

const listCommand = defineCommand({
  meta: { name: "list", description: "List the installs recorded on this machine (default)" },
  args: {
    json: { type: "boolean", description: "Print the rows as JSON", default: false },
  },
  run({ args }) {
    return printInstallsList(args.json);
  },
});

const scanCommand = defineCommand({
  meta: {
    name: "scan",
    description:
      "Find kit installs (.cursor/agent-kit.json) under bounded roots and record them (default root: $HOME)",
  },
  args: {
    root: {
      type: "string",
      description: "Directory to walk; repeat for several roots (default: $HOME)",
    },
    depth: {
      type: "string",
      description: `Maximum directory depth below each root (default ${DEFAULT_SCAN_DEPTH})`,
    },
    "max-dirs": {
      type: "string",
      description: `Stop after visiting this many directories (default ${DEFAULT_SCAN_MAX_DIRS})`,
    },
    json: { type: "boolean", description: "Print the result as JSON", default: false },
  },
  async run({ args, rawArgs }) {
    const roots = collectRepeatedFlag(rawArgs, "root");
    const scanRoots = roots.length > 0 ? roots.map((r) => path.resolve(r)) : [homedir()];
    let maxDepth: number;
    let maxDirs: number;
    try {
      maxDepth = parsePositiveInt(args.depth, DEFAULT_SCAN_DEPTH, "depth");
      maxDirs = parsePositiveInt(args["max-dirs"], DEFAULT_SCAN_MAX_DIRS, "max-dirs");
    } catch (err) {
      logger.error((err as Error).message);
      process.exitCode = 2;
      return;
    }
    // The walk runs outside the lock; the upsert re-reads the file under it and
    // re-checks each manifest, so a row pruned meanwhile is never resurrected.
    const scan = await scanForInstalls(scanRoots, { maxDepth, maxDirs });
    let written: InstallEntry[];
    try {
      written = await recordInstalls(scan.found);
    } catch (err) {
      if (reportRegistryError(err)) return;
      throw err;
    }
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            roots: scanRoots,
            visited: scan.visited,
            truncated: scan.truncated,
            recorded: written,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(
      `${renderInstallsTable(written, homedir(), "No kit installs (.cursor/agent-kit.json) found.")}\n`,
    );
    logger.info(
      `Scanned ${scan.visited} directories under ${scanRoots.join(", ")} (depth ${maxDepth}); recorded ${written.length} install(s) in ${resolveInstallsFile()}.`,
    );
    if (scan.truncated) {
      logger.warn(
        `Stopped at ${maxDirs} directories; pass --root for a narrower folder or --max-dirs to raise the cap.`,
      );
    }
  },
});

const pruneCommand = defineCommand({
  meta: {
    name: "prune",
    description: "Remove recorded installs whose folder or .cursor/agent-kit.json is gone",
  },
  args: {
    json: { type: "boolean", description: "Print the removed rows as JSON", default: false },
  },
  async run({ args }) {
    let removed: InstallEntry[];
    try {
      removed = await pruneMissingInstalls();
    } catch (err) {
      if (reportRegistryError(err)) return;
      throw err;
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ removed }, null, 2)}\n`);
      return;
    }
    if (removed.length === 0) {
      logger.info("Nothing to prune: every recorded install still exists.");
      return;
    }
    for (const entry of removed) console.log(`pruned ${entry.path}`);
  },
});

const SUBCOMMANDS = new Set(["list", "scan", "prune"]);

/**
 * Machine install registry (`~/.config/agent-kit/installs.json`, ADR 2026-08-02
 * amend 2026-11-26). An index of where the kit is installed; never writes
 * inside a repo.
 */
export const installsCommand = defineCommand({
  meta: {
    name: "installs",
    description:
      "List, scan and prune the kit installs recorded on this machine (~/.config/agent-kit/installs.json)",
  },
  args: {
    json: { type: "boolean", description: "Print the rows as JSON", default: false },
  },
  subCommands: {
    list: listCommand,
    scan: scanCommand,
    prune: pruneCommand,
  },
  async run({ args, rawArgs }) {
    // citty also invokes the parent's run after a subcommand.
    const first = rawArgs.find((a) => !a.startsWith("-"));
    if (first && SUBCOMMANDS.has(first)) return;
    await printInstallsList(args.json);
  },
});
