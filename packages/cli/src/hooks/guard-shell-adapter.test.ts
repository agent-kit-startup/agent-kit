import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../../..");

describe(".cursor/hooks/agent/guard-shell.sh", () => {
  it("fails open with an agent_message when the CLI cannot be resolved", async () => {
    // Isolated tree: no node_modules/.bin/agent-kit and no packages/cli/dist to walk up to.
    const root = await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-"));
    const hookDir = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(hookDir, { recursive: true });
    for (const name of ["guard-shell.sh", "resolve-agent-kit.sh"]) {
      await copyFile(path.join(repoRoot, ".cursor/hooks/agent", name), path.join(hookDir, name));
    }

    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", HOME: root };
    const probe = spawnSync("sh", ["-c", "command -v agent-kit"], { env, encoding: "utf8" });
    expect(probe.status).not.toBe(0); // precondition: CLI not on the restricted PATH

    const result = spawnSync("sh", [path.join(hookDir, "guard-shell.sh")], {
      cwd: root,
      env,
      input: '{"command":"ls"}',
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      permission: "allow",
      agent_message: "agent-kit guard inactive: CLI unresolved",
    });
  });

  it("ignores an exported AGENT_KIT_ROOT (only the Claude hook's private root is honored)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-envroot-"));
    const hookDir = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(hookDir, { recursive: true });
    for (const name of ["guard-shell.sh", "resolve-agent-kit.sh"]) {
      await copyFile(path.join(repoRoot, ".cursor/hooks/agent", name), path.join(hookDir, name));
    }
    // A different tree with a resolvable CLI that a stray AGENT_KIT_ROOT would point at.
    const other = await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-other-"));
    const otherBin = path.join(other, "node_modules", ".bin");
    await mkdir(otherBin, { recursive: true });
    await writeFile(
      path.join(otherBin, "agent-kit"),
      '#!/bin/sh\nprintf \'{"permission":"deny","who":"other"}\'\n',
      "utf8",
    );
    await chmod(path.join(otherBin, "agent-kit"), 0o755);

    const result = spawnSync("sh", [path.join(hookDir, "guard-shell.sh")], {
      cwd: root,
      env: { PATH: "/usr/bin:/bin", HOME: root, AGENT_KIT_ROOT: other },
      input: '{"command":"ls"}',
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      permission: "allow",
      agent_message: "agent-kit guard inactive: CLI unresolved",
    });
  });

  it("runs a packages/cli/dist CLI from a repo path that contains spaces", async () => {
    const root = path.join(await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-")), "my repo");
    const hookDir = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(hookDir, { recursive: true });
    for (const name of ["guard-shell.sh", "resolve-agent-kit.sh"]) {
      await copyFile(path.join(repoRoot, ".cursor/hooks/agent", name), path.join(hookDir, name));
    }
    const dist = path.join(root, "packages", "cli", "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(
      path.join(dist, "index.js"),
      'process.stdout.write(JSON.stringify({ permission: "deny", argv: process.argv.slice(2) }));\n',
      "utf8",
    );

    const env: NodeJS.ProcessEnv = {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: root,
    };
    const probe = spawnSync("sh", ["-c", "command -v agent-kit"], { env, encoding: "utf8" });
    expect(probe.status).not.toBe(0); // precondition: resolution falls through to packages/cli/dist

    const result = spawnSync("sh", [path.join(hookDir, "guard-shell.sh")], {
      cwd: root,
      env,
      input: '{"command":"ls"}',
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      permission: "deny",
      argv: ["guard", "shell", "--json"],
    });
  });

  it("prefers the project's node_modules/.bin CLI over a global one on PATH", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-local-"));
    const hookDir = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(hookDir, { recursive: true });
    for (const name of ["guard-shell.sh", "resolve-agent-kit.sh"]) {
      await copyFile(path.join(repoRoot, ".cursor/hooks/agent", name), path.join(hookDir, name));
    }
    const stub = async (dir: string, who: string) => {
      await mkdir(dir, { recursive: true });
      const bin = path.join(dir, "agent-kit");
      await writeFile(bin, `#!/bin/sh\nprintf '{"permission":"allow","who":"${who}"}'\n`, "utf8");
      await chmod(bin, 0o755);
    };
    const globalBin = path.join(root, "global-bin");
    await stub(globalBin, "global");
    await stub(path.join(root, "node_modules", ".bin"), "local");

    const result = spawnSync("sh", [path.join(hookDir, "guard-shell.sh")], {
      cwd: root,
      env: { PATH: `${globalBin}:/usr/bin:/bin`, HOME: root },
      input: '{"command":"ls"}',
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ permission: "allow", who: "local" });
  });

  it("still runs the CLI when a preserved older resolver has no run_agent_kit", async () => {
    // Resolver as shipped at b906fda8: sets AGENT_KIT_RESOLVED only, no run_agent_kit.
    const oldResolver = [
      "#!/usr/bin/env sh",
      "resolve_agent_kit() {",
      '  if [ -n "${AGENT_KIT_HOOK_BIN:-}" ] && [ -x "$AGENT_KIT_HOOK_BIN" ]; then',
      '    AGENT_KIT_RESOLVED="$AGENT_KIT_HOOK_BIN"',
      "    return 0",
      "  fi",
      "  if command -v agent-kit >/dev/null 2>&1; then",
      '    AGENT_KIT_RESOLVED="agent-kit"',
      "    return 0",
      "  fi",
      '  _script_dir=$(CDPATH= cd -- "$(dirname "$0")" 2>/dev/null && pwd)',
      '  _root=$(CDPATH= cd -- "$_script_dir/../../.." 2>/dev/null && pwd)',
      '  if [ -n "$_root" ] && [ -x "$_root/node_modules/.bin/agent-kit" ]; then',
      '    AGENT_KIT_RESOLVED="$_root/node_modules/.bin/agent-kit"',
      "    return 0",
      "  fi",
      '  if [ -n "$_root" ] && [ -f "$_root/packages/cli/dist/index.js" ]; then',
      '    AGENT_KIT_RESOLVED="node $_root/packages/cli/dist/index.js"',
      "    return 0",
      "  fi",
      "  return 1",
      "}",
      "",
    ].join("\n");
    const root = await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-old-"));
    const hookDir = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(hookDir, { recursive: true });
    await copyFile(
      path.join(repoRoot, ".cursor/hooks/agent/guard-shell.sh"),
      path.join(hookDir, "guard-shell.sh"),
    );
    await writeFile(path.join(hookDir, "resolve-agent-kit.sh"), oldResolver, "utf8");
    const globalBin = path.join(root, "global-bin");
    await mkdir(globalBin, { recursive: true });
    const bin = path.join(globalBin, "agent-kit");
    await writeFile(bin, `#!/bin/sh\nprintf '{"permission":"allow","argv":"%s"}' "$*"\n`, "utf8");
    await chmod(bin, 0o755);

    const result = spawnSync("sh", [path.join(hookDir, "guard-shell.sh")], {
      cwd: root,
      env: { PATH: `${globalBin}:/usr/bin:/bin`, HOME: root },
      input: '{"command":"ls"}',
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      permission: "allow",
      argv: "guard shell --json",
    });
  });

  it("fails open with a message when the resolved CLI is a node script and node is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-nonode-"));
    const hookDir = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(hookDir, { recursive: true });
    for (const name of ["guard-shell.sh", "resolve-agent-kit.sh"]) {
      await copyFile(path.join(repoRoot, ".cursor/hooks/agent", name), path.join(hookDir, name));
    }
    await mkdir(path.join(root, "packages", "cli", "dist"), { recursive: true });
    await writeFile(path.join(root, "packages", "cli", "dist", "index.js"), "process.exit(0);\n");
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", HOME: root };
    const probe = spawnSync("sh", ["-c", "command -v node || command -v agent-kit"], { env });
    expect(probe.status).not.toBe(0); // precondition: neither node nor a global CLI on PATH

    const result = spawnSync("sh", [path.join(hookDir, "guard-shell.sh")], {
      cwd: root,
      env,
      input: '{"command":"ls"}',
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      permission: "allow",
      agent_message: "agent-kit guard inactive: node not found for the resolved CLI",
    });
  });

  it("fails open when a node_modules/.bin node shim resolves but node is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-shim-"));
    const hookDir = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(hookDir, { recursive: true });
    for (const name of ["guard-shell.sh", "resolve-agent-kit.sh"]) {
      await copyFile(path.join(repoRoot, ".cursor/hooks/agent", name), path.join(hookDir, name));
    }
    const bin = path.join(root, "node_modules", ".bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "agent-kit"), "#!/usr/bin/env node\nprocess.exit(0);\n");
    await chmod(path.join(bin, "agent-kit"), 0o755);
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", HOME: root };
    expect(spawnSync("sh", ["-c", "command -v node"], { env }).status).not.toBe(0);

    const result = spawnSync("sh", [path.join(hookDir, "guard-shell.sh")], {
      cwd: root,
      env,
      input: '{"command":"ls"}',
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      permission: "allow",
      agent_message: "agent-kit guard inactive: node not found for the resolved CLI",
    });
  });

  it("runs a shim with an absolute node interpreter even when node is not on PATH", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-abs-"));
    const hookDir = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(hookDir, { recursive: true });
    for (const name of ["guard-shell.sh", "resolve-agent-kit.sh"]) {
      await copyFile(path.join(repoRoot, ".cursor/hooks/agent", name), path.join(hookDir, name));
    }
    const bin = path.join(root, "node_modules", ".bin");
    await mkdir(bin, { recursive: true });
    await writeFile(
      path.join(bin, "agent-kit"),
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ permission: "deny", via: "abs" }));\n`,
    );
    await chmod(path.join(bin, "agent-kit"), 0o755);
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", HOME: root };
    expect(spawnSync("sh", ["-c", "command -v node"], { env }).status).not.toBe(0);

    const result = spawnSync("sh", [path.join(hookDir, "guard-shell.sh")], {
      cwd: root,
      env,
      input: '{"command":"ls"}',
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ permission: "deny", via: "abs" });
  });

  it("fails open for a pnpm-style sh shim that runs node from PATH when node is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-pnpm-"));
    const hookDir = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(hookDir, { recursive: true });
    for (const name of ["guard-shell.sh", "resolve-agent-kit.sh"]) {
      await copyFile(path.join(repoRoot, ".cursor/hooks/agent", name), path.join(hookDir, name));
    }
    const bin = path.join(root, "node_modules", ".bin");
    await mkdir(bin, { recursive: true });
    await writeFile(
      path.join(bin, "agent-kit"),
      '#!/bin/sh\nbasedir=$(dirname "$0")\nexec node  "$basedir/../cli/index.js" "$@"\n',
    );
    await chmod(path.join(bin, "agent-kit"), 0o755);
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", HOME: root };

    const result = spawnSync("sh", [path.join(hookDir, "guard-shell.sh")], {
      cwd: root,
      env,
      input: '{"command":"ls"}',
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      permission: "allow",
      agent_message: "agent-kit guard inactive: node not found for the resolved CLI",
    });
  });

  it("runs a pnpm-style shim through its sibling node when node is not on PATH", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-kit-guard-shell-basedir-"));
    const hookDir = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(hookDir, { recursive: true });
    for (const name of ["guard-shell.sh", "resolve-agent-kit.sh"]) {
      await copyFile(path.join(repoRoot, ".cursor/hooks/agent", name), path.join(hookDir, name));
    }
    const bin = path.join(root, "node_modules", ".bin");
    await mkdir(bin, { recursive: true });
    await writeFile(
      path.join(bin, "agent-kit"),
      [
        "#!/bin/sh",
        'basedir=$(dirname "$0")',
        'if [ -x "$basedir/node" ]; then',
        '  exec "$basedir/node" "$basedir/../cli/index.js" "$@"',
        "else",
        '  exec node  "$basedir/../cli/index.js" "$@"',
        "fi",
        "",
      ].join("\n"),
    );
    await chmod(path.join(bin, "agent-kit"), 0o755);
    await writeFile(
      path.join(bin, "node"),
      '#!/bin/sh\nprintf \'{"permission":"deny","via":"basedir"}\'\n',
    );
    await chmod(path.join(bin, "node"), 0o755);

    const result = spawnSync("sh", [path.join(hookDir, "guard-shell.sh")], {
      cwd: root,
      env: { PATH: "/usr/bin:/bin", HOME: root },
      input: '{"command":"ls"}',
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ permission: "deny", via: "basedir" });
  });
});
