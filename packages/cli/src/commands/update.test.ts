import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { KIT_VERSION } from "../lifecycle/version.js";
import { updateCommand } from "./update.js";

const mockSyncFromManifest = vi.hoisted(() =>
  vi.fn(async (_registryRoot: string, _projectRoot: string, _manifest: unknown) => ({
    written: [],
    removed: [],
    collisions: [],
    skippedProtected: [],
    missing: [],
    unchanged: [".cursor/rules/ux-tone.mdc"],
    preservedCustomized: [],
  })),
);

vi.mock("../lifecycle/sync.js", () => ({
  syncFromManifest: mockSyncFromManifest,
}));

describe("updateCommand", () => {
  // Under full-suite parallel load this test can exceed the default 5s
  // (passes alone ~4s); raise headroom so "tests green" claims stay honest (R7).
  it("preserves personalization and overrides on apply", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-update-preserve-"));
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    const personalization = {
      contractVersion: 1,
      generatorVersion: KIT_VERSION,
      origin: "repository-profile",
      resultPath: ".cursor/context/personalization.json",
    };
    await writeFile(
      path.join(root, ".cursor", "agent-kit.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          version: KIT_VERSION,
          profile: "ops",
          packs: ["clean-code"],
          skills: ["json-data-config"],
          protected: [".cursor/HANDOFF.md"],
          overrides: [{ path: ".cursor/rules/custom.mdc", note: "local" }],
          personalization,
          registry: { url: "https://github.com/agent-kit-startup/agent-kit", ref: "main" },
          installedAt: "2026-07-30T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );

    await (
      updateCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>
    )({
      args: {
        _: [],
        cwd: root,
        check: false,
        json: false,
        "respect-prefs": false,
        stamp: false,
        "seed-overlay": false,
        registry: undefined as unknown as string,
        url: undefined as unknown as string,
        ref: undefined as unknown as string,
        refresh: false,
      },
    });

    const saved = JSON.parse(await readFile(path.join(root, ".cursor", "agent-kit.json"), "utf8"));
    expect(saved.personalization).toEqual(personalization);
    expect(saved.overrides).toEqual([{ path: ".cursor/rules/custom.mdc", note: "local" }]);
    expect(saved.profile).toBe("ops");
    expect(saved.packs).toEqual(["clean-code"]);
    expect(saved.skills).toEqual(["json-data-config"]);
    expect(saved.registry).toEqual({
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    // ADR factory-pseudo-consumer decision 4: no version change must keep the
    // original installedAt value, not a fresh timestamp.
    expect(saved.installedAt).toBe("2026-07-30T00:00:00.000Z");
  }, 15_000);

  it("passes --registry into update --check", async () => {
    const consumer = await mkdtemp(path.join(tmpdir(), "ak-update-check-c-"));
    const kit = await mkdtemp(path.join(tmpdir(), "ak-update-check-k-"));
    await mkdir(path.join(consumer, ".cursor"), { recursive: true });
    await writeFile(
      path.join(consumer, ".cursor", "agent-kit.json"),
      JSON.stringify({
        schemaVersion: 1,
        version: "5.0.0",
        packs: [],
        skills: [],
        protected: [],
        registry: { url: "https://github.com/agent-kit-startup/agent-kit", ref: "main" },
      }),
      "utf8",
    );
    await mkdir(path.join(kit, "registry"), { recursive: true });
    await writeFile(path.join(kit, "registry", "registry.json"), "{}\n", "utf8");
    await mkdir(path.join(kit, "packages", "cli"), { recursive: true });
    await writeFile(
      path.join(kit, "packages", "cli", "package.json"),
      JSON.stringify({ version: "5.1.0" }),
      "utf8",
    );

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    try {
      await (
        updateCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>
      )({
        args: {
          _: [],
          cwd: consumer,
          check: true,
          json: true,
          "respect-prefs": false,
          stamp: false,
          "seed-overlay": false,
          registry: kit,
          url: undefined as unknown as string,
          ref: undefined as unknown as string,
          refresh: false,
        },
      });
    } finally {
      spy.mockRestore();
    }

    const payload = JSON.parse(logs.join("\n")) as {
      status: string;
      registryUrl: string;
      registryRef: string;
      message: string;
    };
    expect(payload.status).toBe("update-available");
    expect(payload.registryUrl).toBe(path.resolve(kit));
    expect(payload.registryRef).toBe("local");
    expect(payload.message).not.toMatch(/public/i);
  });
});
