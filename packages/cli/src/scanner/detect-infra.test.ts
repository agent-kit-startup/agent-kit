import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectInfra } from "./detect-infra.js";

async function tmpRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

// dogfood/cursor_stack_detection_no_dart_flutter_subdir_override_2026_09_15.md, defect 5:
// CI `run:` steps as validation evidence for quality.validation.

describe("detectInfra — CI run: step extraction (defect 5)", () => {
  it("extracts single-line run: commands from a GitHub Actions workflow", async () => {
    const root = await tmpRoot("agent-kit-ci-inline-");
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(root, ".github", "workflows", "core.yml"),
      [
        "name: core",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: dart pub get",
        "      - run: dart format --output=none --set-exit-if-changed .",
        "      - run: dart analyze --fatal-infos",
        "      - run: dart test",
        "",
      ].join("\n"),
    );
    const infra = await detectInfra(root);
    expect(infra.ci).toBe("github-actions");
    expect(infra.ciRunCommands).toEqual(
      expect.arrayContaining([
        "dart pub get",
        "dart format --output=none --set-exit-if-changed .",
        "dart analyze --fatal-infos",
        "dart test",
      ]),
    );
  });

  it("extracts block-scalar (run: |) commands", async () => {
    const root = await tmpRoot("agent-kit-ci-block-");
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(root, ".github", "workflows", "ci.yml"),
      [
        "on: push",
        "jobs:",
        "  build:",
        "    steps:",
        "      - run: |",
        "          npm ci",
        "          npm test",
        "",
      ].join("\n"),
    );
    const infra = await detectInfra(root);
    expect(infra.ciRunCommands).toEqual(expect.arrayContaining(["npm ci", "npm test"]));
  });

  it("returns no run commands when there is no .github/workflows directory", async () => {
    const root = await tmpRoot("agent-kit-ci-none-");
    const infra = await detectInfra(root);
    expect(infra.ci).toBe("none");
    expect(infra.ciRunCommands).toEqual([]);
  });

  it("does not read run: steps from non-GitHub-Actions CI files", async () => {
    const root = await tmpRoot("agent-kit-ci-gitlab-");
    await writeFile(path.join(root, ".gitlab-ci.yml"), "test:\n  script: echo hi\n");
    const infra = await detectInfra(root);
    expect(infra.ci).toBe("gitlab-ci");
    expect(infra.ciRunCommands).toEqual([]);
  });
});
