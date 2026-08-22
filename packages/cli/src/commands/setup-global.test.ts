import { describe, expect, it, vi } from "vitest";
import type { EnvironmentReport } from "../readiness/env-checks.js";
import {
  type NpmInstallOutcome,
  type SetupGlobalFsImpl,
  type SetupGlobalRunResult,
  planSetupGlobalSteps,
  runSetupGlobal,
  upsertNpmrcPrefix,
} from "./setup-global.js";

function makeEnv(overrides: Partial<EnvironmentReport> = {}): EnvironmentReport {
  return {
    binOnPath: false,
    npmPrefixWritable: false,
    npmPrefix: {
      prefix: "/usr/local",
      writable: false,
      source: "heuristic",
      reason: "root-owned prefix (/usr/local); the classic fresh-install PATH/EACCES blocker",
    },
    nodeVersionOk: true,
    nodeVersion: "v22.4.0",
    shell: "zsh",
    shellProfile: "/home/tester/.zshrc",
    ...overrides,
  };
}

/** In-memory fake fs: starts from a fixed set of files, records every mutation call. */
function makeFakeFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const calls = { mkdir: [] as string[], writeFile: [] as string[], appendFile: [] as string[] };
  const fs: SetupGlobalFsImpl = {
    mkdir: async (dir) => {
      calls.mkdir.push(dir);
    },
    readFile: async (filePath) => {
      const content = files.get(filePath);
      if (content === undefined) {
        const err = new Error(`ENOENT: ${filePath}`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return content;
    },
    writeFile: async (filePath, content) => {
      calls.writeFile.push(filePath);
      files.set(filePath, content);
    },
    appendFile: async (filePath, content) => {
      calls.appendFile.push(filePath);
      files.set(filePath, (files.get(filePath) ?? "") + content);
    },
  };
  return { fs, files, calls };
}

function collectingPrint() {
  const lines: string[] = [];
  return { print: (line: string) => lines.push(line), lines };
}

describe("upsertNpmrcPrefix", () => {
  it("appends a prefix line to empty content", () => {
    expect(upsertNpmrcPrefix("", "~/.npm-global")).toBe("prefix = ~/.npm-global\n");
  });

  it("appends a prefix line preserving existing unrelated content", () => {
    expect(upsertNpmrcPrefix("registry=https://registry.npmjs.org/\n", "~/.npm-global")).toBe(
      "registry=https://registry.npmjs.org/\nprefix = ~/.npm-global\n",
    );
  });

  it("replaces an existing prefix line in place", () => {
    const before = "save-exact=true\nprefix = /usr/local\nregistry=https://registry.npmjs.org/\n";
    expect(upsertNpmrcPrefix(before, "~/.npm-global")).toBe(
      "save-exact=true\nprefix = ~/.npm-global\nregistry=https://registry.npmjs.org/\n",
    );
  });
});

describe("planSetupGlobalSteps", () => {
  it("resolves concrete paths for the 4 steps", () => {
    const plan = planSetupGlobalSteps(makeEnv(), { homeDir: "/home/tester" });
    expect(plan.npmGlobalDir).toBe("/home/tester/.npm-global");
    expect(plan.npmGlobalBin).toBe("/home/tester/.npm-global/bin");
    expect(plan.npmrcPath).toBe("/home/tester/.npmrc");
    expect(plan.pathExportLine).toBe('export PATH="/home/tester/.npm-global/bin:$PATH"');
    expect(plan.steps.map((s) => s.id)).toEqual([
      "set-prefix",
      "append-path",
      "npm-install",
      "verify",
    ]);
    expect(plan.shellSupported).toBe(true);
  });

  it("marks the shell unsupported when no zsh/bash profile was detected", () => {
    const plan = planSetupGlobalSteps(makeEnv({ shell: "fish", shellProfile: null }), {
      homeDir: "/home/tester",
    });
    expect(plan.shellSupported).toBe(false);
    const appendStep = plan.steps.find((s) => s.id === "append-path");
    expect(appendStep?.detail.join(" ")).toContain("could not be auto-detected");
    expect(appendStep?.detail.join(" ")).toContain(plan.pathExportLine);
  });
});

describe("runSetupGlobal: already-writable short-circuit", () => {
  it("exits 0 with no prompts and no fs/npm calls when the prefix is already writable", async () => {
    const { print, lines } = collectingPrint();
    const { fs, calls } = makeFakeFs();
    const confirmImpl = vi.fn();
    const npmInstallImpl = vi.fn();

    const result = await runSetupGlobal({
      print,
      fsImpl: fs,
      confirmImpl,
      npmInstallImpl,
      assessEnvironmentImpl: async () => makeEnv({ npmPrefixWritable: true }),
    });

    expect(result.outcome).toBe("already-ok");
    expect(result.exitCode).toBe(0);
    expect(result.mutated).toBe(false);
    expect(confirmImpl).not.toHaveBeenCalled();
    expect(npmInstallImpl).not.toHaveBeenCalled();
    expect(calls.mkdir).toHaveLength(0);
    expect(calls.writeFile).toHaveLength(0);
    expect(lines.join("\n")).toMatch(/nothing to fix/i);
  });
});

describe("runSetupGlobal: --dry-run", () => {
  it("prints the resolved plan and mutates nothing", async () => {
    const { print, lines } = collectingPrint();
    const { fs, calls } = makeFakeFs();
    const confirmImpl = vi.fn();
    const npmInstallImpl = vi.fn();

    const result = await runSetupGlobal({
      dryRun: true,
      print,
      fsImpl: fs,
      confirmImpl,
      npmInstallImpl,
      homeDir: "/home/tester",
      assessEnvironmentImpl: async () => makeEnv(),
    });

    expect(result.outcome).toBe("dry-run");
    expect(result.exitCode).toBe(0);
    expect(result.mutated).toBe(false);
    expect(confirmImpl).not.toHaveBeenCalled();
    expect(npmInstallImpl).not.toHaveBeenCalled();
    expect(calls.mkdir).toHaveLength(0);
    expect(calls.writeFile).toHaveLength(0);
    expect(calls.appendFile).toHaveLength(0);
    const text = lines.join("\n");
    expect(text).toContain("/home/tester/.npm-global");
    expect(text).toContain("npm i -g @dadado/agent-kit-cli");
  });
});

describe("runSetupGlobal: non-interactive", () => {
  it("prints manual steps, exits 0, and mutates nothing", async () => {
    const { print, lines } = collectingPrint();
    const { fs, calls } = makeFakeFs();
    const confirmImpl = vi.fn();
    const npmInstallImpl = vi.fn();

    const result = await runSetupGlobal({
      nonInteractive: true,
      print,
      fsImpl: fs,
      confirmImpl,
      npmInstallImpl,
      homeDir: "/home/tester",
      assessEnvironmentImpl: async () => makeEnv(),
    });

    expect(result.outcome).toBe("manual-instructions");
    expect(result.exitCode).toBe(0);
    expect(result.mutated).toBe(false);
    expect(confirmImpl).not.toHaveBeenCalled();
    expect(npmInstallImpl).not.toHaveBeenCalled();
    expect(calls.mkdir).toHaveLength(0);
    expect(calls.writeFile).toHaveLength(0);
    const text = lines.join("\n");
    expect(text).toContain("mkdir -p /home/tester/.npm-global");
    expect(text).toContain('npm config set prefix "~/.npm-global"');
    expect(text).toContain("npm i -g @dadado/agent-kit-cli");
  });
});

describe("runSetupGlobal: interactive full run", () => {
  it("confirms each step, mutates prefix + profile + installs, and reports success", async () => {
    const { print } = collectingPrint();
    const { fs, calls, files } = makeFakeFs();
    const confirmImpl = vi.fn(async () => true);
    const npmInstallImpl = vi.fn(async (): Promise<NpmInstallOutcome> => ({ ok: true }));

    const result = await runSetupGlobal({
      nonInteractive: false,
      print,
      fsImpl: fs,
      confirmImpl,
      npmInstallImpl,
      homeDir: "/home/tester",
      assessEnvironmentImpl: async () => makeEnv(),
    });

    expect(result.outcome).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.mutated).toBe(true);
    expect(confirmImpl.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.mkdir).toContain("/home/tester/.npm-global");
    expect(files.get("/home/tester/.npmrc")).toContain("prefix = ~/.npm-global");
    expect(calls.appendFile).toContain("/home/tester/.zshrc");
    expect(files.get("/home/tester/.zshrc")).toContain("# agent-kit setup-global");
    expect(npmInstallImpl).toHaveBeenCalledWith("@dadado/agent-kit-cli");
  });

  it("stops without mutating further steps when a confirm is declined", async () => {
    const { print } = collectingPrint();
    const { fs, calls } = makeFakeFs();
    const confirmImpl = vi.fn(async () => false);
    const npmInstallImpl = vi.fn();

    const result = await runSetupGlobal({
      nonInteractive: false,
      print,
      fsImpl: fs,
      confirmImpl,
      npmInstallImpl,
      homeDir: "/home/tester",
      assessEnvironmentImpl: async () => makeEnv(),
    });

    expect(result.outcome).toBe("cancelled");
    expect(result.exitCode).toBe(1);
    expect(result.mutated).toBe(false);
    expect(calls.mkdir).toHaveLength(0);
    expect(npmInstallImpl).not.toHaveBeenCalled();
  });
});

describe("runSetupGlobal: idempotent marker", () => {
  it("skips the PATH append (no re-confirm, no duplicate) when the marker is already present", async () => {
    const { print, lines } = collectingPrint();
    const { fs, calls } = makeFakeFs({
      "/home/tester/.zshrc":
        '# agent-kit setup-global\nexport PATH="/home/tester/.npm-global/bin:$PATH"\n',
    });
    const confirmImpl = vi.fn(async () => true);
    const npmInstallImpl = vi.fn(async (): Promise<NpmInstallOutcome> => ({ ok: true }));

    const result = await runSetupGlobal({
      nonInteractive: false,
      print,
      fsImpl: fs,
      confirmImpl,
      npmInstallImpl,
      homeDir: "/home/tester",
      assessEnvironmentImpl: async () => makeEnv(),
    });

    expect(result.outcome).toBe("completed");
    expect(calls.appendFile).toHaveLength(0);
    expect(lines.join("\n")).toMatch(/already present.*skipping/i);
    // Only set-prefix, npm-install, and verify prompt when the append step is skipped.
    expect(confirmImpl.mock.calls.length).toBe(3);
  });
});

describe("runSetupGlobal: unsupported shell", () => {
  it("prints manual PATH instructions for that step only, without failing the whole run", async () => {
    const { print, lines } = collectingPrint();
    const { fs, calls } = makeFakeFs();
    const confirmImpl = vi.fn(async () => true);
    const npmInstallImpl = vi.fn(async (): Promise<NpmInstallOutcome> => ({ ok: true }));

    const result: SetupGlobalRunResult = await runSetupGlobal({
      nonInteractive: false,
      print,
      fsImpl: fs,
      confirmImpl,
      npmInstallImpl,
      homeDir: "/home/tester",
      assessEnvironmentImpl: async () => makeEnv({ shell: "fish", shellProfile: null }),
    });

    expect(result.outcome).toBe("completed");
    expect(calls.appendFile).toHaveLength(0);
    expect(lines.join("\n")).toMatch(/shell not auto-detected/i);
    expect(npmInstallImpl).toHaveBeenCalled();
    // set-prefix, npm-install, verify — append-path has nothing to confirm.
    expect(confirmImpl.mock.calls.length).toBe(3);
  });
});
