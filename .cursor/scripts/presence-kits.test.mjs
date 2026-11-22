import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildKit,
  buildKits,
  loadSource,
  main,
  NETWORKS,
  pickBio,
  renderKit,
  SOURCE_PATH,
  validateSource,
} from "./presence-kits.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = loadSource(repoRoot);

test("source validates and every network kit builds without problems", () => {
  assert.deepEqual(validateSource(source), []);
  const kits = buildKits(source);
  assert.equal(
    kits.length,
    NETWORKS.reduce((n, net) => n + net.names.length, 0),
  );
  assert.deepEqual(
    kits.flatMap((k) => k.problems),
    [],
  );
});

test("verified limits are respected (Mastodon)", () => {
  for (const k of buildKits(source, { network: "mastodon" })) {
    assert.ok(k.bio, `${k.name} has a bio`);
    assert.ok(k.bio.length <= 500);
    assert.ok(k.displayName.length <= 30);
  }
});

test("pickBio prefers the long bio, falls back to the short one, never truncates", () => {
  const n = { longBio: "x".repeat(50), shortBio: "y".repeat(20) };
  assert.equal(pickBio(n, 60).bio, n.longBio);
  assert.equal(pickBio(n, 30).bio, n.shortBio);
  assert.match(pickBio(n, 10).problem, /exceed/);
  assert.equal(pickBio(n, null).bio, null);
});

test("an unverified limit shows both bios and says so", () => {
  const kit = buildKits(source, { network: "threads" })[0];
  const text = renderKit(kit, source.checked);
  assert.match(text, /Bio limit: not verified/);
  assert.match(text, /Long \(/);
  assert.match(text, /Short \(/);
});

test("handle rules filter candidates (YouTube 3-30)", () => {
  const net = { key: "t", label: "T", names: ["suite"], handleRule: { min: 3, max: 10 } };
  const kit = buildKit(net, "suite", {
    ...source.names.suite,
    handles: ["ab", "missionkit", "missionkithq"],
  });
  assert.deepEqual(kit.handles, ["missionkit"]);
});

test("dash characters in source copy are rejected", () => {
  const bad = structuredClone(source);
  bad.names.suite.shortBio = `Mission Kit ${String.fromCharCode(0x2014)} a suite`;
  assert.ok(validateSource(bad).some((e) => e.includes("dash")));
});

test("no Oligarchy kit for Discord and no brand kit for Hacker News", () => {
  assert.ok(!NETWORKS.some((n) => n.key === "discord" || n.key === "hackernews"));
});

test("main writes only under the gitignored drafts folder", () => {
  const room = mkdtempSync(join(tmpdir(), "ak-presence-"));
  try {
    mkdirSync(join(room, dirname(SOURCE_PATH)), { recursive: true });
    cpSync(join(repoRoot, SOURCE_PATH), join(room, SOURCE_PATH));
    const out = [];
    const code = main(["--network", "mastodon"], {
      repoRoot: room,
      out: { write: (s) => out.push(s) },
    });
    assert.equal(code, 0);
    const file = join(room, ".cursor", "comms-drafts", "presence", "mastodon-suite.md");
    assert.ok(existsSync(file));
    assert.match(readFileSync(file, "utf8"), /Bio \(\d+\/500\)/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("--check writes nothing and unknown networks fail", () => {
  const room = mkdtempSync(join(tmpdir(), "ak-presence-"));
  try {
    mkdirSync(join(room, dirname(SOURCE_PATH)), { recursive: true });
    cpSync(join(repoRoot, SOURCE_PATH), join(room, SOURCE_PATH));
    const io = { out: { write: () => {} }, err: { write: () => {} } };
    assert.equal(main(["--check"], { repoRoot: room, ...io }), 0);
    assert.ok(!existsSync(join(room, ".cursor", "comms-drafts")));
    assert.equal(main(["--network", "myspace"], { repoRoot: room, ...io }), 1);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});
