import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findOnPath } from "./find-on-path.js";

describe("findOnPath (replaces `which`)", () => {
  it.skipIf(process.platform === "win32")(
    "POSIX: first executable file on PATH; skips non-executables and directories",
    async () => {
      const a = await mkdtemp(path.join(os.tmpdir(), "agent-kit-path-a-"));
      const b = await mkdtemp(path.join(os.tmpdir(), "agent-kit-path-b-"));
      await writeFile(path.join(a, "tool"), "#!/bin/sh\n");
      await chmod(path.join(a, "tool"), 0o644);
      await mkdir(path.join(a, "dirtool"));
      await writeFile(path.join(b, "tool"), "#!/bin/sh\n");
      await chmod(path.join(b, "tool"), 0o755);
      const env = { PATH: [a, "", b].join(path.delimiter) };
      expect(await findOnPath("tool", { env })).toBe(path.join(b, "tool"));
      expect(await findOnPath("dirtool", { env })).toBe(null);
      expect(await findOnPath("absent", { env })).toBe(null);
      expect(await findOnPath("tool", { env: { PATH: "" } })).toBe(null);
      expect(await findOnPath(path.join(b, "tool"), { env: { PATH: "" } })).toBe(
        path.join(b, "tool"),
      );
    },
  );

  it("Windows: PATH `;`, PATHEXT suffixes, no extensionless sh shim", async () => {
    const seen: string[] = [];
    const present = new Set(["C:\\npm\\claude", "C:\\npm\\claude.CMD", "C:\\bin\\codex.EXE"]);
    const accessFn = async (file: string) => {
      seen.push(file);
      if (!present.has(file)) throw new Error("ENOENT");
    };
    const env = { Path: "C:\\bin;C:\\npm", PATHEXT: ".EXE;.CMD" };
    expect(await findOnPath("claude", { env, platform: "win32", accessFn })).toBe(
      "C:\\npm\\claude.CMD",
    );
    expect(seen).not.toContain("C:\\npm\\claude");
    expect(await findOnPath("codex", { env, platform: "win32", accessFn })).toBe(
      "C:\\bin\\codex.EXE",
    );
    expect(await findOnPath("codex.EXE", { env, platform: "win32", accessFn })).toBe(
      "C:\\bin\\codex.EXE",
    );
  });
});
