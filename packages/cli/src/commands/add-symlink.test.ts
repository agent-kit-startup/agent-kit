import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addCommand } from "./add.js";

// Real installSkill against the repo's own registry, into a consumer whose
// .cursor/skills/community is a symlink to a shared dir outside the project.
const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("addCommand with a symlinked skills dir outside the project", () => {
  const originalExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("fails with exit 1, names the skipped paths, and leaves the manifest unchanged", async () => {
    const consumer = await mkdtemp(path.join(tmpdir(), "ak-add-symlink-c-"));
    const shared = await mkdtemp(path.join(tmpdir(), "ak-add-symlink-shared-"));
    await mkdir(path.join(consumer, ".cursor", "skills"), { recursive: true });
    await symlink(shared, path.join(consumer, ".cursor", "skills", "community"));
    const manifestPath = path.join(consumer, ".cursor", "agent-kit.json");
    const before = JSON.stringify({
      schemaVersion: 1,
      version: "5.0.0",
      protected: [],
      installedAt: "2026-07-30T00:00:00.000Z",
    });
    await writeFile(manifestPath, before, "utf8");

    const errors: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await (
        addCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>
      )({
        args: {
          _: [],
          id: "cursor-skills-node",
          skill: true,
          pack: false,
          cwd: consumer,
          registry: KIT_ROOT,
          url: undefined as unknown as string,
          ref: undefined as unknown as string,
          refresh: false,
        },
      });
    } finally {
      errSpy.mockRestore();
      logSpy.mockRestore();
    }

    expect(process.exitCode).toBe(1);
    const errorText = errors.join("\n");
    expect(errorText).toContain("resolve outside the project (symlink)");
    expect(errorText).toContain(".cursor/skills/community/cursor-skills-node/");
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  }, 30_000);
});
