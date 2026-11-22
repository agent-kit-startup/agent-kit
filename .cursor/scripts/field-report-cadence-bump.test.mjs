// Consumer installs have no dashboard/ in the repo: the cadence script must
// find semantic-model.mjs in the installed CLI package, or skip with rc 0.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT_REL = ".cursor/scripts/field-report-cadence-bump.sh";
const BASH = execFileSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).trim();
const DIRNAME = execFileSync("bash", ["-c", "command -v dirname"], { encoding: "utf8" }).trim();
const TEST_ROOT = mkdtempSync(join(tmpdir(), "ak-cadence-bump-"));
after(() => rmSync(TEST_ROOT, { recursive: true, force: true }));

let seq = 0;
function sandbox() {
  const base = join(TEST_ROOT, String(seq++));
  const repo = join(base, "repo");
  const bin = join(base, "bin");
  mkdirSync(join(repo, ".cursor/scripts"), { recursive: true });
  mkdirSync(join(repo, ".cursor/context"), { recursive: true });
  mkdirSync(join(repo, ".cursor/plans"), { recursive: true });
  copyFileSync(join(REPO, SCRIPT_REL), join(repo, SCRIPT_REL));
  // Hermetic PATH: only node and dirname, so no CLI installed on the host leaks in.
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  symlinkSync(DIRNAME, join(bin, "dirname"));
  return { base, repo, bin };
}

function fakeCli(base, bin, semanticModel) {
  const pkg = join(base, "cli-pkg");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(join(pkg, "dist/index.js"), "#!/usr/bin/env node\n");
  if (semanticModel === "real") {
    mkdirSync(join(pkg, "dashboard"));
    symlinkSync(join(REPO, "dashboard/lib"), join(pkg, "dashboard/lib"));
  } else {
    mkdirSync(join(pkg, "dashboard/lib"), { recursive: true });
    writeFileSync(join(pkg, "dashboard/lib/semantic-model.mjs"), semanticModel);
  }
  symlinkSync(join(pkg, "dist/index.js"), join(bin, "agent-kit"));
}

function run({ repo, bin }, ...args) {
  return spawnSync(BASH, [join(repo, SCRIPT_REL), ...args], {
    encoding: "utf8",
    env: { PATH: bin, HOME: repo },
  });
}

test("consumer without dashboard/ resolves semantic-model from the installed CLI package", () => {
  const sb = sandbox();
  fakeCli(sb.base, sb.bin, "real");
  const res = run(sb, "classify");
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stderr, /ERR_MODULE_NOT_FOUND|warning/);
  assert.equal(JSON.parse(res.stdout).action, "classify");
});

test("consumer with no CLI package skips tick with one warning and rc 0", () => {
  const sb = sandbox();
  const res = run(sb, "tick");
  assert.equal(res.status, 0, res.stderr);
  assert.match(
    res.stderr,
    /^warning: field-report cadence skipped \(tick\): .*semantic-model\.mjs not found/,
  );
  assert.doesNotMatch(res.stderr, /ERR_MODULE_NOT_FOUND|at /);
});

test("an installed CLI older than the script skips with a warning instead of a TypeError", () => {
  const sb = sandbox();
  fakeCli(sb.base, sb.bin, "export const parseCadenceLedger = () => ({});\n");
  const res = run(sb, "batch-complete");
  assert.equal(res.status, 0, res.stderr);
  assert.match(
    res.stderr,
    /^warning: field-report cadence skipped \(batch-complete\): .* lacks .*classifyOwedPlan/,
  );
});

test("factory layout keeps using the repo dashboard/lib", () => {
  const sb = sandbox();
  mkdirSync(join(sb.repo, "dashboard"));
  symlinkSync(join(REPO, "dashboard/lib"), join(sb.repo, "dashboard/lib"));
  const res = run(sb, "classify");
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).action, "classify");
});
