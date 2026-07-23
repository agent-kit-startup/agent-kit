import { spawn } from "node:child_process";
import path from "node:path";
import { fileExists } from "../utils/fs.js";

/** Canonical L0 launcher (preferred). */
const CANONICAL_REL = path.join(".cursor", "scripts", "plan-external-review.sh");
/** Compatibility wrapper for dogfood / old docs. */
const FALLBACK_REL = path.join("scripts", "plan-external-review.sh");

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

export interface ArmExternalPlanReviewOptions {
  /** One-shot bypass of config enabled (passes --force to the launcher). */
  force?: boolean;
  spawnFn?: typeof spawn;
  existsFn?: (p: string) => Promise<boolean>;
  log?: (line: string) => void;
}

/**
 * Invoke the external plan review launcher from repo root.
 * Prefers `.cursor/scripts/plan-external-review.sh`, falls back to
 * `scripts/plan-external-review.sh` if the canonical path is missing.
 * Pass `force: true` to append `--force` (one-shot arm without config opt-in).
 * Opt-in / missing-claude tips live in the script (exit 0).
 * Never throws; never fails the headless run-loop.
 */
export async function armExternalPlanReview(
  root: string,
  options: ArmExternalPlanReviewOptions = {},
): Promise<ArmExternalPlanReviewResult> {
  const spawnFn = options.spawnFn ?? spawn;
  const existsFn = options.existsFn ?? fileExists;
  const log = options.log ?? ((line: string) => console.log(line));
  const force = options.force === true;

  const canonicalPath = path.join(root, CANONICAL_REL);
  const fallbackPath = path.join(root, FALLBACK_REL);

  let scriptPath: string | null = null;
  let scriptRel = CANONICAL_REL;
  if (await existsFn(canonicalPath)) {
    scriptPath = canonicalPath;
    scriptRel = CANONICAL_REL;
  } else if (await existsFn(fallbackPath)) {
    scriptPath = fallbackPath;
    scriptRel = FALLBACK_REL;
  }

  if (!scriptPath) {
    log(
      `tip: ${CANONICAL_REL} missing (optional wrapper: ${FALLBACK_REL}). Manual: /plan-external-review (enable externalPlanReview in .cursor/context/config.json).`,
    );
    return { invoked: false, exitCode: null, output: "" };
  }

  log("Plan exhausted: arming optional external plan review (opt-in handled by script)...");

  const args = force ? [scriptPath, "--force"] : [scriptPath];

  return new Promise((resolve) => {
    const child = spawnFn("bash", args, {
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
        `tip: external plan review launcher failed (${err.message}). Manual: ${scriptRel} or /plan-external-review`,
      );
      resolve({ invoked: true, exitCode: null, output });
    });

    child.on("close", (code: number | null) => {
      if (code !== 0 && code !== null) {
        log(
          `tip: external plan review exited ${code} (ignored; does not fail the loop). Manual: ${scriptRel} or /plan-external-review`,
        );
      }
      resolve({ invoked: true, exitCode: code, output });
    });
  });
}
