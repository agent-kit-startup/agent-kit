import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  closedSection,
  ledgerPath,
  mirror,
  NETWORKS,
  parseArgs,
  parseTemplate,
  redact,
  renderPost,
} from "./release-mirror.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATE = readFileSync(join(repoRoot, "docs/comms-templates/release.md"), "utf8");
// Built at runtime so no token-shaped literal sits in the source (HOL plugin scan).
const SECRET = ["tok", "en", "-", "value", "-", "1234"].join("");
const ENV_NAME = ["MISSION_KIT_COMMS", "TEST", "SECRET"].join("_");

function room(
  changelog = "# Changelog\n\n## [Unreleased]\n\n## [9.9.9] - 2026-11-22\n\n### Added\n\n- Thing\n",
) {
  const dir = mkdtempSync(join(tmpdir(), "release-mirror-"));
  mkdirSync(join(dir, "docs", "comms-templates"), { recursive: true });
  writeFileSync(join(dir, "docs", "comms-templates", "release.md"), TEMPLATE);
  writeFileSync(join(dir, "CHANGELOG.md"), changelog);
  return dir;
}

const OPEN = [{ key: "testnet", template: "short", env: ENV_NAME, gate: null }];

test("every registered network is gated today and has one MISSION_KIT_COMMS_ env name", () => {
  const names = new Set();
  for (const n of NETWORKS) {
    assert.ok(n.gate, `${n.key} must stay gated until its own Ask`);
    assert.match(n.env, /^MISSION_KIT_COMMS_[A-Z0-9_]+$/);
    assert.ok(!names.has(n.env));
    names.add(n.env);
  }
  assert.ok(!NETWORKS.some((n) => n.key === "hackernews" || n.key === "hn"));
});

test("the release template is the one source for both post shapes", () => {
  const t = parseTemplate(TEMPLATE);
  assert.ok(t.english && t.short);
  const post = renderPost(t, "english", "9.9.9");
  assert.match(post, /Mission Kit 9\.9\.9 is out\./);
  assert.match(post, /releases\/tag\/v9\.9\.9/);
  assert.doesNotMatch(post, /\{\{/);
});

test("closedSection never treats [Unreleased] as a release", () => {
  const log = "## [Unreleased]\n\n- a\n\n## [1.2.3] - d\n\n- b\n\n## [1.2.2] - d\n";
  assert.equal(closedSection(log, "Unreleased"), null);
  assert.match(closedSection(log, "1.2.3"), /- b/);
  assert.doesNotMatch(closedSection(log, "1.2.3"), /1\.2\.2/);
  assert.equal(closedSection(log, "1.2.4"), null);
});

test("refuses a version without a closed CHANGELOG section", async () => {
  await assert.rejects(
    mirror({ repoRoot: room(), version: "9.9.10", env: {} }),
    /no closed section/,
  );
});

test("dry run prints gated rows for the registry and sends nothing", async () => {
  const dir = room();
  const { lines, failed } = await mirror({ repoRoot: dir, version: "9.9.9", env: {} });
  assert.equal(failed, 0);
  assert.equal(lines.filter((l) => l.includes("gated:")).length, NETWORKS.length);
  assert.ok(lines.some((l) => l.startsWith("mirror v9.9.9 discord:")));
});

test("apply needs the Done evidence", async () => {
  await assert.rejects(
    mirror({
      repoRoot: room(),
      version: "9.9.9",
      apply: true,
      env: {},
      networks: OPEN,
      clients: { testnet: async () => ({ url: "u" }) },
    }),
    /--done-evidence/,
  );
});

test("apply posts once per version and network, then re-runs as already posted", async () => {
  const dir = room();
  let calls = 0;
  const clients = {
    testnet: async ({ text, token }) => {
      calls += 1;
      assert.equal(token, SECRET);
      assert.match(text, /9\.9\.9/);
      return { url: "https://example.test/post/1" };
    },
  };
  const args = {
    repoRoot: dir,
    version: "9.9.9",
    apply: true,
    doneEvidence: "Done v9.9.9",
    env: { [ENV_NAME]: SECRET },
    networks: OPEN,
    clients,
  };
  const first = await mirror(args);
  assert.deepEqual(first.lines.slice(0, 1), [
    "mirror v9.9.9 testnet: posted https://example.test/post/1",
  ]);
  const second = await mirror(args);
  assert.deepEqual(second.lines.slice(0, 1), [
    "mirror v9.9.9 testnet: already posted https://example.test/post/1",
  ]);
  assert.equal(calls, 1);
  assert.doesNotMatch(readFileSync(ledgerPath(dir, "9.9.9"), "utf8"), new RegExp(SECRET));
});

test("a failing network is reported with the token redacted and leaves no ledger entry", async () => {
  const dir = room();
  const clients = {
    testnet: async ({ token }) => {
      throw new Error(`401 for ${token}`);
    },
  };
  const { lines, failed } = await mirror({
    repoRoot: dir,
    version: "9.9.9",
    apply: true,
    doneEvidence: "Done v9.9.9",
    env: { [ENV_NAME]: SECRET },
    networks: OPEN,
    clients,
  });
  assert.equal(failed, 1);
  assert.equal(lines[0], "mirror v9.9.9 testnet: failed: 401 for <redacted>");
  const again = await mirror({ repoRoot: dir, version: "9.9.9", env: {}, networks: OPEN, clients });
  assert.match(again.lines[0], /dry-run/);
});

test("a missing token fails that network only", async () => {
  const { lines, failed } = await mirror({
    repoRoot: room(),
    version: "9.9.9",
    apply: true,
    doneEvidence: "Done v9.9.9",
    env: {},
    networks: OPEN,
    clients: { testnet: async () => ({ url: "u" }) },
  });
  assert.equal(failed, 1);
  assert.equal(lines[0], `mirror v9.9.9 testnet: failed: ${ENV_NAME} is not set`);
});

test("redact and parseArgs", () => {
  assert.equal(redact(`x ${SECRET} y`, { [ENV_NAME]: SECRET }, OPEN), "x <redacted> y");
  assert.deepEqual(
    parseArgs(["--version=1.2.3", "--apply", "--done-evidence", "d", "--network", "x"]),
    {
      version: "1.2.3",
      apply: true,
      doneEvidence: "d",
      network: "x",
      help: false,
    },
  );
});
