import path from "node:path";
import { defineCommand } from "citty";
import { KIT_VERSION } from "../lifecycle/version.js";
import { createReadinessReport } from "../scanner/readiness.js";
import { executeSafeReadinessFixes } from "../scanner/safe-fixes.js";
import { runScanner } from "../scanner/scan.js";
import { writeReadinessSnapshot } from "../scanner/snapshot.js";
import type { ReadinessReport, SafeReadinessChange } from "../types.js";

export interface DoctorResult {
  report: ReadinessReport;
  safeChanges: SafeReadinessChange[];
}

export async function runDoctor(
  cwd: string,
  options: { fixSafe?: boolean; generatedAt?: string } = {},
): Promise<DoctorResult> {
  const rootDir = path.resolve(cwd);
  if (options.fixSafe) {
    const execution = await executeSafeReadinessFixes(rootDir, {
      generatorVersion: KIT_VERSION,
      generatedAt: options.generatedAt,
    });
    await writeReadinessSnapshot(rootDir, execution.after);
    return { report: execution.after, safeChanges: execution.changes };
  }

  const scan = await runScanner(rootDir);
  const report = createReadinessReport(scan, {
    generatorVersion: KIT_VERSION,
    generatedAt: options.generatedAt,
  });
  await writeReadinessSnapshot(rootDir, report);
  return { report, safeChanges: [] };
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
  console.log(
    nextAction
      ? `Next: ${nextAction.recommendation}`
      : "Next: repository readiness checks are complete",
  );
}

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Diagnose repository readiness and optionally apply safe local fixes.",
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
