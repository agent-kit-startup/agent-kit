#!/usr/bin/env node
/**
 * Sync monorepo dashboard/ SoT into packages/cli/dashboard for npm publish (Path C).
 * Source of truth remains repo-root dashboard/; the CLI copy is build/prepack output.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const src = join(repoRoot, "dashboard");
const dest = join(repoRoot, "packages", "cli", "dashboard");

if (!existsSync(src)) {
  console.error(`sync-cli-dashboard: missing source ${src}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`Synced ${src} -> ${dest}`);
