import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateCommand } from "./update.js";

// Real syncFromManifest (update.test.ts mocks it): apply the repo's own L0
// against a consumer whose .cursor/rules is a symlink to a shared dir.
const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("updateCommand with a symlinked .cursor/rules outside the project", () => {
  const originalExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("fails with exit 1, names the skipped paths, and keeps the manifest version", async () => {
    const consumer = await mkdtemp(path.join(tmpdir(), "ak-update-symlink-c-"));
    const shared = await mkdtemp(path.join(tmpdir(), "ak-update-symlink-shared-"));
    await mkdir(path.join(consumer, ".cursor"), { recursive: true });
    await symlink(shared, path.join(consumer, ".cursor", "rules"));
    const manifestPath = path.join(consumer, ".cursor", "agent-kit.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        version: "5.0.0",
        protected: [],
        installedAt: "2026-07-30T00:00:00.000Z",
      }),
      "utf8",
    );

    const errors: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await (
        updateCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>
      )({
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
    expect(errorText).toContain(".cursor/rules/");
    expect(errorText).toContain("Manifest version left unchanged");
    const saved = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(saved.version).toBe("5.0.0");
    expect(saved.installedAt).toBe("2026-07-30T00:00:00.000Z");
  }, 30_000);
});
