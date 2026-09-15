import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractDistIndexFromBinScript, readBinVersion } from "./env-checks.js";

const PNPM_SHIM = `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")
exec node  "$basedir/../../Documents/Git/agent-kit/packages/cli/dist/index.js" "$@"
`;

describe("extractDistIndexFromBinScript", () => {
  it("reads the factory pnpm shim target", () => {
    const hits = extractDistIndexFromBinScript(PNPM_SHIM);
    expect(hits.some((item) => item.includes("packages/cli/dist/index.js"))).toBe(true);
  });

  it("keeps the @scope segment in an npm global shim", () => {
    const hits = extractDistIndexFromBinScript(
      'exec node "$basedir/../lib/node_modules/@dadado/agent-kit-cli/dist/index.js" "$@"',
    );
    expect(hits.some((item) => item.includes("@dadado/agent-kit-cli/dist/index.js"))).toBe(true);
  });
});

describe("readBinVersion", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves version from a shim that points at dist/index.js", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-binver-"));
    const pkgDir = path.join(tmpDir, "packages", "cli");
    await mkdir(path.join(pkgDir, "dist"), { recursive: true });
    await writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ version: "5.8.0" }));
    await writeFile(path.join(pkgDir, "dist", "index.js"), "export {}\n");
    const binDir = path.join(tmpDir, "pnpm");
    await mkdir(binDir, { recursive: true });
    const binPath = path.join(binDir, "agent-kit");
    const rel = path.relative(binDir, path.join(pkgDir, "dist", "index.js"));
    await writeFile(binPath, `#!/bin/sh\nexec node "$basedir/${rel}" "$@"\n`);
    await chmod(binPath, 0o755);
    expect(await readBinVersion(binPath)).toBe("5.8.0");
  });
});
