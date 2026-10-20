import { defineCommand } from "citty";
import { buildEngineManifest, renderEngineManifest } from "../lifecycle/engine-info.js";

/**
 * Contract probe for hosts that run the CLI as a managed engine (an IDE host): the CLI version
 * plus the two contract versions a host gates on. Same fields as the engine artifact's
 * `engine.json` (scripts/build-engine-artifact.mjs writes it from this output).
 */
export const engineInfoCommand = defineCommand({
  meta: {
    name: "engine-info",
    description: "Print the engine manifest: version, Node range, driver protocol, snapshot schema",
  },
  args: {
    json: { type: "boolean", description: "Print the manifest as JSON", default: false },
  },
  run({ args }) {
    const manifest = buildEngineManifest();
    process.stdout.write(
      args.json ? `${JSON.stringify(manifest, null, 2)}\n` : `${renderEngineManifest(manifest)}\n`,
    );
  },
});
