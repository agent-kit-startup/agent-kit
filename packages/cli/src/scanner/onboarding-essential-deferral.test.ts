import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readJson } from "../utils/fs.js";
import { executeSafeReadinessFixes } from "./safe-fixes.js";

const exec = promisify(execFile);
const GENERATED_AT = "2026-09-20T12:00:00.000Z";

const REQUIRED_SECRET_PATTERNS = [
  ".env",
  ".env.*",
  "*.key",
  "*.pem",
  "*.p12",
  "*.pfx",
  "*credentials*.json",
  "*service-account*.json",
];

/**
 * A repository where every essential readiness check is ready except
 * `stack.detected` (no manifest anywhere, so language stays "unknown" and
 * `hasProjectFiles` stays false) — the check that has zero actions
 * regardless of status (readiness.ts's `check("stack.detected", ..., true,
 * scan.stack.packageManagerEvidence ?? [])`, no fourth `actions` argument).
 */
async function actionlessEssentialFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-essential-defer-"));
  await mkdir(path.join(root, ".cursor"), { recursive: true });
  await writeFile(path.join(root, ".cursor", "agent-kit.json"), JSON.stringify({ version: "1" }));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "architecture.md"), "# Architecture\n");
  await writeFile(path.join(root, "README.md"), "# Sample\n");
  await writeFile(path.join(root, ".gitignore"), REQUIRED_SECRET_PATTERNS.join("\n"));
  await exec("git", ["init", "-b", "main"], { cwd: root });
  await exec("git", ["config", "user.email", "test@example.test"], { cwd: root });
  await exec("git", ["config", "user.name", "Test"], { cwd: root });
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["commit", "-m", "init"], { cwd: root });
  return root;
}

interface OnboardingConfig {
  onboarding: {
    status: string;
    checks: Record<string, { status: string; essential: boolean }>;
  };
}

// dogfood/cursor_stack_detection_no_dart_flutter_subdir_override_2026_09_15.md, defect 4:
// /agent-kit-onboard prose says essential checks cannot be completed by
// deferral; createOnboardingState let ANY essential-plus-deferral complete
// onboarding. Amend (2026-09-20): only an essential check the scanner truly
// has no action for (actions.length === 0) can be completed this way.

describe("createOnboardingState — essential deferral (defect 4 amend)", () => {
  it("does not complete onboarding while stack.detected is needs_choice and undeferred", async () => {
    const root = await actionlessEssentialFixture();
    const result = await executeSafeReadinessFixes(root, {
      generatorVersion: "test",
      generatedAt: GENERATED_AT,
    });
    expect(
      result.after.pillars
        .find((p) => p.pillar === "stack-tooling")
        ?.checks.find((c) => c.id === "stack.detected"),
    ).toMatchObject({ status: "needs_choice", essential: true, actions: [] });

    const config = await readJson<OnboardingConfig>(
      path.join(root, ".cursor", "context", "config.json"),
    );
    expect(config?.onboarding.status).toBe("in_progress");
  });

  it("completes onboarding once the actionless essential stack.detected is explicitly deferred", async () => {
    const root = await actionlessEssentialFixture();
    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "context", "config.json"),
      JSON.stringify({
        onboarding: {
          deferredItems: [
            {
              checkId: "stack.detected",
              reason: "Scanner has no marker or action for this stack",
              recoveryCommand: "agent-kit doctor --json",
            },
          ],
        },
      }),
    );

    await executeSafeReadinessFixes(root, {
      generatorVersion: "test",
      generatedAt: GENERATED_AT,
    });

    const config = await readJson<OnboardingConfig>(
      path.join(root, ".cursor", "context", "config.json"),
    );
    expect(config?.onboarding.status).toBe("completed");
  });

  it("does NOT let a deferral complete an essential check that has a real action (purpose.classification), even alongside a deferral that does", async () => {
    // No manifest and no docs/: both stack.detected (zero actions) and
    // purpose.classification (action `confirm-repository-purpose`) come back
    // needs_choice. Defer both; only the actionless one should count as
    // resolved. Pre-amendment code treated any essential-plus-deferral as
    // resolved, so this fixture would have flipped to "completed".
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-essential-defer-action-"));
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(path.join(root, ".cursor", "agent-kit.json"), JSON.stringify({ version: "1" }));
    await writeFile(path.join(root, "README.md"), "# Sample\n");
    await writeFile(path.join(root, ".gitignore"), REQUIRED_SECRET_PATTERNS.join("\n"));
    await exec("git", ["init", "-b", "main"], { cwd: root });
    await exec("git", ["config", "user.email", "test@example.test"], { cwd: root });
    await exec("git", ["config", "user.name", "Test"], { cwd: root });
    await exec("git", ["add", "."], { cwd: root });
    await exec("git", ["commit", "-m", "init"], { cwd: root });

    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "context", "config.json"),
      JSON.stringify({
        onboarding: {
          deferredItems: [
            {
              checkId: "stack.detected",
              reason: "Scanner has no marker or action for this stack",
              recoveryCommand: "agent-kit doctor --json",
            },
            {
              checkId: "purpose.classification",
              reason: "Operator declined to confirm purpose right now",
              recoveryCommand: "agent-kit doctor --json",
            },
          ],
        },
      }),
    );

    const result = await executeSafeReadinessFixes(root, {
      generatorVersion: "test",
      generatedAt: GENERATED_AT,
    });
    const purposeCheck = result.after.pillars
      .find((p) => p.pillar === "purpose-context")
      ?.checks.find((c) => c.id === "purpose.classification");
    expect(purposeCheck?.status).toBe("needs_choice");
    expect(purposeCheck?.actions.length).toBeGreaterThan(0);

    const config = await readJson<OnboardingConfig>(
      path.join(root, ".cursor", "context", "config.json"),
    );
    // Still in_progress: purpose.classification's deferral does not count,
    // even though stack.detected's does (and both are recorded as deferred).
    expect(config?.onboarding.status).toBe("in_progress");
  });
});
