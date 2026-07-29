#!/usr/bin/env node
/**
 * Blank-folder / pack acceptance for Path C (Mission Control dashboard in CLI pack).
 *
 * Verifies that an `npm pack` tarball for `@dadado/agent-kit-cli` includes
 * `dashboard/start.mjs` (and `start-broadcast.mjs`) without requiring a live npm tag.
 *
 * Version bump (publish gate R3) stays owned by `/git-prod` + annotated tag CI.
 * Do not bump package versions from this script.
 *
 * Usage (from monorepo root):
 *   node scripts/verify-cli-dashboard-pack.mjs
 *   node scripts/verify-cli-dashboard-pack.mjs --tarball path/to/dadado-agent-kit-cli-*.tgz
 *
 * Exit 0 on pass; 1 on missing assets or pack failure.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const cliDir = join(repoRoot, "packages", "cli");

const REQUIRED = ["package/dashboard/start.mjs", "package/dashboard/start-broadcast.mjs"];

function parseArgs(argv) {
  const out = { tarball: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tarball" && argv[i + 1]) {
      out.tarball = resolve(argv[++i]);
    }
  }
  return out;
}

function packCli() {
  // prepack sync prints to stdout; find the newest matching .tgz after pack.
  for (const f of readdirSync(cliDir)) {
    if (f.endsWith(".tgz") && f.startsWith("dadado-agent-kit-cli-")) {
      rmSync(join(cliDir, f), { force: true });
    }
  }
  const out = execFileSync("npm", ["pack"], {
    cwd: cliDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lines = out
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const name = lines.find((l) => l.endsWith(".tgz")) || lines[lines.length - 1];
  if (!name || !name.endsWith(".tgz") || !existsSync(join(cliDir, name))) {
    const fallback = readdirSync(cliDir).find(
      (f) => f.endsWith(".tgz") && f.startsWith("dadado-agent-kit-cli-"),
    );
    if (!fallback) {
      throw new Error(`npm pack did not produce a .tgz under packages/cli (stdout: ${out.slice(0, 200)})`);
    }
    return join(cliDir, fallback);
  }
  return join(cliDir, name);
}

function main() {
  const { tarball: given } = parseArgs(process.argv.slice(2));
  let tarball = given;
  let created = false;
  if (!tarball) {
    console.log("verify-cli-dashboard-pack: running npm pack in packages/cli …");
    tarball = packCli();
    created = true;
  }
  if (!existsSync(tarball)) {
    console.error(`verify-cli-dashboard-pack: missing tarball ${tarball}`);
    process.exit(1);
  }

  const extractDir = mkdtempSync(join(tmpdir(), "ak-pack-verify-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", extractDir], { stdio: "inherit" });
    const missing = REQUIRED.filter((rel) => !existsSync(join(extractDir, rel)));
    if (missing.length) {
      console.error("verify-cli-dashboard-pack: FAIL — missing from pack:");
      for (const m of missing) console.error(`  - ${m}`);
      const listed = readdirSync(join(extractDir, "package"), { recursive: true }).slice(0, 40);
      console.error("sample package/ entries:", listed);
      process.exit(1);
    }
    console.log("verify-cli-dashboard-pack: PASS — Path C dashboard assets present in pack.");
    console.log(`  tarball: ${tarball}`);
    console.log(
      "  Publish gate: version bump + npm tag remain `/git-prod` HITL (do not bump from this script).",
    );
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
    if (created && existsSync(tarball)) {
      rmSync(tarball, { force: true });
    }
  }
}

main();
