import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectWorkspaceParent,
  workspaceParentAdvisoryLines,
  workspaceParentNextStep,
} from "./workspace-parent.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "agent-kit-ws-parent-"));
}

async function makeKit(dir: string): Promise<void> {
  await mkdir(path.join(dir, ".cursor"), { recursive: true });
  await writeFile(path.join(dir, ".cursor", "agent-kit.json"), '{"version":"0.0.0"}\n');
}

describe("detectWorkspaceParent", () => {
  it("returns sorted kit children when cwd has no manifest", async () => {
    const root = await tmp();
    await makeKit(path.join(root, "zeta"));
    await makeKit(path.join(root, "alpha"));
    await mkdir(path.join(root, "plain"));
    expect(await detectWorkspaceParent(root)).toEqual({ kitProjects: ["alpha", "zeta"] });
  });

  it("returns null for a real kit root even when a child is also a kit", async () => {
    const root = await tmp();
    await makeKit(root);
    await makeKit(path.join(root, "child"));
    expect(await detectWorkspaceParent(root)).toBeNull();
  });

  it("returns null when no child is a kit project", async () => {
    const root = await tmp();
    await mkdir(path.join(root, "a"));
    await mkdir(path.join(root, "b", ".cursor"), { recursive: true });
    expect(await detectWorkspaceParent(root)).toBeNull();
  });

  it("ignores dot-directories, node_modules, files and symlinked dirs", async () => {
    const root = await tmp();
    await makeKit(path.join(root, ".hidden"));
    await makeKit(path.join(root, "node_modules"));
    const outside = await tmp();
    await makeKit(outside);
    await symlink(outside, path.join(root, "linked"), "dir");
    await writeFile(path.join(root, "file.txt"), "x");
    expect(await detectWorkspaceParent(root)).toBeNull();
    await makeKit(path.join(root, "real"));
    expect(await detectWorkspaceParent(root)).toEqual({ kitProjects: ["real"] });
  });

  it("is one level only", async () => {
    const root = await tmp();
    await makeKit(path.join(root, "group", "deep"));
    expect(await detectWorkspaceParent(root)).toBeNull();
  });

  it("caps reported kit projects at 10", async () => {
    const root = await tmp();
    for (let i = 0; i < 12; i++) await makeKit(path.join(root, `p${String(i).padStart(2, "0")}`));
    const found = await detectWorkspaceParent(root);
    expect(found?.kitProjects).toHaveLength(10);
    expect(found?.kitProjects[0]).toBe("p00");
  });

  it("never throws on a missing or unreadable directory", async () => {
    const root = await tmp();
    expect(await detectWorkspaceParent(path.join(root, "missing"))).toBeNull();
    const locked = path.join(root, "locked");
    await mkdir(locked);
    await chmod(locked, 0o000);
    try {
      expect(await detectWorkspaceParent(locked)).toBeNull();
    } finally {
      await chmod(locked, 0o755);
    }
  });
});

describe("workspace parent advisory text", () => {
  it("names the children and gives a cd next step without install guidance", () => {
    const lines = workspaceParentAdvisoryLines("/ws", { kitProjects: ["a", "b c"] }, "doctor");
    const text = lines.join("\n");
    expect(text).toContain("No Agent Kit here");
    expect(text).toContain("  - a");
    expect(text).toContain("  - b c");
    expect(lines.at(-1)).toBe("Next: cd a && agent-kit doctor");
    expect(text).not.toMatch(/install/i);
  });

  it("shell-quotes child names with spaces", () => {
    expect(workspaceParentNextStep({ kitProjects: ["my app"] }, "status")).toBe(
      "cd 'my app' && agent-kit status",
    );
  });
});
