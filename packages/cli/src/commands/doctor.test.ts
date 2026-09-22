import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor } from "./doctor.js";

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
