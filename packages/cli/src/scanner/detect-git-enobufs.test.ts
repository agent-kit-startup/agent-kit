import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ScanResult } from "../types.js";

// Every git call fails the way an oversized `git ls-files` does past maxBuffer.
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    callback: (error: NodeJS.ErrnoException) => void,
  ) => {
    callback(Object.assign(new Error("stdout maxBuffer length exceeded"), { code: "ENOBUFS" }));
  },
}));

const { listTrackedFiles } = await import("./detect-git.js");
const { detectSafety } = await import("./detect-repository.js");
const { createReadinessReport } = await import("./readiness.js");
const { runScanner } = await import("./scan.js");

describe("listTrackedFiles on git failure (ENOBUFS)", () => {
  it("returns undefined instead of an empty list", async () => {
    await expect(listTrackedFiles(os.tmpdir())).resolves.toBeUndefined();
  });

  it("detectSafety flags the unknown list and readiness reports safety.secrets as non-ready", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-enobufs-"));
    const safety = await detectSafety(root, await listTrackedFiles(root));
    expect(safety.trackedFilesUnknown).toBe(true);
    expect(safety.trackedSensitiveFiles).toEqual([]);

    const scan = await runScanner(root);
    // Mocked git also fails rev-parse, so force a git work tree to reach the unknown path.
    const inRepo: ScanResult = { ...scan, git: { ...scan.git, mode: "local-only" }, safety };
    const report = createReadinessReport(inRepo, { generatorVersion: "test" });
    const secrets = report.pillars.flatMap((p) => p.checks).find((c) => c.id === "safety.secrets");
    expect(secrets?.status).toBe("manual");
    expect(secrets?.actions.map((a) => a.id)).toContain("verify-tracked-secrets");
  });
});
