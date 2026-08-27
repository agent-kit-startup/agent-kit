import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectPurpose } from "./detect-repository.js";
import { detectStack } from "./detect-stack.js";
import { createReadinessReport } from "./readiness.js";
import { runScanner } from "./scan.js";

async function writeProfile(root: string, profile: Record<string, unknown>): Promise<void> {
  await mkdir(path.join(root, ".cursor"), { recursive: true });
  await writeFile(
    path.join(root, ".cursor", "agent-kit.config.json"),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
}

describe("detectPurpose", () => {
  it("falls back to directory heuristics when no profile is present", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-purpose-none-"));
    await mkdir(path.join(root, "docs"));
    const stack = await detectStack(root);

    const purpose = await detectPurpose(root, stack);

    expect(purpose.value).toBe("documentation");
  });

  it("falls back to directory heuristics when the profile's purpose is unknown", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-purpose-unknown-"));
    await mkdir(path.join(root, "docs"));
    await writeProfile(root, { purpose: { value: "unknown" } });
    const stack = await detectStack(root);

    const purpose = await detectPurpose(root, stack);

    expect(purpose.value).toBe("documentation");
  });

  it("honors an operator-confirmed purpose over a directory-name mismatch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-purpose-confirmed-"));
    // Directory heuristics alone would classify this as "documentation".
    await mkdir(path.join(root, "docs"));
    await writeProfile(root, { purpose: { value: "operations", confirmed: true } });
    const stack = await detectStack(root);

    const purpose = await detectPurpose(root, stack);

    expect(purpose.value).toBe("operations");
    expect(purpose.confidence).toBe("high");
  });

  it("ignores a malformed or unrecognized confirmed purpose value", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-purpose-malformed-"));
    await mkdir(path.join(root, "docs"));
    await writeProfile(root, { purpose: { value: "not-a-real-purpose" } });
    const stack = await detectStack(root);

    const purpose = await detectPurpose(root, stack);

    expect(purpose.value).toBe("documentation");
  });

  it("changes purpose.classification on the next scan once an operator confirms it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-purpose-scan-"));
    const before = await runScanner(root);
    expect(before.purpose.value).toBe("unknown");

    await writeProfile(root, { purpose: { value: "knowledge" } });
    const after = await runScanner(root);

    expect(after.purpose.value).toBe("knowledge");
  });
});

describe("readiness stack.detected", () => {
  it("does not derive stack readiness from the purpose signal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-stack-purpose-"));
    // Purpose is confirmed/known (non-unknown), but there is no real stack evidence.
    await mkdir(path.join(root, "docs"));
    await writeProfile(root, { purpose: { value: "documentation" } });

    const scan = await runScanner(root);
    const report = createReadinessReport(scan, {
      generatorVersion: "test",
      generatedAt: "2026-08-20T00:00:00.000Z",
    });
    const stackCheck = report.pillars
      .find((item) => item.pillar === "stack-tooling")
      ?.checks.find((item) => item.id === "stack.detected");

    expect(scan.purpose.value).not.toBe("unknown");
    expect(scan.stack.language).toBe("unknown");
    expect(stackCheck?.status).toBe("needs_choice");
  });

  it("is ready when genuine stack facts exist even if purpose is unknown", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-stack-detected-"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ private: true, scripts: { test: "vitest run" } }),
    );
    await writeFile(path.join(root, "package-lock.json"), "{}");

    const scan = await runScanner(root);
    const report = createReadinessReport(scan, {
      generatorVersion: "test",
      generatedAt: "2026-08-20T00:00:00.000Z",
    });
    const stackCheck = report.pillars
      .find((item) => item.pillar === "stack-tooling")
      ?.checks.find((item) => item.id === "stack.detected");

    expect(scan.stack.language).toBe("node");
    expect(stackCheck?.status).toBe("ready");
  });
});
