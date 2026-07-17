import { defineCommand } from "citty";
import { runScanner } from "../scanner/scan.js";
import { logger } from "../utils/logger.js";

export const scanCommand = defineCommand({
  meta: {
    name: "scan",
    description: "Scan the current repository and print detected profile.",
  },
  args: {
    cwd: {
      type: "string",
      description: "Project root directory",
      default: process.cwd(),
    },
  },
  async run({ args }) {
    const result = await runScanner(args.cwd);
    logger.info(`Scan completed for ${result.rootDir}`);
    logger.info(`Path: ${result.isGreenfield ? "greenfield" : "existing project"}`);
    console.log(JSON.stringify(result, null, 2));
  },
});
