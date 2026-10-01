import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
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

/** Write via a sibling temp file + rename so a concurrent reader never sees a torn file. */
export async function writeJson(target: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(target));
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

export async function ensureDir(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

export async function listDirectory(rootDir: string): Promise<string[]> {
  return readdir(rootDir);
}
