import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

export interface FindOnPathOptions {
  /** Environment to read PATH / PATHEXT from (default: process.env). */
  env?: NodeJS.ProcessEnv;
  /** Platform rules to apply (default: process.platform). */
  platform?: NodeJS.Platform;
  /** Test seam: resolves when the candidate is usable, rejects otherwise. */
  accessFn?: (file: string, mode: number) => Promise<void>;
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * Cross-platform replacement for `which <bin>`: walks PATH with the
 * platform's delimiter and, on Windows, tries each PATHEXT suffix (the
 * vendor CLIs install as `claude.cmd`, `codex.cmd`, ...). POSIX requires the
 * execute bit; Windows only existence. A name that already contains a path
 * separator is checked as given. Node built-ins only; never spawns a shell.
 * Returns the first absolute hit, or null.
 */
export async function findOnPath(
  bin: string,
  opts: FindOnPathOptions = {},
): Promise<string | null> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const win = platform === "win32";
  const pathApi = win ? path.win32 : path.posix;
  const check =
    opts.accessFn ??
    (async (file: string, mode: number) => {
      await access(file, mode);
      // X_OK also passes for a directory; `which` only reports files.
      if (!(await stat(file)).isFile()) throw new Error("not a file");
    });
  const mode = win ? constants.F_OK : constants.X_OK;
  if (!bin.trim()) return null;

  const pathValue = (win ? (env.Path ?? env.PATH ?? env.path) : env.PATH) ?? "";
  // Windows: PATHEXT suffixes only (an extensionless npm sh shim next to
  // `claude.cmd` is not runnable there), unless the name already has one.
  const exts = win ? (env.PATHEXT ?? DEFAULT_PATHEXT).split(";").filter(Boolean) : [""];
  const hasExt = win && exts.some((ext) => bin.toLowerCase().endsWith(ext.toLowerCase()));
  const suffixes = hasExt ? [""] : exts;

  const tryFile = async (file: string): Promise<string | null> => {
    for (const ext of suffixes) {
      const candidate = `${file}${ext}`;
      try {
        await check(candidate, mode);
        return candidate;
      } catch {
        // next candidate
      }
    }
    return null;
  };

  if (bin.includes("/") || (win && bin.includes("\\"))) return tryFile(bin);

  const delimiter = win ? ";" : ":";
  for (const raw of pathValue.split(delimiter)) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    const hit = await tryFile(pathApi.join(dir, bin));
    if (hit) return hit;
  }
  return null;
}
