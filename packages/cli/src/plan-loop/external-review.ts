import { spawn } from "node:child_process";
import path from "node:path";
import { fileExists } from "../utils/fs.js";

const SCRIPT_REL = path.join("scripts", "plan-external-review.sh");

/**
 * True when a stop reason indicates the plan is exhausted (all implementable
 * to-dos done). Used with pending===0; does not treat safety stops (no
 * progress, max ticks, user stop file) as exhaustion.
 */
export function isPlanExhaustedReason(reason: string): boolean {
  const r = reason.trim().toLowerCase();
  if (!r) return false;
  if (r.includes("plan exhausted")) return true;
  if (r.includes("nothing to do")) return true;
  if (r.includes("no implementable")) return true;
  if (
    /\ball\s+(implementable\s+)?to-?dos?\b/.test(r) &&
    (r.includes("completed") || r.includes("done") || r.includes("exhausted"))
  ) {
    return true;
  }
  return false;
}

export function shouldArmExternalPlanReview(input: {
  pending: number;
  stopReason?: string;
}): boolean {
  if (input.pending === 0) return true;
  if (input.stopReason && isPlanExhaustedReason(input.stopReason)) return true;
  return false;
}

export interface ArmExternalPlanReviewResult {
  /** Script was found and spawned (exit code may still be tip/no-op). */
  invoked: boolean;
  exitCode: number | null;
  output: string;
}

/**
 * Invoke scripts/plan-external-review.sh from repo root.
 * Opt-in / missing-claude tips live in the script (exit 0).
 * Never throws; never fails the headless run-loop.
 */
export async function armExternalPlanReview(
  root: string,
  deps: {
    spawnFn?: typeof spawn;
    existsFn?: (p: string) => Promise<boolean>;
    log?: (line: string) => void;
  } = {},
): Promise<ArmExternalPlanReviewResult> {
  const spawnFn = deps.spawnFn ?? spawn;
  const existsFn = deps.existsFn ?? fileExists;
  const log = deps.log ?? ((line: string) => console.log(line));

  const scriptPath = path.join(root, SCRIPT_REL);
  if (!(await existsFn(scriptPath))) {
    log(
      `tip: ${SCRIPT_REL} missing. Manual: /plan-external-review (enable externalPlanReview in .cursor/context/config.json).`,
    );
    return { invoked: false, exitCode: null, output: "" };
  }

  log("Plan exhausted: arming optional external plan review (opt-in handled by script)...");

  return new Promise((resolve) => {
    const child = spawnFn("bash", [scriptPath], {
      cwd: root,
      env: process.env,
    });

    let output = "";
    const append = (chunk: unknown) => {
      const s = String(chunk);
      output += s;
      process.stdout.write(s);
    };

    child.stdout?.on("data", append);
    child.stderr?.on("data", (chunk: unknown) => {
      const s = String(chunk);
      output += s;
      process.stderr.write(s);
    });

    child.on("error", (err: Error) => {
      log(
        `tip: external plan review launcher failed (${err.message}). Manual: ${SCRIPT_REL} or /plan-external-review`,
      );
      resolve({ invoked: true, exitCode: null, output });
    });

    child.on("close", (code: number | null) => {
      if (code !== 0 && code !== null) {
        log(
          `tip: external plan review exited ${code} (ignored; does not fail the loop). Manual: ${SCRIPT_REL} or /plan-external-review`,
        );
      }
      resolve({ invoked: true, exitCode: code, output });
    });
  });
}
