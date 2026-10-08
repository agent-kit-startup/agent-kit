import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printDoctorSummary, runDoctor } from "./doctor.js";
import { statusCommand } from "./status.js";

describe("doctor runtime CLI warn", () => {
  it("wires warnIfRunningCliBehindNpm before the run and skips it on --json", async () => {
    const src = await readFile(new URL("./doctor.ts", import.meta.url), "utf8");
    expect(src).toMatch(/warnIfRunningCliBehindNpm/);
    expect(src).toMatch(/if \(!args\.json\)/);
  });
});

// dogfood/cursor_stack_detection_no_dart_flutter_subdir_override_2026_09_15.md, defect 6:
// visible "Deferred essential:" reporting so onboarding "completed" is never
// silently indistinguishable from "every essential check is truly ready".
describe("runDoctor — deferredEssentials", () => {
  it("reports an essential check deferred via .cursor/context/config.json#onboarding.deferredItems", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-doctor-deferred-"));
    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "context", "config.json"),
      JSON.stringify({
        onboarding: {
          deferredItems: [
            { checkId: "stack.detected", reason: "No manifest recognized for this stack" },
            // Non-essential deferral must not show up as a "Deferred essential".
            { checkId: "collaboration.provider", reason: "Provider confirmation postponed" },
          ],
        },
      }),
    );
    const result = await runDoctor(root, {});
    expect(result.deferredEssentials).toEqual([
      { checkId: "stack.detected", reason: "No manifest recognized for this stack" },
    ]);
  });

  it("returns no deferred essentials when there is no onboarding config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-doctor-no-config-"));
    const result = await runDoctor(root, {});
    expect(result.deferredEssentials).toEqual([]);
  });
});

// Public issue #96: doctor/status in a workspace parent (no manifest, kit-installed
// children) must say "no kit here, run from a child", not recommend an L0 install.
describe("doctor / status in a workspace parent", () => {
  afterEach(() => vi.restoreAllMocks());

  async function makeKit(dir: string): Promise<void> {
    await mkdir(path.join(dir, ".cursor"), { recursive: true });
    await writeFile(path.join(dir, ".cursor", "agent-kit.json"), '{"version":"0.0.0"}\n');
  }

  async function parentWithKits(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-doctor-parent-"));
    await makeKit(path.join(root, "beta"));
    await makeKit(path.join(root, "alpha"));
    return root;
  }

  function captureLog(): () => string {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    return () => spy.mock.calls.map((call) => call.join(" ")).join("\n");
  }

  it("runDoctor flags the parent, names children, and writes nothing", async () => {
    const root = await parentWithKits();
    const result = await runDoctor(root, {});
    expect(result.workspaceParent).toEqual({ kitProjects: ["alpha", "beta"] });
    expect(await readdir(root)).not.toContain(".cursor");
    // Write-capable flags must also stay read-only in a non-project parent.
    await runDoctor(root, { fixSafe: true });
    await runDoctor(root, { refreshProfile: true });
    expect(await readdir(root)).not.toContain(".cursor");
  });

  it("prints the advisory and a Next line that does not recommend installing L0", async () => {
    const root = await parentWithKits();
    const out = captureLog();
    printDoctorSummary(await runDoctor(root, {}), root);
    const text = out();
    expect(text).toContain("No Agent Kit here");
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
    expect(text).toContain("Next: cd alpha && agent-kit doctor");
    expect(text).not.toMatch(/install/i);
    expect(text).not.toContain("hooks:");
    expect(text).not.toContain("Repository readiness");
  });

  it("is unchanged when children exist but none are kit projects", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-doctor-nokit-children-"));
    await mkdir(path.join(root, "app"));
    await mkdir(path.join(root, "node_modules", "dep", ".cursor"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "dep", ".cursor", "agent-kit.json"), "{}");
    await makeKit(path.join(root, ".hidden"));
    const result = await runDoctor(root, {});
    expect(result.workspaceParent).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty("workspaceParent");
    // Existing behavior: the readiness snapshot is still written for a plain dir.
    expect(await readdir(root)).toContain(".cursor");
    const out = captureLog();
    printDoctorSummary(result, root);
    expect(out()).toContain("Repository readiness");
  });

  it("is unchanged for a real kit root that also has kit children", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-doctor-kit-root-"));
    await makeKit(root);
    await makeKit(path.join(root, "child"));
    const result = await runDoctor(root, {});
    expect(result.workspaceParent).toBeUndefined();
    const out = captureLog();
    printDoctorSummary(result, root);
    expect(out()).toContain("Repository readiness");
  });

  it("status prints the same advisory and skips readiness output", async () => {
    const root = await parentWithKits();
    const out = captureLog();
    await statusCommand.run?.({ args: { cwd: root, json: false } } as never);
    const text = out();
    expect(text).toContain("No Agent Kit here");
    expect(text).toContain("Next: cd alpha && agent-kit status");
    expect(text).not.toMatch(/install/i);
    expect(text).not.toContain("Repository readiness");
    expect(await readdir(root)).not.toContain(".cursor");
  });

  it("status --json adds workspaceParent without changing existing fields", async () => {
    const root = await parentWithKits();
    const out = captureLog();
    await statusCommand.run?.({ args: { cwd: root, json: true } } as never);
    const parsed = JSON.parse(out());
    expect(parsed.workspaceParent).toEqual({ kitProjects: ["alpha", "beta"] });
    expect(parsed).toHaveProperty("readiness");
    expect(parsed).toHaveProperty("manifest");
  });
});
