import path from "node:path";
import { defineCommand } from "citty";
import { type HooksHealthReport, assessHooksHealth } from "../invariants/hooks-health.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { createReadinessReport } from "../scanner/readiness.js";
import { executeSafeReadinessFixes } from "../scanner/safe-fixes.js";
import { runScanner } from "../scanner/scan.js";
import { writeReadinessSnapshot } from "../scanner/snapshot.js";
import type { ReadinessReport, SafeReadinessChange } from "../types.js";

export interface DoctorResult {
  report: ReadinessReport;
  safeChanges: SafeReadinessChange[];
  hooks: HooksHealthReport;
}

export async function runDoctor(
  cwd: string,
  options: { fixSafe?: boolean; generatedAt?: string } = {},
): Promise<DoctorResult> {
  const rootDir = path.resolve(cwd);
  const hooks = await assessHooksHealth(rootDir);
  if (options.fixSafe) {
    const execution = await executeSafeReadinessFixes(rootDir, {
      generatorVersion: KIT_VERSION,
      generatedAt: options.generatedAt,
    });
    await writeReadinessSnapshot(rootDir, execution.after);
    return { report: execution.after, safeChanges: execution.changes, hooks };
  }

  const scan = await runScanner(rootDir);
  const report = createReadinessReport(scan, {
    generatorVersion: KIT_VERSION,
    generatedAt: options.generatedAt,
  });
  await writeReadinessSnapshot(rootDir, report);
  return { report, safeChanges: [], hooks };
}

function printDoctorSummary(result: DoctorResult): void {
  const { summary, pendingActions } = result.report;
  const fixed = result.safeChanges.filter((change) => change.status === "applied").length;
  const nextAction = pendingActions[0];
  console.log("Repository readiness");
  console.log(
    `  ready: ${summary.ready}, choices: ${summary.needs_choice}, manual: ${summary.manual}, blocked: ${summary.blocked}`,
  );
  console.log(`  safe fixes applied: ${fixed}`);
  console.log(`  pending actions: ${pendingActions.length}`);
  console.log(`hooks: ${result.hooks.status}`);
  if (result.hooks.reasons.length > 0) {
    for (const reason of result.hooks.reasons.slice(0, 5)) {
      console.log(`  - ${reason}`);
    }
  }
  if (result.hooks.advisories.length > 0) {
    console.log("hooks advisories (soft; install via cp, see git-hooks/README.md):");
    for (const tip of result.hooks.advisories.slice(0, 5)) {
      console.log(`  - ${tip}`);
    }
  }

  // Check for ALLOW_MAIN_PUSH environment variable
  if (process.env.ALLOW_MAIN_PUSH === "1") {
    console.log("⚠️  WARNING: ALLOW_MAIN_PUSH=1 is set in environment");
    console.log("   This disables main-push protection for agent Shell commands.");
    console.log("   Consider unsetting it: unset ALLOW_MAIN_PUSH");
  }

  console.log(
    nextAction
      ? `Next: ${nextAction.recommendation}`
      : "Next: repository readiness checks are complete",
  );
}

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Diagnose repository readiness; optional --fix-safe local repairs.",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    json: {
      type: "boolean",
      description: "Print deterministic machine-readable JSON without status messages",
      default: false,
    },
    "fix-safe": {
      type: "boolean",
      description: "Apply only local, reversible, merge-safe readiness fixes",
      default: false,
    },
  },
  async run({ args }) {
    const result = await runDoctor(args.cwd, { fixSafe: args["fix-safe"] });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printDoctorSummary(result);
  },
});
