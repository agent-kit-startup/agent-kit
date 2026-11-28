import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnknownPackError } from "../registry/pack-aliases.js";
import { diffCommand } from "./diff.js";
import { performInstall } from "./install.js";
import { updateCommand } from "./update.js";

// Real syncFromManifest against the repo's own registry; only the PATH CLI
// sync is stubbed so the test never touches a global npm install.
vi.mock("../lifecycle/path-cli.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lifecycle/path-cli.js")>()),
  syncPathCliToRuntime: async () => ({ status: "current", upgraded: false, lines: [] }),
}));

const here = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(here, "../../../..");
const FIXTURE = path.join(here, "../lifecycle/fixtures/agent-kit-manifest-v3.0.0.json");

type Run = (ctx: { args: Record<string, unknown> }) => Promise<void>;

async function v3Consumer(extraPacks: string[] = []): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ak-update-legacy-pack-"));
  await mkdir(path.join(root, ".cursor"), { recursive: true });
  const target = path.join(root, ".cursor", "agent-kit.json");
  await copyFile(FIXTURE, target);
  if (extraPacks.length > 0) {
    const manifest = JSON.parse(await readFile(target, "utf8"));
    manifest.packs = [...manifest.packs, ...extraPacks];
    await writeFile(target, JSON.stringify(manifest, null, 2), "utf8");
  }
  return root;
}

const updateArgs = (cwd: string) => ({
  _: [],
  cwd,
  check: false,
  json: false,
  "respect-prefs": false,
  stamp: false,
  "seed-overlay": false,
  "allow-stale-cli": true,
  yes: true,
  "force-root": true,
  registry: KIT_ROOT,
  url: undefined,
  ref: undefined,
  refresh: false,
});

const diffArgs = (cwd: string) => ({
  _: [],
  cwd,
  all: false,
  registry: KIT_ROOT,
  url: undefined,
  ref: undefined,
  refresh: false,
});

function captureOutput(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const push = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  };
  const log = vi.spyOn(console, "log").mockImplementation(push);
  const err = vi.spyOn(console, "error").mockImplementation(push);
  return {
    lines,
    restore: () => {
      log.mockRestore();
      err.mockRestore();
    },
  };
}

describe("v3.0.0 manifest with legacy pack ids", () => {
  const originalExitCode = process.exitCode;
  const originalEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

  beforeEach(async () => {
    const home = await mkdtemp(path.join(tmpdir(), "ak-update-legacy-pack-home-"));
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("update rewrites packs to the canonical ids and prints one line per rewrite", async () => {
    const consumer = await v3Consumer();
    const out = captureOutput();
    try {
      await (updateCommand.run as unknown as Run)({
        args: {
          _: [],
          cwd: consumer,
          check: false,
          json: false,
          "respect-prefs": false,
          stamp: false,
          "seed-overlay": false,
          "allow-stale-cli": true,
          yes: true,
          "force-root": true,
          registry: KIT_ROOT,
          url: undefined,
          ref: undefined,
          refresh: false,
        },
      });
    } finally {
      out.restore();
    }

    expect(process.exitCode ?? 0).toBe(0);
    const saved = JSON.parse(await readFile(path.join(consumer, ".cursor/agent-kit.json"), "utf8"));
    expect(saved.packs).toEqual(["clean-code", "context-management", "project-management"]);
    const rewrites = out.lines.filter((l) => l.includes("legacy L1 pack id"));
    expect(rewrites).toHaveLength(2);
    expect(rewrites[0]).toContain("Pack id 'gestao-contexto' renamed to 'context-management'");
    expect(rewrites[1]).toContain("Pack id 'gestao-projeto' renamed to 'project-management'");
    expect(out.lines.join("\n")).toContain("Update complete");
  }, 60_000);

  it("diff resolves legacy ids instead of throwing and names the rewrite", async () => {
    const consumer = await v3Consumer();
    const out = captureOutput();
    try {
      await (diffCommand.run as unknown as Run)({
        args: {
          _: [],
          cwd: consumer,
          all: false,
          registry: KIT_ROOT,
          url: undefined,
          ref: undefined,
          refresh: false,
        },
      });
    } finally {
      out.restore();
    }

    const text = out.lines.join("\n");
    expect(text).toContain("Pack id 'gestao-contexto' is a legacy id for 'context-management'");
    expect(text).toContain("Summary:");
    expect(text).not.toContain("pack:gestao");
  }, 60_000);

  it("install --pack with an unknown id fails with the named error before any write", async () => {
    const consumer = await v3Consumer();
    const before = await readFile(path.join(consumer, ".cursor/agent-kit.json"), "utf8");
    const out = captureOutput();
    const err = await performInstall({
      cwd: consumer,
      pack: "clean-code,ghost-pack",
      registry: KIT_ROOT,
      allowStaleCli: true,
    })
      .catch((e: unknown) => e)
      .finally(() => out.restore());
    expect(err).toBeInstanceOf(UnknownPackError);
    expect((err as Error).message).toContain("Unknown pack 'ghost-pack'");
    expect(await readFile(path.join(consumer, ".cursor/agent-kit.json"), "utf8")).toBe(before);
  }, 60_000);

  it("install on a v3.0.0 manifest rewrites legacy pack ids and prints one line per rewrite", async () => {
    const consumer = await v3Consumer();
    const out = captureOutput();
    try {
      await performInstall({ cwd: consumer, registry: KIT_ROOT, allowStaleCli: true });
    } finally {
      out.restore();
    }
    const saved = JSON.parse(await readFile(path.join(consumer, ".cursor/agent-kit.json"), "utf8"));
    expect(saved.packs).toEqual(["clean-code", "context-management", "project-management"]);
    expect(out.lines.filter((l) => l.includes("legacy L1 pack id"))).toHaveLength(2);
  }, 60_000);

  it("update warns once for an unknown pack id, keeps it, and exits 0", async () => {
    const consumer = await v3Consumer(["ghost-pack"]);
    const out = captureOutput();
    try {
      await (updateCommand.run as unknown as Run)({ args: updateArgs(consumer) });
    } finally {
      out.restore();
    }
    expect(process.exitCode ?? 0).toBe(0);
    const warnings = out.lines.filter((l) => l.includes("Unknown pack 'ghost-pack'"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Next:");
    const saved = JSON.parse(await readFile(path.join(consumer, ".cursor/agent-kit.json"), "utf8"));
    expect(saved.packs).toEqual([
      "clean-code",
      "context-management",
      "ghost-pack",
      "project-management",
    ]);
  }, 60_000);

  it("diff names an unknown pack id and lists it as missing-registry", async () => {
    const consumer = await v3Consumer(["ghost-pack"]);
    const out = captureOutput();
    try {
      await (diffCommand.run as unknown as Run)({ args: diffArgs(consumer) });
    } finally {
      out.restore();
    }
    const text = out.lines.join("\n");
    expect(text).toContain("Unknown pack 'ghost-pack'");
    expect(text).toMatch(/missing-registry\s+pack:ghost-pack/);
  }, 60_000);
});
