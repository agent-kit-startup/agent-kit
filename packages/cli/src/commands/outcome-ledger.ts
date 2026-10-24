import path from "node:path";
import { defineCommand } from "citty";
import {
  OUTCOME_LEDGER_REL,
  type OutcomeLedgerSummary,
  readOutcomeLedger,
  readProfileTestCommands,
  readTestResults,
  runAndRecordTests,
  summarizeOutcomeLedger,
  TEST_RESULTS_REL,
  testCollectorStatus,
} from "../../../../dashboard/lib/outcome-ledger.mjs";

/** Human summary of the persisted ledger (the snapshot's `outcomeLedger` without flow). */
export function renderOutcomeLedger(summary: OutcomeLedgerSummary): string {
  const lines = [
    `Outcome ledger (${OUTCOME_LEDGER_REL}): ${summary.entries} earned`,
    `  Logic ${summary.totals.logic} · Compute ${summary.totals.compute} · Rare ${summary.totals.rare}`,
  ];
  const kinds = Object.entries(summary.byKind)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${kind} ${n}`);
  if (kinds.length > 0) lines.push(`  ${kinds.join(" · ")}`);
  if (!summary.tests.configured) {
    lines.push(
      "  Tests: no stack.testCommands in .cursor/agent-kit.config.json (run `agent-kit doctor --refresh-profile` or set them)",
    );
  } else if (summary.tests.lastRun) {
    const r = summary.tests.lastRun;
    lines.push(`  Tests: last run ${r.ok ? "passed" : "failed"} at ${r.at}`);
  } else {
    lines.push("  Tests: none recorded yet (`agent-kit outcome-ledger test`)");
  }
  if (summary.entries === 0) {
    lines.push("Nothing earned yet. Mission Control folds the ledger on every refresh.");
  }
  return lines.join("\n");
}

const cwdArg = {
  type: "string" as const,
  description: "Workspace folder (default: current directory)",
};

/**
 * Read the outcome ledger, or run the repository's own test commands and
 * record the pass/fail outcome (ADR 2026-10-23 colony-game point 3). The fold
 * itself runs in Mission Control's snapshot (`dashboard/lib/outcome-ledger.mjs`).
 */
export const outcomeLedgerCommand = defineCommand({
  meta: {
    name: "outcome-ledger",
    description:
      "Show the verified-outcome ledger, or run the repo's test commands and record pass/fail (`test`)",
  },
  subCommands: {
    show: defineCommand({
      meta: { name: "show", description: "Print the persisted ledger totals (default)" },
      args: {
        json: { type: "boolean", description: "Print the summary as JSON", default: false },
        cwd: cwdArg,
      },
      run({ args }) {
        const root = path.resolve(typeof args.cwd === "string" && args.cwd ? args.cwd : ".");
        const summary = summarizeOutcomeLedger(readOutcomeLedger(root), {
          tests: testCollectorStatus(root, readTestResults(root)),
        });
        process.stdout.write(
          args.json ? `${JSON.stringify(summary, null, 2)}\n` : `${renderOutcomeLedger(summary)}\n`,
        );
      },
    }),
    test: defineCommand({
      meta: {
        name: "test",
        description: `Run stack.testCommands from the repository profile and append the outcome to ${TEST_RESULTS_REL}`,
      },
      args: { cwd: cwdArg },
      run({ args }) {
        const root = path.resolve(typeof args.cwd === "string" && args.cwd ? args.cwd : ".");
        if (readProfileTestCommands(root).length === 0) {
          process.stderr.write(
            "No stack.testCommands in .cursor/agent-kit.config.json: nothing to run, nothing recorded. Run `agent-kit doctor --refresh-profile` or set them.\n",
          );
          process.exitCode = 2;
          return;
        }
        const result = runAndRecordTests(root, {
          onCommand: (command) => process.stderr.write(`$ ${command}\n`),
        });
        if (result.status !== "recorded") return;
        const { run } = result;
        process.stderr.write(
          `Recorded: tests ${run.ok ? "passed" : `failed (exit ${run.exitCode})`}${run.head ? ` at ${run.head.slice(0, 8)}` : " (no git HEAD: earns nothing)"}\n`,
        );
        if (!run.ok) process.exitCode = run.exitCode ?? 1;
      },
    }),
  },
  args: {
    json: { type: "boolean", description: "Print the summary as JSON", default: false },
    cwd: cwdArg,
  },
  run({ rawArgs, args }) {
    // citty runs the parent after a subcommand too; only act when none was given.
    if (rawArgs.some((a) => a === "show" || a === "test")) return;
    const root = path.resolve(typeof args.cwd === "string" && args.cwd ? args.cwd : ".");
    const summary = summarizeOutcomeLedger(readOutcomeLedger(root), {
      tests: testCollectorStatus(root, readTestResults(root)),
    });
    process.stdout.write(
      args.json ? `${JSON.stringify(summary, null, 2)}\n` : `${renderOutcomeLedger(summary)}\n`,
    );
  },
});
