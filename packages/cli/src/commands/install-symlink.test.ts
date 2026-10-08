import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkippedSymlinkError } from "../lifecycle/report.js";
import { READINESS_SNAPSHOT_RELATIVE_PATH } from "../scanner/snapshot.js";
import { installCommand, performInstall } from "./install.js";

// The npm "behind" check is network-bound and irrelevant here.
vi.mock("../lifecycle/check-updates.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lifecycle/check-updates.js")>();
  return { ...mod, warnIfRunningCliBehindNpm: async () => ({ status: "skipped" }) };
});

// Real L0 + personalization against the repo's own registry, into a Node
// consumer whose .cursor/skills/community (where personalization installs
// cursor-skills-node) is a symlink to a shared dir outside the project.
const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function makeConsumer(): Promise<string> {
  const consumer = await mkdtemp(path.join(tmpdir(), "ak-install-symlink-c-"));
  const shared = await mkdtemp(path.join(tmpdir(), "ak-install-symlink-shared-"));
  await writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({ packageManager: "npm@10.0.0", scripts: { test: "vitest run" } }),
  );
  await writeFile(path.join(consumer, "package-lock.json"), "{}");
  await mkdir(path.join(consumer, ".cursor", "skills"), { recursive: true });
  await symlink(shared, path.join(consumer, ".cursor", "skills", "community"));
  return consumer;
}

async function expectConsistentManifest(consumer: string): Promise<void> {
  // The personalization save ran without the skipped skill; snapshot written.
  const saved = JSON.parse(
    await readFile(path.join(consumer, ".cursor", "agent-kit.json"), "utf8"),
  );
  expect(saved.skills ?? []).not.toContain("cursor-skills-node");
  expect(saved.personalization).toMatchObject({ origin: "repository-profile" });
  await expect(
    access(path.join(consumer, READINESS_SNAPSHOT_RELATIVE_PATH)),
  ).resolves.toBeUndefined();
}

describe("performInstall with a symlinked personalization skills dir", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("fails loud and does not record the skipped skill in the manifest", async () => {
    const consumer = await makeConsumer();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let caught: unknown;
    try {
      await performInstall({ cwd: consumer, registry: KIT_ROOT });
    } catch (err) {
      caught = err;
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }

    expect(caught).toBeInstanceOf(SkippedSymlinkError);
    const err = caught as SkippedSymlinkError;
    expect(err.message).toContain("resolve outside the project (symlink)");
    expect(err.message).toContain(".cursor/skills/community/cursor-skills-node/");
    expect(err.message).toContain("Manifest saved without: cursor-skills-node");
    expect(err.message).not.toContain("version left unchanged");
    expect(err.stats.skippedSymlink).toEqual(
      expect.arrayContaining([
        expect.stringContaining(".cursor/skills/community/cursor-skills-node/"),
      ]),
    );
    await expectConsistentManifest(consumer);
  }, 60_000);

  it("install command exits 1 and names the skipped path", async () => {
    const consumer = await makeConsumer();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed = "";
    try {
      await (
        installCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>
      )({
        args: {
          _: [],
          cwd: consumer,
          yes: true,
          "force-root": true,
          registry: KIT_ROOT,
          refresh: false,
          claude: false,
        },
      });
      printed = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(process.exitCode).toBe(1);
    expect(printed).toContain(".cursor/skills/community/cursor-skills-node/");
    expect(printed).not.toContain("version left unchanged");
    await expectConsistentManifest(consumer);
  }, 60_000);
});

describe("performInstall --claude with a symlinked .claude/settings.json", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("fails loud, names the path, and leaves the outside file unchanged", async () => {
    const consumer = await mkdtemp(path.join(tmpdir(), "ak-install-claude-link-c-"));
    const outside = await mkdtemp(path.join(tmpdir(), "ak-install-claude-link-out-"));
    const target = path.join(outside, "settings.json");
    await writeFile(target, '{"keep":true}\n', "utf8");
    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify({ packageManager: "npm@10.0.0", scripts: { test: "vitest run" } }),
    );
    await writeFile(path.join(consumer, "package-lock.json"), "{}");
    await mkdir(path.join(consumer, ".claude"), { recursive: true });
    await symlink(target, path.join(consumer, ".claude", "settings.json"));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let caught: unknown;
    try {
      await performInstall({ cwd: consumer, registry: KIT_ROOT, claudeAdapters: true });
    } catch (err) {
      caught = err;
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }

    expect(caught).toBeInstanceOf(SkippedSymlinkError);
    expect((caught as SkippedSymlinkError).stats.skippedSymlink).toContain(".claude/settings.json");
    expect(await readFile(target, "utf8")).toBe('{"keep":true}\n');
  }, 60_000);
});

describe("performInstall Claude command adapter hint (#92)", () => {
  async function plainConsumer(): Promise<string> {
    const consumer = await mkdtemp(path.join(tmpdir(), "ak-install-hint-"));
    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify({ packageManager: "npm@10.0.0", scripts: { test: "vitest run" } }),
    );
    await writeFile(path.join(consumer, "package-lock.json"), "{}");
    return consumer;
  }

  it("plain install leaves only agent-kit.md and returns one hint naming update --claude", async () => {
    const consumer = await plainConsumer();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await performInstall({ cwd: consumer, registry: KIT_ROOT });
    expect(result.claudeAdapterHint).toContain("agent-kit update --claude");
    await expect(
      access(path.join(consumer, ".claude", "commands", "agent-kit.md")),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(consumer, ".claude", "commands", "run-plan.md")),
    ).rejects.toThrow();
  });

  it("install --claude generates adapters and returns no hint", async () => {
    const consumer = await plainConsumer();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await performInstall({
      cwd: consumer,
      registry: KIT_ROOT,
      claudeAdapters: true,
    });
    expect(result.claudeAdapterHint).toBeUndefined();
    await expect(
      access(path.join(consumer, ".claude", "commands", "run-plan.md")),
    ).resolves.toBeUndefined();
  });
});
