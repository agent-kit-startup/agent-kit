import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `tsx` is a devDependency of the @dadado/agent-kit-cli workspace package
// only, not hoisted to root node_modules/.bin. Bare `npx tsx` / `pnpm exec
// tsx` fail at repo root with "command not found"; routing through the
// workspace package that owns tsx is the invocation that resolves.
export function generateL0Artifacts() {
  const scriptPath = path.join(root, "scripts", "derive-l0-artifacts.ts");
  const out = execFileSync(
    "pnpm",
    ["--filter", "@dadado/agent-kit-cli", "exec", "tsx", scriptPath],
    {
      cwd: root,
      encoding: "utf-8",
    },
  );
  return JSON.parse(out);
}
