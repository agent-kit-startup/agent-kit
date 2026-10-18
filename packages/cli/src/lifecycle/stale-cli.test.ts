import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectStaleCli, formatRerunFlags, formatStaleCliRefusal } from "./stale-cli.js";

async function makeRegistry(version: string | null): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ak-stale-cli-"));
  await mkdir(path.join(root, "packages", "cli"), { recursive: true });
  await writeFile(
    path.join(root, "packages", "cli", "package.json"),
    JSON.stringify(version === null ? {} : { version }),
    "utf8",
  );
  return root;
}

describe("detectStaleCli", () => {
  it("flags a registry ahead of the CLI", async () => {
    const root = await makeRegistry("6.1.1");
    expect(await detectStaleCli(root, { warn: () => {}, cliVersion: "6.1.0" })).toEqual({
      cliVersion: "6.1.0",
      registryVersion: "6.1.1",
    });
  });

  it("passes an equal or older registry", async () => {
    const root = await makeRegistry("6.1.0");
    expect(await detectStaleCli(root, { warn: () => {}, cliVersion: "6.1.0" })).toBeNull();
    expect(await detectStaleCli(root, { warn: () => {}, cliVersion: "6.2.0" })).toBeNull();
  });

  it("warns and passes when the registry has no version", async () => {
    const root = await makeRegistry(null);
    const warnings: string[] = [];
    const result = await detectStaleCli(root, {
      warn: (m) => warnings.push(m),
      cliVersion: "6.1.0",
    });
    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});

describe("formatRerunFlags", () => {
  it("keeps passed flags in order and drops defaults", () => {
    expect(
      formatRerunFlags(
        {
          claude: true,
          yes: true,
          "force-root": false,
          cwd: "/here",
          ref: "main",
          url: "",
          "allow-stale-cli": true,
        },
        ["claude", "yes", "force-root", "cwd", "url", "ref"],
        "/here",
      ),
    ).toBe("--claude -y --ref main");
  });

  it("keeps a non-default cwd and quotes it when needed", () => {
    expect(formatRerunFlags({ cwd: "/my repo/it's" }, ["cwd"], "/elsewhere")).toBe(
      `--cwd '/my repo/it'\\''s'`,
    );
  });
});

describe("formatStaleCliRefusal", () => {
  it("names the pinned spec and the command with its flags", () => {
    const { error, recovery } = formatStaleCliRefusal({
      command: "install",
      stale: { cliVersion: "6.1.0", registryVersion: "6.1.1" },
      rerun: "--claude -y",
    });
    expect(error).toContain("v6.1.0");
    expect(recovery).toContain("npm i -g @dadado/agent-kit-cli@6.1.1");
    expect(recovery).toContain("  agent-kit install --claude -y");
    expect(recovery).toContain("npx -y @dadado/agent-kit-cli@6.1.1 install --claude -y");
  });
});
