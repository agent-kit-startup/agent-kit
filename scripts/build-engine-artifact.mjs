#!/usr/bin/env node
/**
 * Build the platform-neutral engine artifact of the Agent Kit CLI for hosts that run it as
 * a managed engine (an IDE host). ADR 2026-10-19_colony-managed-engine-distribution, Decision 2.
 *
 * Output (default `dist/engine/`, gitignored):
 *   agent-kit-engine-<version>.tar.gz  flat tarball (no `package/` prefix):
 *       the npm package contents of packages/cli (the `npm pack` file list: dist/,
 *       dashboard/, LICENSE, NOTICE, README.md, package.json),
 *       node_modules/  the runtime dependency closure (dist/ is not bundled: tsup keeps
 *                      `dependencies` external), so `node dist/index.js` runs with nothing
 *                      installed,
 *       engine.json    the manifest printed by `agent-kit engine-info --json`.
 *   SHA256SUMS                         `<sha256>  agent-kit-engine-<version>.tar.gz`
 *
 * The tarball is written by this script (ustar + pax, sorted entries, fixed owner, mtime
 * from SOURCE_DATE_EPOCH or the HEAD commit), so two builds of one commit are identical.
 * After writing it, the script extracts it with the system `tar` into an empty folder and
 * runs `node dist/index.js --version` and `engine-info --json` there.
 *
 * Run after `pnpm build` (from the monorepo root):
 *   node scripts/build-engine-artifact.mjs [--out <dir>] [--no-verify]
 *
 * Node built-ins only. Signing is not done here: the signing key is operator-owned and the
 * tag workflow carries a placeholder step for it.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const cliDir = join(repoRoot, "packages", "cli");

export const ARTIFACT_PREFIX = "agent-kit-engine-";

export function artifactName(version) {
  return `${ARTIFACT_PREFIX}${version}.tar.gz`;
}

/** `npm pack --dry-run --json` output: an array (npm <= 11) or an object keyed by name (npm 12). */
export function parsePackJson(text) {
  const parsed = JSON.parse(text);
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (!entry || !Array.isArray(entry.files)) {
    throw new Error("npm pack --json: no file list in the output");
  }
  return { name: entry.name, version: entry.version, files: entry.files.map((f) => f.path) };
}

function packFileList(dir) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parsePackJson(out);
}

/** Find `<ancestor>/node_modules/<name>` from `fromDir` upward (Node's resolution walk). */
export function findPackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const cand = join(dir, "node_modules", ...name.split("/"));
    if (existsSync(join(cand, "package.json"))) return realpathSync(cand);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Runtime dependency closure of the package at `pkgDir` (`dependencies` and present
 * `optionalDependencies`, recursively), each resolved from its parent's real directory.
 * @returns {Map<string, {version: string, dir: string}>}
 */
export function dependencyClosure(pkgDir) {
  const found = new Map();
  const queue = [realpathSync(pkgDir)];
  while (queue.length) {
    const dir = queue.shift();
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const deps = [
      ...Object.keys(pkg.dependencies ?? {}).map((n) => [n, false]),
      ...Object.keys(pkg.optionalDependencies ?? {}).map((n) => [n, true]),
    ];
    for (const [name, optional] of deps) {
      const depDir = findPackageDir(name, dir);
      if (!depDir) {
        if (optional) continue;
        throw new Error(`dependency ${name} of ${pkg.name} is not installed (run pnpm install)`);
      }
      const version = JSON.parse(readFileSync(join(depDir, "package.json"), "utf8")).version;
      const seen = found.get(name);
      if (seen) {
        if (seen.version !== version) {
          throw new Error(
            `dependency ${name} resolves to ${seen.version} and ${version}; the flat engine node_modules cannot hold both`,
          );
        }
        continue;
      }
      found.set(name, { version, dir: depDir });
      queue.push(depDir);
    }
  }
  return found;
}

function copyPackage(src, dest) {
  cpSync(src, dest, {
    recursive: true,
    dereference: true,
    filter: (p) => !relative(src, p).split(sep).includes("node_modules"),
  });
}

/** All files and directories under `root`, as sorted POSIX relative paths. */
export function walk(root) {
  const out = [];
  const visit = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(a);
      if (st.isSymbolicLink()) throw new Error(`symlink in engine tree: ${r}`);
      if (st.isDirectory()) {
        out.push({ path: r, dir: true, mode: 0o755 });
        visit(a, r);
      } else if (st.isFile()) {
        out.push({ path: r, dir: false, mode: st.mode & 0o111 ? 0o755 : 0o644, abs: a });
      }
    }
  };
  visit(root, "");
  return out;
}

function octal(n, len) {
  return `${n.toString(8).padStart(len - 1, "0")}\0`;
}

function header(name, size, mode, mtime, type) {
  const b = Buffer.alloc(512);
  b.write(name, 0, 100, "utf8");
  b.write(octal(mode, 8), 100, "ascii");
  b.write(octal(0, 8), 108, "ascii");
  b.write(octal(0, 8), 116, "ascii");
  b.write(octal(size, 12), 124, "ascii");
  b.write(octal(mtime, 12), 136, "ascii");
  b.fill(" ", 148, 156);
  b.write(type, 156, 1, "ascii");
  b.write("ustar\0", 257, "ascii");
  b.write("00", 263, "ascii");
  b.write("root", 265, "ascii");
  b.write("root", 297, "ascii");
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return b;
}

function pad(buf) {
  const rem = buf.length % 512;
  return rem ? Buffer.concat([buf, Buffer.alloc(512 - rem)]) : buf;
}

/** One pax record: "<len> path=<value>\n", where <len> counts itself. */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len += 1;
  return `${len}${body}`;
}

/**
 * Deterministic tar (ustar, pax `path` records for names over 100 bytes) of `entries`
 * from walk(); gzip-compressed.
 */
export function tarGz(entries, mtime) {
  const parts = [];
  for (const e of entries) {
    const name = e.dir ? `${e.path}/` : e.path;
    const data = e.dir ? Buffer.alloc(0) : readFileSync(e.abs);
    let short = name;
    if (Buffer.byteLength(name) > 100) {
      const pax = Buffer.from(paxRecord("path", name), "utf8");
      parts.push(header("PaxHeader", pax.length, 0o644, mtime, "x"), pad(pax));
      short = name.slice(0, 99);
    }
    parts.push(header(short, data.length, e.mode, mtime, e.dir ? "5" : "0"));
    if (data.length) parts.push(pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sourceDateEpoch() {
  const env = process.env.SOURCE_DATE_EPOCH;
  if (env && /^\d+$/.test(env)) return Number(env);
  try {
    const ct = execFileSync("git", ["log", "-1", "--format=%ct"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^\d+$/.test(ct)) return Number(ct);
  } catch {
    // not a git checkout
  }
  return Math.floor(Date.now() / 1000);
}

function engineInfo(root) {
  const out = execFileSync(
    process.execPath,
    [join(root, "dist", "index.js"), "engine-info", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  return JSON.parse(out);
}

/** Every runtime dependency must import from the engine's dist/ with no other node_modules. */
function checkImports(root, names) {
  const script = names.map((n) => `await import(${JSON.stringify(n)});`).join("\n");
  execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: join(root, "dist"),
    stdio: ["ignore", "ignore", "pipe"],
  });
}

/** Extract the tarball with the system tar into an empty folder and run the engine there. */
export function verifyArtifact(tarball, expected) {
  const dir = mkdtempSync(join(tmpdir(), "ak-engine-verify-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", dir], { stdio: "inherit" });
    for (const rel of ["engine.json", expected.entry, expected.dashboardServe, "package.json"]) {
      if (!existsSync(join(dir, rel))) throw new Error(`engine artifact is missing ${rel}`);
    }
    const version = execFileSync(process.execPath, [join(dir, "dist", "index.js"), "--version"], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
    if (version !== expected.version) {
      throw new Error(
        `extracted engine --version printed "${version}", expected ${expected.version}`,
      );
    }
    const manifest = JSON.parse(readFileSync(join(dir, "engine.json"), "utf8"));
    const probed = engineInfo(dir);
    if (JSON.stringify(probed) !== JSON.stringify(manifest)) {
      throw new Error("engine.json differs from `engine-info --json` of the extracted engine");
    }
    return { version, manifest };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const out = { out: join(repoRoot, "dist", "engine"), verify: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) out.out = resolve(argv[++i]);
    else if (argv[i] === "--no-verify") out.verify = false;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const entry = join(cliDir, "dist", "index.js");
  if (!existsSync(entry) || !existsSync(join(cliDir, "dashboard", "serve.mjs"))) {
    throw new Error(
      "packages/cli/dist or packages/cli/dashboard is missing: run `pnpm build` first",
    );
  }
  const pack = packFileList(cliDir);
  const stage = mkdtempSync(join(tmpdir(), "ak-engine-stage-"));
  try {
    for (const rel of pack.files) {
      const dest = join(stage, ...rel.split(posix.sep));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(cliDir, ...rel.split(posix.sep)), dest);
    }
    const closure = dependencyClosure(cliDir);
    for (const [name, { dir }] of closure) {
      copyPackage(dir, join(stage, "node_modules", ...name.split("/")));
    }
    const cliPkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));
    checkImports(stage, Object.keys(cliPkg.dependencies ?? {}));
    const manifest = engineInfo(stage);
    if (
      manifest.version !== pack.version ||
      !manifest.driverProtocol ||
      !manifest.dashboardDataVersion
    ) {
      throw new Error(`engine-info --json is incomplete: ${JSON.stringify(manifest)}`);
    }
    writeFileSync(join(stage, "engine.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const gz = tarGz(walk(stage), sourceDateEpoch());
    mkdirSync(args.out, { recursive: true });
    const name = artifactName(manifest.version);
    const tarball = join(args.out, name);
    writeFileSync(tarball, gz);
    const sums = `${sha256(gz)}  ${name}\n`;
    writeFileSync(join(args.out, "SHA256SUMS"), sums);
    if (args.verify) verifyArtifact(tarball, manifest);
    const deps = [...closure].map(([n, d]) => `${n}@${d.version}`).join(", ");
    console.log(`build-engine-artifact: ${tarball} (${statSync(tarball).size} bytes)`);
    console.log(`  engine.json: ${JSON.stringify(manifest)}`);
    console.log(`  vendored node_modules: ${deps || "(none)"}`);
    console.log(`  SHA256SUMS: ${sums.trim()}`);
    if (args.verify)
      console.log(
        "  verified: extracted with tar, --version and engine-info ran with no other node_modules",
      );
    return { tarball, sums: join(args.out, "SHA256SUMS"), manifest };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  try {
    main();
  } catch (err) {
    console.error(`build-engine-artifact: FAIL — ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
