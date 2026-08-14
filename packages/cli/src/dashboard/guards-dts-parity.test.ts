import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const mjsPath = join(repoRoot, "dashboard/lib/guards.mjs");
const dtsPath = join(repoRoot, "dashboard/lib/guards.d.mts");

function exportNames(source: string, kind: "function" | "const"): string[] {
  const re =
    kind === "function"
      ? /^export function ([A-Za-z_$][\w$]*)/gm
      : /^export const ([A-Za-z_$][\w$]*)/gm;
  const names: string[] = [];
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

function allExportNames(source: string): string[] {
  return [...new Set([...exportNames(source, "function"), ...exportNames(source, "const")])];
}

describe("guards.d.mts export parity", () => {
  const mjs = readFileSync(mjsPath, "utf8");
  const dts = readFileSync(dtsPath, "utf8");
  const mjsFunctions = exportNames(mjs, "function");
  const mjsConsts = exportNames(mjs, "const");
  const dtsExports = allExportNames(dts);
  const mjsExports = allExportNames(mjs);
  const dtsSet = new Set(dtsExports);
  const mjsSet = new Set(mjsExports);

  it("declares every export function from guards.mjs", () => {
    const missing = mjsFunctions.filter((name) => !dtsSet.has(name));
    expect(missing, `functions missing from guards.d.mts: ${missing.join(", ")}`).toEqual([]);
  });

  it("declares every export const from guards.mjs", () => {
    const missing = mjsConsts.filter((name) => !dtsSet.has(name));
    expect(missing, `consts missing from guards.d.mts: ${missing.join(", ")}`).toEqual([]);
  });

  it("does not declare exports absent from guards.mjs", () => {
    const extra = dtsExports.filter((name) => !mjsSet.has(name));
    expect(extra, `guards.d.mts names missing from guards.mjs: ${extra.join(", ")}`).toEqual([]);
  });
});
