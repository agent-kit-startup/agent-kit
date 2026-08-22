import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { KIT_VERSION } from "../lifecycle/version.js";
import { fileExists } from "../utils/fs.js";
import { runDoctor } from "./doctor.js";
import { runInitCompatibility } from "./init.js";
import { type InstallResult, performInstall } from "./install.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const GENERATED_AT = "2026-07-24T12:00:00.000Z";

describe("readiness commands", () => {
  it("installs L0, applies safe preparation, and writes a portable snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-install-"));
    await writeFile(path.join(root, "README.md"), "# Consumer\n");

    const result = await performInstall({ cwd: root, registry: REPOSITORY_ROOT });
    const snapshot = await readFile(path.join(root, ".cursor/context/readiness.json"), "utf8");

    expect(result.readiness.generatorVersion).toBe(KIT_VERSION);
    expect(await fileExists(path.join(root, ".cursor/rules/hitl-ask-questions.mdc"))).toBe(true);
    expect(await fileExists(path.join(root, ".cursor/commands/agent-kit-onboard.md"))).toBe(true);
    expect(await fileExists(path.join(root, ".cursor/commands/onboard.md"))).toBe(false);
    expect(await fileExists(path.join(root, ".cursor/context/templates/plan.md"))).toBe(true);
    expect(await fileExists(path.join(root, ".cursor/context/personalization.json"))).toBe(true);
    expect(
      result.readiness.pillars
        .flatMap((pillar) => pillar.checks)
        .find((check) => check.id === "agent-kit.context")?.status,
    ).toBe("ready");
    expect(snapshot).not.toContain(root);
    expect(JSON.parse(snapshot).repositoryFingerprint).toMatch(/^[a-f0-9]{64}$/);
  }, 20_000);

  it("returns doctor JSON data without chat output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-doctor-"));
    await writeFile(path.join(root, "README.md"), "# Consumer\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await runDoctor(root, { generatedAt: GENERATED_AT });
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);

    expect(log).not.toHaveBeenCalled();
    expect(parsed.report.generatedAt).toBe(GENERATED_AT);
    expect(json).not.toContain(root);
    expect(typeof parsed.env.binOnPath).toBe("boolean");
    expect(typeof parsed.env.npmPrefixWritable).toBe("boolean");
    expect(typeof parsed.env.nodeVersionOk).toBe("boolean");
    expect("shellProfile" in parsed.env).toBe(true);
    log.mockRestore();
  });

  it("limits doctor safe repair to the local safe executor", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-doctor-safe-"));
    await writeFile(path.join(root, "README.md"), "# Consumer\n");

    const result = await runDoctor(root, { fixSafe: true, generatedAt: GENERATED_AT });

    expect(result.safeChanges.some((change) => change.status === "applied")).toBe(true);
    expect(await fileExists(path.join(root, ".gitignore"))).toBe(true);
    expect(await fileExists(path.join(root, ".git"))).toBe(false);
    // --fix-safe never runs env self-heal; it only reports the same
    // read-only env pillar as the default doctor path.
    expect(typeof result.env.binOnPath).toBe("boolean");
    expect(typeof result.env.nodeVersionOk).toBe("boolean");
  }, 20_000);

  it("keeps init as a compatibility wrapper over install", async () => {
    const expected = { projectRoot: "/tmp/example" } as InstallResult;
    const installer = vi.fn(async () => expected);

    await expect(runInitCompatibility("/tmp/example", installer)).resolves.toBe(expected);
    expect(installer).toHaveBeenCalledWith({ cwd: "/tmp/example" });
  });
});
