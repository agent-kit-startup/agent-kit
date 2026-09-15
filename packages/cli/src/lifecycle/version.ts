import { createRequire } from "node:module";

interface PackageMetadata {
  version?: unknown;
}

const require = createRequire(import.meta.url);

function loadPackageVersion(): string {
  for (const packagePath of ["../package.json", "../../package.json"]) {
    try {
      const metadata = require(packagePath) as PackageMetadata;
      if (typeof metadata.version === "string" && metadata.version.length > 0) {
        return metadata.version;
      }
    } catch {
      // Source and bundled builds resolve the package root from different depths.
    }
  }
  throw new Error("Unable to resolve the Agent Kit CLI package version");
}

/** Published package version written into agent-kit.json on install/update. */
export const KIT_VERSION = loadPackageVersion();

/** npm spec of this CLI, used when telling an operator to upgrade the binary. */
export const KIT_PACKAGE_SPEC = "@dadado/agent-kit-cli";

/** Pin a publish to this exact version. Unpinned specs reuse a stale npx/global bin. */
export function pinnedCliSpec(version: string = KIT_VERSION): string {
  return `${KIT_PACKAGE_SPEC}@${version}`;
}
