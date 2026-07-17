import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(target: string): Promise<T | null> {
  if (!(await fileExists(target))) return null;
  const raw = await readFile(target, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJson(target: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(target));
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function ensureDir(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

export async function listDirectory(rootDir: string): Promise<string[]> {
  return readdir(rootDir);
}
