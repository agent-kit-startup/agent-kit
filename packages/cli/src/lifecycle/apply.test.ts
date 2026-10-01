import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROTECTED_PATHS } from "../manifest/types.js";
import { buildManifest, copyRegistryFile, emptyStats, recordOutcome } from "./apply.js";
import { migrateLegacyOnboardCommand } from "./onboard-migration.js";
import { MANAGED_HASHES_REL, contentHash, loadManagedHashLedger } from "./overlay.js";
import { logApplyStats } from "./report.js";
import { installL0 } from "./sync.js";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("lifecycle apply L3", () => {
  it("skips writing into protected L3 paths", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l3-"));
    await mkdir(path.join(project, ".cursor"), { recursive: true });
    await writeFile(path.join(project, ".cursor", "HANDOFF.md"), "local handoff\n", "utf8");

    const outcome = await copyRegistryFile(
      kitRoot,
      project,
      ".cursor/rules/ux-tone.mdc",
      ".cursor/HANDOFF.md",
      [...DEFAULT_PROTECTED_PATHS],
    );
    expect(outcome).toBe("skipped-protected");
    expect(await readFile(path.join(project, ".cursor", "HANDOFF.md"), "utf8")).toBe(
      "local handoff\n",
    );
  });

  it("installL0 writes core rules from the kit registry", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l0-"));
    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);
    expect(stats.written.some((p) => p.includes(".cursor/rules/"))).toBe(true);
    expect(stats.written.some((p) => p.includes(".cursor/commands/"))).toBe(true);
    expect(stats.written).toContain(".cursor/commands/agent-kit-onboard.md");
    expect(stats.written).not.toContain(".cursor/commands/onboard.md");
    expect(stats.written.some((p) => p === "autogit/gitupdate.md")).toBe(true);
    expect(stats.written.some((p) => p === "autogit/plan-routine.md")).toBe(true);
  });

  it("installL0 ships the signature gate script and the gate runs in a fresh consumer (#89)", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l0-sig-"));
    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);
    expect(stats.written).toContain("git-hooks/prepare-commit-msg");

    const git = (...args: string[]) =>
      spawnSync(
        "git",
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@example.com",
          "-c",
          "core.hooksPath=/dev/null",
          ...args,
        ],
        {
          cwd: project,
          encoding: "utf8",
        },
      );
    // Hook install into .git/hooks stays optional: the gate only needs the file.
    const gate = () =>
      spawnSync(
        "sh",
        ["-c", "git log -n 2 --format=%B | sh git-hooks/prepare-commit-msg --check -"],
        {
          cwd: project,
          encoding: "utf8",
        },
      );
    expect(git("init", "-q").status).toBe(0);
    expect(git("commit", "-q", "--allow-empty", "-m", "feat: first clean commit").status).toBe(0);
    expect(git("commit", "-q", "--allow-empty", "-m", "fix: second clean commit").status).toBe(0);
    expect(gate().status).toBe(0);

    expect(
      git(
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "feat: signed",
        "-m",
        "Co-Authored-By: Claude <noreply@anthropic.com>",
      ).status,
    ).toBe(0);
    expect(gate().status).toBe(1);
  });

  it("installL0 re-adds the signature gate script to a consumer that lacks it (update path)", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l0-sig-update-"));
    await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);
    await rm(path.join(project, "git-hooks"), { recursive: true, force: true });

    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);

    expect(stats.written).toEqual(["git-hooks/prepare-commit-msg"]);
    expect(await readFile(path.join(project, "git-hooks/prepare-commit-msg"), "utf8")).toBe(
      await readFile(path.join(kitRoot, "git-hooks/prepare-commit-msg"), "utf8"),
    );
  });

  it("removes a managed legacy onboard command after installing the namespaced command", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-onboard-managed-"));
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });
    const legacyContent = "# Command: /onboard\n\nManaged legacy version.\n";
    await writeFile(path.join(project, ".cursor/commands/onboard.md"), legacyContent, "utf8");
    await writeFile(
      path.join(project, ".cursor/commands/agent-kit-onboard.md"),
      "# Command: /agent-kit-onboard\n",
      "utf8",
    );
    const managedHash = createHash("sha256").update(legacyContent).digest("hex");

    const migration = await migrateLegacyOnboardCommand(project, new Set([managedHash]));

    await expect(
      readFile(path.join(project, ".cursor/commands/onboard.md"), "utf8"),
    ).rejects.toThrow();
    expect(migration).toBe("removed-managed");
    expect(
      await readFile(path.join(project, ".cursor/commands/agent-kit-onboard.md"), "utf8"),
    ).toContain("# Command: /agent-kit-onboard");
  });

  it("preserves a customized legacy onboard command and reports the slash collision", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-onboard-custom-"));
    await mkdir(path.join(project, ".cursor/commands"), { recursive: true });
    await writeFile(
      path.join(project, ".cursor/commands/onboard.md"),
      "# Custom onboard\n",
      "utf8",
    );

    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);

    expect(await readFile(path.join(project, ".cursor/commands/onboard.md"), "utf8")).toBe(
      "# Custom onboard\n",
    );
    expect(stats.collisions).toContain(".cursor/commands/onboard.md");
  });

  it("installL0 writes external-review templates (not L3-blocked)", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l0-tpl-"));
    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);
    expect(
      stats.written.some((p) => p === ".cursor/context/templates/plan-external-review-prompt.md"),
    ).toBe(true);
    expect(stats.written.some((p) => p === ".cursor/context/config.example.json")).toBe(true);
    expect(stats.skippedProtected).not.toContain(
      ".cursor/context/templates/plan-external-review-prompt.md",
    );
  });

  it("copyRegistryFile reports unchanged when content matches", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-unchanged-"));
    const rel = ".cursor/rules/ux-tone.mdc";
    const outcome1 = await copyRegistryFile(kitRoot, project, rel, rel, []);
    expect(outcome1).toBe("written");
    const outcome2 = await copyRegistryFile(kitRoot, project, rel, rel, []);
    expect(outcome2).toBe("unchanged");
  });

  describe("managed hooks and scripts overlay", () => {
    const HOOK = ".cursor/hooks/pre-commit/check-secrets.sh";
    const KIT_V1 = '#!/usr/bin/env sh\ncase "$f" in *.json|*.js) ;; esac\n';
    const KIT_V2 = '#!/usr/bin/env sh\ncase "$f" in *.json|*.js|*.ts) ;; esac\n';
    const LOCAL_WIDENED = '#!/usr/bin/env sh\ncase "$f" in *.json|*.js|*.ts|*.mjs|*.sh) ;; esac\n';

    async function makeRegistry(body: string): Promise<string> {
      const registry = await mkdtemp(path.join(tmpdir(), "agent-kit-hook-registry-"));
      await mkdir(path.join(registry, path.dirname(HOOK)), { recursive: true });
      await writeFile(path.join(registry, HOOK), body, "utf8");
      return registry;
    }

    it("refreshes an unedited kit hook and records its hash in the ledger", async () => {
      const project = await mkdtemp(path.join(tmpdir(), "agent-kit-hook-refresh-"));
      const v1 = await makeRegistry(KIT_V1);
      expect(await copyRegistryFile(v1, project, HOOK, HOOK, [])).toBe("written");
      expect((await loadManagedHashLedger(project)).hashes[HOOK]).toBe(contentHash(KIT_V1));

      const v2 = await makeRegistry(KIT_V2);
      expect(await copyRegistryFile(v2, project, HOOK, HOOK, [])).toBe("written");
      expect(await readFile(path.join(project, HOOK), "utf8")).toBe(KIT_V2);
      expect((await loadManagedHashLedger(project)).hashes[HOOK]).toBe(contentHash(KIT_V2));
    });

    it("preserves a locally widened hook instead of narrowing it back (ledger present)", async () => {
      const project = await mkdtemp(path.join(tmpdir(), "agent-kit-hook-preserve-"));
      const v1 = await makeRegistry(KIT_V1);
      await copyRegistryFile(v1, project, HOOK, HOOK, []);
      await writeFile(path.join(project, HOOK), LOCAL_WIDENED, "utf8");

      // Same registry body again: the consumer's edit is the only drift.
      expect(await copyRegistryFile(v1, project, HOOK, HOOK, [])).toBe("preserved-customized");
      expect(await readFile(path.join(project, HOOK), "utf8")).toBe(LOCAL_WIDENED);

      // Newer registry body: still preserved, never a bare overwrite.
      const v2 = await makeRegistry(KIT_V2);
      expect(await copyRegistryFile(v2, project, HOOK, HOOK, [])).toBe("preserved-customized");
      expect(await readFile(path.join(project, HOOK), "utf8")).toBe(LOCAL_WIDENED);
    });

    it("preserves a customized hook when the ledger is absent and seeds the kit hash", async () => {
      // The consumer state from the dogfood note: hook edited and committed,
      // ledger never held a hooks entry because hooks were outside the overlay.
      const project = await mkdtemp(path.join(tmpdir(), "agent-kit-hook-noledger-"));
      await mkdir(path.join(project, path.dirname(HOOK)), { recursive: true });
      await writeFile(path.join(project, HOOK), LOCAL_WIDENED, "utf8");
      const registry = await makeRegistry(KIT_V2);

      expect(await copyRegistryFile(registry, project, HOOK, HOOK, [])).toBe(
        "preserved-customized",
      );
      expect(await readFile(path.join(project, HOOK), "utf8")).toBe(LOCAL_WIDENED);
      const ledger = JSON.parse(await readFile(path.join(project, MANAGED_HASHES_REL), "utf8"));
      expect(ledger.hashes[HOOK]).toBe(contentHash(KIT_V2));

      // Second apply keeps preserving: local ≠ recorded managed hash.
      expect(await copyRegistryFile(registry, project, HOOK, HOOK, [])).toBe(
        "preserved-customized",
      );
    });

    it("applies the same overlay to .cursor/scripts/", async () => {
      const SCRIPT = ".cursor/scripts/plan-external-review.sh";
      const project = await mkdtemp(path.join(tmpdir(), "agent-kit-script-preserve-"));
      const registry = await mkdtemp(path.join(tmpdir(), "agent-kit-script-registry-"));
      await mkdir(path.join(registry, path.dirname(SCRIPT)), { recursive: true });
      await writeFile(path.join(registry, SCRIPT), "kit\n", "utf8");
      expect(await copyRegistryFile(registry, project, SCRIPT, SCRIPT, [])).toBe("written");
      await writeFile(path.join(project, SCRIPT), "local\n", "utf8");
      expect(await copyRegistryFile(registry, project, SCRIPT, SCRIPT, [])).toBe(
        "preserved-customized",
      );
      expect(await readFile(path.join(project, SCRIPT), "utf8")).toBe("local\n");
    });

    it("a single-path protected entry still wins over the overlay", async () => {
      const project = await mkdtemp(path.join(tmpdir(), "agent-kit-hook-protected-"));
      await mkdir(path.join(project, path.dirname(HOOK)), { recursive: true });
      await writeFile(path.join(project, HOOK), LOCAL_WIDENED, "utf8");
      const registry = await makeRegistry(KIT_V2);
      expect(await copyRegistryFile(registry, project, HOOK, HOOK, [HOOK])).toBe(
        "skipped-protected",
      );
      expect(await readFile(path.join(project, HOOK), "utf8")).toBe(LOCAL_WIDENED);
    });

    it("routes a preserved script edit to a factory PR, not agent-kit contribute", () => {
      const logs: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
        logs.push(parts.map(String).join(" "));
      });
      try {
        logApplyStats({
          ...emptyStats(),
          preservedCustomized: [".cursor/scripts/plan-external-review.sh"],
        });
      } finally {
        spy.mockRestore();
      }
      const out = logs.join("\n");
      expect(out).toContain("  ! .cursor/scripts/plan-external-review.sh");
      expect(out).toContain(
        "  Run `agent-kit diff` to see the kit body; send the change upstream (`agent-kit contribute` for agents/skills/commands/hooks, a factory PR for scripts); or add the path to `protected` in .cursor/agent-kit.json to keep it pinned on purpose.",
      );
    });
  });

  describe("symlink containment", () => {
    const RULE = ".cursor/rules/demo.mdc";

    async function makeTree(
      prefix: string,
    ): Promise<{ registry: string; project: string; outside: string }> {
      const registry = await mkdtemp(path.join(tmpdir(), `${prefix}-registry-`));
      const project = await mkdtemp(path.join(tmpdir(), `${prefix}-project-`));
      const outside = await mkdtemp(path.join(tmpdir(), `${prefix}-outside-`));
      await mkdir(path.join(registry, ".cursor/rules"), { recursive: true });
      await mkdir(path.join(project, ".cursor/rules"), { recursive: true });
      return { registry, project, outside };
    }

    it("does not write through a symlinked target that points outside the project", async () => {
      const { registry, project, outside } = await makeTree("agent-kit-symlink-target");
      await writeFile(path.join(registry, RULE), "kit body\n", "utf8");
      const victim = path.join(outside, "victim.txt");
      await writeFile(victim, "outside body\n", "utf8");
      await symlink(victim, path.join(project, RULE));

      const outcome = await copyRegistryFile(registry, project, RULE, RULE, []);
      expect(outcome).toBe("skipped-symlink");
      expect(await readFile(victim, "utf8")).toBe("outside body\n");

      const stats = emptyStats();
      recordOutcome(stats, RULE, outcome);
      expect(stats.skippedSymlink).toEqual([RULE]);
      expect(stats.written).toEqual([]);
      const logs: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
        logs.push(parts.map(String).join(" "));
      });
      try {
        logApplyStats(stats);
      } finally {
        spy.mockRestore();
      }
      expect(logs.join("\n")).toContain(`  ~ ${RULE}`);
    });

    it("does not write through a symlinked parent directory outside the project", async () => {
      const { registry, project, outside } = await makeTree("agent-kit-symlink-parent");
      await mkdir(path.join(registry, ".cursor/commands"), { recursive: true });
      await writeFile(path.join(registry, ".cursor/commands/x.md"), "kit\n", "utf8");
      await writeFile(path.join(outside, "x.md"), "outside\n", "utf8");
      await symlink(outside, path.join(project, ".cursor/commands"));

      const rel = ".cursor/commands/x.md";
      expect(await copyRegistryFile(registry, project, rel, rel, [])).toBe("skipped-symlink");
      expect(await readFile(path.join(outside, "x.md"), "utf8")).toBe("outside\n");
    });

    it("does not create a new file through a symlinked parent directory outside the project", async () => {
      const { registry, project, outside } = await makeTree("agent-kit-symlink-parent-new");
      await mkdir(path.join(registry, ".cursor/commands/sub"), { recursive: true });
      await writeFile(path.join(registry, ".cursor/commands/sub/x.md"), "kit\n", "utf8");
      await symlink(outside, path.join(project, ".cursor/commands"));

      const rel = ".cursor/commands/sub/x.md";
      expect(await copyRegistryFile(registry, project, rel, rel, [])).toBe("skipped-symlink");
      await expect(access(path.join(outside, "sub", "x.md"))).rejects.toThrow();
    });

    it("still writes through a symlinked parent that stays inside the project", async () => {
      const { registry, project } = await makeTree("agent-kit-symlink-parent-inside");
      await mkdir(path.join(registry, ".cursor/commands"), { recursive: true });
      await writeFile(path.join(registry, ".cursor/commands/x.md"), "kit\n", "utf8");
      await mkdir(path.join(project, "real-commands"), { recursive: true });
      await symlink(path.join(project, "real-commands"), path.join(project, ".cursor/commands"));

      const rel = ".cursor/commands/x.md";
      expect(await copyRegistryFile(registry, project, rel, rel, [])).toBe("written");
      expect(await readFile(path.join(project, "real-commands", "x.md"), "utf8")).toBe("kit\n");
    });

    it("does not read a symlinked source that points outside the registry", async () => {
      const { registry, project, outside } = await makeTree("agent-kit-symlink-source");
      const secret = path.join(outside, "secret.txt");
      await writeFile(secret, "outside secret\n", "utf8");
      await symlink(secret, path.join(registry, RULE));

      expect(await copyRegistryFile(registry, project, RULE, RULE, [])).toBe("skipped-symlink");
      await expect(access(path.join(project, RULE))).rejects.toThrow();
    });

    it("leaves normal copies unchanged", async () => {
      const { registry, project } = await makeTree("agent-kit-symlink-normal");
      await writeFile(path.join(registry, RULE), "kit body\n", "utf8");
      expect(await copyRegistryFile(registry, project, RULE, RULE, [])).toBe("written");
      expect(await readFile(path.join(project, RULE), "utf8")).toBe("kit body\n");
      expect(await copyRegistryFile(registry, project, RULE, RULE, [])).toBe("unchanged");
    });
  });

  it("buildManifest preserves personalization and optional metadata", () => {
    const personalization = {
      contractVersion: 1,
      generatorVersion: "4.8.4",
      origin: "repository-profile" as const,
      resultPath: ".cursor/context/personalization.json",
    };
    const manifest = buildManifest({
      version: "4.8.4",
      profile: "ops",
      packs: ["clean-code"],
      skills: ["json-data-config"],
      protected: [".cursor/HANDOFF.md"],
      personalization,
      registryUrl: "https://github.com/agent-kit-startup/agent-kit",
      registryRef: "main",
    });
    expect(manifest.version).toBe("4.8.4");
    expect(manifest.personalization).toEqual(personalization);
    expect(manifest.registry).toEqual({
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    expect(manifest.protected).toContain(".cursor/HANDOFF.md");
  });
});
