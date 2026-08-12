/** Ambient types for dashboard/lib/guards.mjs (consumed by CLI TypeScript). */

export function resolveContextConfigPath(
  repoRoot: string,
  fsHooks?: {
    existsSync?: (path: string) => boolean;
    realpathSync?: (path: string) => string;
    mkdirSync?: (path: string, opts?: { recursive?: boolean }) => void;
  },
): { ok: true; path: string } | { ok: false; error: string };
