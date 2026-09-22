import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectStack } from "./detect-stack.js";

async function tmpRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

// dogfood/cursor_stack_detection_no_dart_flutter_subdir_override_2026_09_15.md

describe("detectStack — Dart/Flutter (defect 1)", () => {
  it("detects a root dart package (no flutter: key)", async () => {
    const root = await tmpRoot("agent-kit-dart-");
    await writeFile(path.join(root, "pubspec.yaml"), "name: sample\nversion: 1.0.0\n");
    const result = await detectStack(root);
    expect(result.language).toBe("dart");
    expect(result.framework).toBe("dart");
    expect(result.testCommands).toEqual(["dart test"]);
    expect(result.validationCommands).toEqual([
      "dart analyze --fatal-infos",
      "dart format --output=none --set-exit-if-changed .",
    ]);
    expect(result.hasProjectFiles).toBe(true);
  });

  it("detects a root flutter package (flutter: key)", async () => {
    const root = await tmpRoot("agent-kit-flutter-");
    await writeFile(
      path.join(root, "pubspec.yaml"),
      ["name: sample", "dependencies:", "  flutter:", "    sdk: flutter", ""].join("\n"),
    );
    const result = await detectStack(root);
    expect(result.language).toBe("dart");
    expect(result.framework).toBe("flutter");
    expect(result.testCommands).toEqual(["flutter test"]);
  });
});

describe("detectStack — one-level subdirectory scan (defect 2)", () => {
  it("finds a Dart core/ + Flutter app/ monorepo with no root manifest", async () => {
    const root = await tmpRoot("agent-kit-monorepo-");
    await mkdir(path.join(root, "core"));
    await mkdir(path.join(root, "app"));
    await writeFile(path.join(root, "core", "pubspec.yaml"), "name: core\n");
    await writeFile(
      path.join(root, "app", "pubspec.yaml"),
      ["name: app", "dependencies:", "  flutter:", "    sdk: flutter", ""].join("\n"),
    );
    await writeFile(path.join(root, "README.md"), "# sample\n");

    const result = await detectStack(root);
    expect(result.language).toBe("dart");
    expect(result.framework).toBe("flutter");
    expect(result.workspaces).toBe(true);
    // The purpose cascade (detectPurpose's `stack.hasProjectFiles` -> "application")
    // is exactly what was broken: root has no manifest, so this must flip true.
    expect(result.hasProjectFiles).toBe(true);
    expect(result.testCommands.sort()).toEqual(["dart test", "flutter test"]);
    expect(result.packageManagerEvidence).toEqual(
      expect.arrayContaining([
        { source: "file", value: "core/pubspec.yaml" },
        { source: "file", value: "app/pubspec.yaml" },
      ]),
    );
  });

  it("finds a node package one level down when the root has no manifest", async () => {
    const root = await tmpRoot("agent-kit-nested-node-");
    await mkdir(path.join(root, "service"));
    await writeFile(
      path.join(root, "service", "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    const result = await detectStack(root);
    expect(result.language).toBe("node");
    expect(result.workspaces).toBe(true);
    expect(result.hasProjectFiles).toBe(true);
    expect(result.testCommands).toEqual(["npm run test"]);
  });

  it("does not scan subdirectories when the root already has a manifest", async () => {
    const root = await tmpRoot("agent-kit-root-manifest-");
    await writeFile(path.join(root, "package.json"), JSON.stringify({}));
    await mkdir(path.join(root, "vendor"));
    await writeFile(path.join(root, "vendor", "pubspec.yaml"), "name: unrelated\n");
    const result = await detectStack(root);
    expect(result.language).toBe("node");
    expect(result.workspaces).toBe(false);
  });

  it("skips node_modules, .git, build, and .dart_tool when scanning subdirectories", async () => {
    const root = await tmpRoot("agent-kit-skip-dirs-");
    await mkdir(path.join(root, "node_modules", "some-pkg"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "some-pkg", "package.json"), "{}");
    await mkdir(path.join(root, ".dart_tool"));
    await writeFile(path.join(root, ".dart_tool", "pubspec.yaml"), "name: generated\n");
    const result = await detectStack(root);
    expect(result.language).toBe("unknown");
    expect(result.hasProjectFiles).toBe(false);
  });

  it("stays language unknown but flips hasProjectFiles for an unmapped marker (e.g. Gemfile)", async () => {
    const root = await tmpRoot("agent-kit-gemfile-subdir-");
    await mkdir(path.join(root, "api"));
    await writeFile(path.join(root, "api", "Gemfile"), "source 'https://rubygems.org'\n");
    const result = await detectStack(root);
    expect(result.language).toBe("unknown");
    expect(result.workspaces).toBe(true);
    expect(result.hasProjectFiles).toBe(true);
  });
});

describe("detectStack — operator stack override (defect 3)", () => {
  it("accepts a confirmed stack from .cursor/agent-kit.config.json, parity with purpose/git.provider", async () => {
    const root = await tmpRoot("agent-kit-stack-override-");
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "agent-kit.config.json"),
      JSON.stringify({
        stack: {
          language: "dart",
          framework: "flutter",
          testCommands: ["dart test", "flutter test"],
          validationCommands: ["dart analyze --fatal-infos"],
        },
      }),
    );
    // Even with node evidence present, the confirmed override wins (same
    // reconcile rule as readConfirmedPurpose / detectProvider).
    await writeFile(path.join(root, "package.json"), JSON.stringify({}));

    const result = await detectStack(root);
    expect(result.language).toBe("dart");
    expect(result.framework).toBe("flutter");
    expect(result.testCommands).toEqual(["dart test", "flutter test"]);
    expect(result.hasProjectFiles).toBe(true);
    expect(result.packageManagerEvidence).toEqual([
      { source: "configuration", value: ".cursor/agent-kit.config.json#stack.language" },
    ]);
  });

  it("round-trips packageManager and scripts through a scanner-written profile instead of dropping them", async () => {
    // Regression: createProfile (safe-fixes.ts) writes the FULL scan.stack
    // (including packageManager/scripts) back to .cursor/agent-kit.config.json
    // on every --refresh-profile / --fix-safe run. Once that write includes a
    // language + a command, readConfirmedStack must treat it as confirmed
    // (defect 3) WITHOUT silently dropping packageManager/scripts on the very
    // next scan — otherwise a pnpm repo loses `packageManager: "pnpm"` from
    // its own profile the first time doctor --refresh-profile runs twice.
    const root = await tmpRoot("agent-kit-stack-roundtrip-");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@9.0.0",
        scripts: { test: "vitest run", lint: "biome check ." },
      }),
    );
    const firstScan = await detectStack(root);
    expect(firstScan.packageManager).toBe("pnpm");
    expect(firstScan.scripts).toEqual({ test: "vitest run", lint: "biome check ." });

    // Simulate createProfile writing the scanned stack back to the profile.
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "agent-kit.config.json"),
      JSON.stringify({ stack: firstScan }),
    );

    const secondScan = await detectStack(root);
    expect(secondScan.language).toBe("node");
    expect(secondScan.packageManager).toBe("pnpm");
    expect(secondScan.scripts).toEqual({ test: "vitest run", lint: "biome check ." });
    expect(secondScan.packageManagerEvidence).toEqual(firstScan.packageManagerEvidence);
  });

  it("ignores a stack override with no commands (not a confirmed override)", async () => {
    const root = await tmpRoot("agent-kit-stack-override-empty-");
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "agent-kit.config.json"),
      JSON.stringify({ stack: { language: "dart" } }),
    );
    await writeFile(path.join(root, "package.json"), JSON.stringify({}));
    const result = await detectStack(root);
    expect(result.language).toBe("node");
  });

  it("ignores an unknown-language stack override", async () => {
    const root = await tmpRoot("agent-kit-stack-override-unknown-");
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "agent-kit.config.json"),
      JSON.stringify({ stack: { language: "unknown", testCommands: ["x"] } }),
    );
    const result = await detectStack(root);
    expect(result.language).toBe("unknown");
  });
});
