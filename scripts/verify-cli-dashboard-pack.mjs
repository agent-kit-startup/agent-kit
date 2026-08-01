#!/usr/bin/env node
/**
 * Blank-folder / pack acceptance for the published CLI package.
 *
 * Verifies that an `npm pack` tarball for `@dadado/agent-kit-cli` includes:
 * - Path C Mission Control assets (`dashboard/start.mjs`, `start-broadcast.mjs`)
 * - A non-empty package README (npm storefront; always packed when present)
 *
 * Does not require a live npm tag.
 *
 * Version bump (publish gate R3) stays owned by `/git-prod` + annotated tag CI.
 * Do not bump package versions from this script.
 *
 * Usage (from monorepo root):
 *   node scripts/verify-cli-dashboard-pack.mjs
 *   node scripts/verify-cli-dashboard-pack.mjs --tarball path/to/dadado-agent-kit-cli-*.tgz
 *
 * Exit 0 on pass; 1 on missing assets, empty README, or pack failure.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const cliDir = join(repoRoot, "packages", "cli");

export const REQUIRED_DASHBOARD = [
  "package/dashboard/start.mjs",
  "package/dashboard/start-broadcast.mjs",
];

/** Case-insensitive README path under an extracted pack root. */
export function findPackReadme(extractDir) {
  const pkgDir = join(extractDir, "package");
  if (!existsSync(pkgDir)) return null;
  const match = readdirSync(pkgDir).find((name) => /^readme(\.md)?$/i.test(name));
  return match ? join(pkgDir, match) : null;
}

/**
 * Assert Path C dashboard members + non-empty README in an extracted pack.
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function assertPackContents(extractDir) {
  const errors = [];
  for (const rel of REQUIRED_DASHBOARD) {
    if (!existsSync(join(extractDir, rel))) {
      errors.push(`missing ${rel}`);
    }
  }
  const readmePath = findPackReadme(extractDir);
  if (!readmePath) {
    errors.push("missing package/README.md (npm storefront)");
  } else {
    const st = statSync(readmePath);
    if (!st.isFile()) {
      errors.push(`package README is not a file: ${readmePath}`);
    } else {
      const body = readFileSync(readmePath, "utf8");
      if (body.trim().length === 0) {
        errors.push("package/README.md is empty");
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

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
      throw new Error(
        `npm pack did not produce a .tgz under packages/cli (stdout: ${out.slice(0, 200)})`,
      );
    }
    return join(cliDir, fallback);
  }
  return join(cliDir, name);
}

export function main(argv = process.argv.slice(2)) {
  const { tarball: given } = parseArgs(argv);
  let tarball = given;
  let created = false;
  if (!tarball) {
    console.log("verify-cli-dashboard-pack: running npm pack in packages/cli …");
    tarball = packCli();
    created = true;
  }
  if (!existsSync(tarball)) {
    console.error(`verify-cli-dashboard-pack: missing tarball ${tarball}`);
    process.exitCode = 1;
    return 1;
  }

  const extractDir = mkdtempSync(join(tmpdir(), "ak-pack-verify-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", extractDir], { stdio: "inherit" });
    const result = assertPackContents(extractDir);
    if (!result.ok) {
      console.error("verify-cli-dashboard-pack: FAIL — pack contents:");
      for (const m of result.errors) console.error(`  - ${m}`);
      const pkgRoot = join(extractDir, "package");
      if (existsSync(pkgRoot)) {
        const listed = readdirSync(pkgRoot, { recursive: true }).slice(0, 40);
        console.error("sample package/ entries:", listed);
      }
      process.exitCode = 1;
      return 1;
    }
    console.log(
      "verify-cli-dashboard-pack: PASS — Path C dashboard assets and non-empty README present in pack.",
    );
    console.log(`  tarball: ${tarball}`);
    console.log(
      "  Publish gate: version bump + npm tag remain `/git-prod` HITL (do not bump from this script).",
    );
    return 0;
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
    if (created && existsSync(tarball)) {
      rmSync(tarball, { force: true });
    }
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  main();
}
