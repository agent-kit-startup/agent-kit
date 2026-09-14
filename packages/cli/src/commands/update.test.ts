import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("restamps personalization.generatorVersion with the applying CLI version", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-update-restamp-"));
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "agent-kit.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          version: KIT_VERSION,
          personalization: {
            contractVersion: 1,
            generatorVersion: "0.0.1",
            origin: "repository-profile",
            resultPath: ".cursor/context/personalization.json",
          },
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
    expect(saved.personalization).toEqual({
      contractVersion: 1,
      generatorVersion: KIT_VERSION,
      origin: "repository-profile",
      resultPath: ".cursor/context/personalization.json",
    });
    expect(saved.version).toBe(KIT_VERSION);
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
  describe("stale-CLI guard", () => {
    const originalExitCode = process.exitCode;
    beforeEach(() => {
      // Shared with the suites above, which already invoked it.
      mockSyncFromManifest.mockClear();
    });
    afterEach(() => {
      // Leaks into the whole suite's exit status otherwise.
      process.exitCode = originalExitCode;
    });

    async function makeConsumer(): Promise<string> {
      const consumer = await mkdtemp(path.join(tmpdir(), "ak-update-stale-c-"));
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
          installedAt: "2026-07-30T00:00:00.000Z",
        }),
        "utf8",
      );
      return consumer;
    }

    /** Local kit checkout resolvable by --registry, at an explicit version. */
    async function makeKit(version: string | null): Promise<string> {
      const kit = await mkdtemp(path.join(tmpdir(), "ak-update-stale-k-"));
      await mkdir(path.join(kit, "registry"), { recursive: true });
      await writeFile(path.join(kit, "registry", "registry.json"), "{}\n", "utf8");
      await mkdir(path.join(kit, "packages", "cli"), { recursive: true });
      await writeFile(
        path.join(kit, "packages", "cli", "package.json"),
        JSON.stringify(version === null ? {} : { version }),
        "utf8",
      );
      return kit;
    }

    function applyArgs(consumer: string, kit: string, extra: Record<string, unknown> = {}) {
      return {
        _: [],
        cwd: consumer,
        check: false,
        json: false,
        "respect-prefs": false,
        stamp: false,
        "seed-overlay": false,
        "allow-stale-cli": false,
        yes: true,
        "force-root": true,
        registry: kit,
        url: undefined as unknown as string,
        ref: undefined as unknown as string,
        refresh: false,
        ...extra,
      };
    }

    const run = (args: Record<string, unknown>) =>
      (updateCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>)({
        args,
      });

    it("refuses to apply when the CLI is older than the registry", async () => {
      const consumer = await makeConsumer();
      const kit = await makeKit("999.0.0");
      const errors: string[] = [];
      const spy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
        errors.push(parts.map(String).join(" "));
      });
      try {
        await run(applyArgs(consumer, kit));
      } finally {
        spy.mockRestore();
      }

      expect(mockSyncFromManifest).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      // The remedy must name the pinned spec, not a bare `@latest`.
      expect(errors.join("\n")).toContain("npm i -g @dadado/agent-kit-cli@999.0.0");
      // Refusing must not have written a capped manifest.
      const saved = JSON.parse(
        await readFile(path.join(consumer, ".cursor", "agent-kit.json"), "utf8"),
      );
      expect(saved.version).toBe("5.0.0");
    }, 15_000);

    it("--yes does not bypass the guard", async () => {
      const consumer = await makeConsumer();
      const kit = await makeKit("999.0.0");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await run(applyArgs(consumer, kit, { yes: true }));
      } finally {
        spy.mockRestore();
      }
      expect(mockSyncFromManifest).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    }, 15_000);

    it("--allow-stale-cli applies anyway", async () => {
      const consumer = await makeConsumer();
      const kit = await makeKit("999.0.0");
      await run(applyArgs(consumer, kit, { "allow-stale-cli": true }));

      expect(mockSyncFromManifest).toHaveBeenCalled();
      const saved = JSON.parse(
        await readFile(path.join(consumer, ".cursor", "agent-kit.json"), "utf8"),
      );
      // Capped at the running CLI's version -- the documented consequence.
      expect(saved.version).toBe(KIT_VERSION);
    }, 15_000);

    it("applies when the registry carries no version", async () => {
      const consumer = await makeConsumer();
      const kit = await makeKit(null);
      await run(applyArgs(consumer, kit));

      expect(mockSyncFromManifest).toHaveBeenCalled();
      expect(process.exitCode).not.toBe(1);
    }, 15_000);

    it("reports the version transition on success", async () => {
      const consumer = await makeConsumer();
      const kit = await makeKit("1.0.0");
      const logs: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
        logs.push(parts.map(String).join(" "));
      });
      try {
        await run(applyArgs(consumer, kit));
      } finally {
        spy.mockRestore();
      }
      expect(logs.join("\n")).toContain(`v5.0.0 → v${KIT_VERSION}`);
    }, 15_000);
  });
});
