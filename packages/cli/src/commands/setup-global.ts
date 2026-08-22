/**
 * `agent-kit setup-global` — self-heal for the classic fresh-install blocker:
 * a root-owned npm global prefix (e.g. `/usr/local/lib/node_modules` on
 * macOS system Node), which turns `npm i -g @dadado/agent-kit-cli` into an
 * EACCES and leaves a beginner at `zsh: command not found` after `npx`.
 *
 * This mechanizes the 4-step manual fix (see plan evidence): relocate npm's
 * global prefix to a user-owned directory (`~/.npm-global`), put its `bin`
 * on PATH via the detected shell profile, reinstall globally, then verify.
 *
 * This command mutates user-level state OUTSIDE the repo (`~/.npmrc`, a
 * shell profile) and is HITL-sensitive by design:
 *   - every step is printed (concrete resolved paths/commands) before it
 *     runs, and each mutating step has its own confirm gate.
 *   - non-interactive mode (CI, NO_COLOR-adjacent piped stdin, `--yes`,
 *     `AGENT_KIT_YES=1` — see `isNonInteractive()`) NEVER mutates anything;
 *     it prints the equivalent manual shell commands and exits 0.
 *   - `--dry-run` prints the resolved plan and mutates nothing, regardless
 *     of interactive/non-interactive.
 *   - never `sudo`, never `chown` — the fix is relocation, not permission
 *     repair.
 *   - the shell-profile append is idempotent via a marker comment; a
 *     second run (or an already-patched profile) skips that step instead
 *     of re-confirming/re-appending.
 *
 * Design choice — npm prefix mutation mechanism: this writes `prefix = ` to
 * `~/.npmrc` directly (mirroring `parseNpmrcPrefix`/`detectNpmPrefix` in
 * `../readiness/env-checks.js`, which already reads that exact line) rather
 * than spawning `npm config set prefix`. That keeps the mutation
 * dependency-injectable and unit-testable without a real npm binary, avoids
 * npm's multi-second cold-start latency during an interactive confirm flow,
 * and round-trips cleanly with the existing reader. `npm i -g` itself still
 * has to be spawned — there's no way to replicate a real global install.
 */
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";
import { cyan, green, yellow } from "kolorist";
import {
  type AssessEnvironmentOptions,
  type EnvironmentReport,
  assessEnvironment,
} from "../readiness/env-checks.js";
import { classifyInstallError, isNonInteractive } from "../utils/terminal.js";

export const NPM_GLOBAL_DIR_NAME = ".npm-global";
export const SETUP_GLOBAL_MARKER = "# agent-kit setup-global";
export const DEFAULT_PACKAGE_SPEC = "@dadado/agent-kit-cli";

export type SetupGlobalStepId = "set-prefix" | "append-path" | "npm-install" | "verify";

export interface SetupGlobalStep {
  id: SetupGlobalStepId;
  title: string;
  /** Concrete, resolved lines describing exactly what this step will do. */
  detail: string[];
}

export interface SetupGlobalPlan {
  packageSpec: string;
  homeDir: string;
  npmGlobalDir: string;
  npmGlobalBin: string;
  npmrcPath: string;
  /** The literal value written to .npmrc's `prefix = ` line (tilde form). */
  npmrcPrefixValue: string;
  pathExportLine: string;
  markerComment: string;
  shellProfile: string | null;
  shellSupported: boolean;
  alreadyWritable: boolean;
  currentPrefix: string | null;
  steps: SetupGlobalStep[];
}

export interface PlanSetupGlobalOptions {
  homeDir?: string;
  packageSpec?: string;
}

/** Pure: build the 4-step self-heal plan from an already-assessed environment. */
export function planSetupGlobalSteps(
  env: EnvironmentReport,
  options: PlanSetupGlobalOptions = {},
): SetupGlobalPlan {
  const homeDir = options.homeDir ?? homedir();
  const packageSpec = options.packageSpec ?? DEFAULT_PACKAGE_SPEC;
  const npmGlobalDir = path.join(homeDir, NPM_GLOBAL_DIR_NAME);
  const npmGlobalBin = path.join(npmGlobalDir, "bin");
  const npmrcPath = path.join(homeDir, ".npmrc");
  const npmrcPrefixValue = `~/${NPM_GLOBAL_DIR_NAME}`;
  const pathExportLine = `export PATH="${npmGlobalBin}:$PATH"`;
  const shellProfile = env.shellProfile;
  const shellSupported = shellProfile != null;

  const steps: SetupGlobalStep[] = [
    {
      id: "set-prefix",
      title: "Set npm's global install prefix to a folder you own",
      detail: [
        `mkdir -p ${npmGlobalDir}`,
        `npm config set prefix "${npmrcPrefixValue}"  (writes "prefix = ${npmrcPrefixValue}" to ${npmrcPath})`,
      ],
    },
    {
      id: "append-path",
      title: shellSupported
        ? `Put ${npmGlobalBin} on PATH via ${shellProfile}`
        : "Put npm's global bin on PATH (manual — shell not auto-detected)",
      detail: shellSupported
        ? [`Append to ${shellProfile}:`, `  ${SETUP_GLOBAL_MARKER}`, `  ${pathExportLine}`]
        : [
            `Shell could not be auto-detected as zsh or bash (detected: ${env.shell ?? "unknown"}).`,
            "You'll need to add this line to your shell's startup file yourself:",
            `  ${pathExportLine}`,
          ],
    },
    {
      id: "npm-install",
      title: `Reinstall ${packageSpec} globally, now into the new prefix`,
      detail: [`npm i -g ${packageSpec}`],
    },
    {
      id: "verify",
      title: "Verify `agent-kit` resolves on PATH",
      detail: [
        "Re-check whether a bare `agent-kit` resolves on PATH.",
        "Needs a new shell session (or `source` the profile) to take effect — this process's own PATH can't reflect it.",
      ],
    },
  ];

  return {
    packageSpec,
    homeDir,
    npmGlobalDir,
    npmGlobalBin,
    npmrcPath,
    npmrcPrefixValue,
    pathExportLine,
    markerComment: SETUP_GLOBAL_MARKER,
    shellProfile,
    shellSupported,
    alreadyWritable: env.npmPrefixWritable,
    currentPrefix: env.npmPrefix.prefix,
    steps,
  };
}

/** Upsert a `prefix = ...` line into .npmrc-style content, preserving everything else. */
export function upsertNpmrcPrefix(content: string, prefixValue: string): string {
  const line = `prefix = ${prefixValue}`;
  const prefixLineRe = /^\s*prefix\s*=.*$/m;
  if (prefixLineRe.test(content)) {
    return content.replace(prefixLineRe, line);
  }
  const withTrailingNewline =
    content.length > 0 && !content.endsWith("\n") ? `${content}\n` : content;
  return `${withTrailingNewline}${line}\n`;
}

export interface SetupGlobalFsImpl {
  mkdir: (dir: string) => Promise<void>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  appendFile: (filePath: string, content: string) => Promise<void>;
}

const defaultFsImpl: SetupGlobalFsImpl = {
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  readFile: (filePath) => readFile(filePath, "utf8"),
  writeFile: (filePath, content) => writeFile(filePath, content, "utf8"),
  appendFile: (filePath, content) => appendFile(filePath, content, "utf8"),
};

async function safeReadFile(fs: SetupGlobalFsImpl, filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return "";
  }
}

export interface NpmInstallOutcome {
  ok: boolean;
  error?: unknown;
}

export type NpmInstallImpl = (packageSpec: string) => Promise<NpmInstallOutcome>;

const defaultNpmInstallImpl: NpmInstallImpl = (packageSpec) =>
  new Promise((resolve) => {
    const child = spawn("npm", ["i", "-g", packageSpec], { stdio: "inherit" });
    child.on("error", (error) => resolve({ ok: false, error }));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: new Error(`npm exited with code ${code ?? "unknown"}`) });
    });
  });

/** Wraps @clack/prompts confirm(); cancel (Ctrl+C / Esc) reads as "no". */
export type ConfirmStepImpl = (message: string) => Promise<boolean>;

const defaultConfirmImpl: ConfirmStepImpl = async (message) => {
  const answer = await confirm({ message, initialValue: true });
  if (isCancel(answer)) return false;
  return Boolean(answer);
};

export interface RunSetupGlobalOptions extends AssessEnvironmentOptions {
  dryRun?: boolean;
  /** Pre-computed non-interactive decision (caller folds in --yes / AGENT_KIT_YES / CI / TTY). */
  nonInteractive?: boolean;
  packageSpec?: string;
  print?: (line: string) => void;
  fsImpl?: SetupGlobalFsImpl;
  npmInstallImpl?: NpmInstallImpl;
  confirmImpl?: ConfirmStepImpl;
  /** Injectable for tests; defaults to the real assessEnvironment. */
  assessEnvironmentImpl?: (opts: AssessEnvironmentOptions) => Promise<EnvironmentReport>;
}

export type SetupGlobalOutcome =
  | "already-ok"
  | "dry-run"
  | "manual-instructions"
  | "completed"
  | "cancelled"
  | "error";

export interface SetupGlobalRunResult {
  exitCode: number;
  mutated: boolean;
  outcome: SetupGlobalOutcome;
  env: EnvironmentReport;
  plan: SetupGlobalPlan;
}

function printHeader(env: EnvironmentReport, print: (line: string) => void): void {
  print(cyan("agent-kit setup-global"));
  print(
    `  npm prefix: ${env.npmPrefix.prefix ?? "unknown"} (${
      env.npmPrefixWritable ? "writable" : "NOT writable"
    })`,
  );
  if (!env.npmPrefixWritable && env.npmPrefix.reason) {
    print(`    ${env.npmPrefix.reason}`);
  }
  print(
    `  shell: ${env.shell ?? "unknown"}${
      env.shellProfile
        ? ` (profile: ${env.shellProfile})`
        : " (profile not auto-detected: zsh/bash only)"
    }`,
  );
}

function printPlanSteps(plan: SetupGlobalPlan, print: (line: string) => void): void {
  for (const [index, step] of plan.steps.entries()) {
    print(`${index + 1}. ${step.title}`);
    for (const line of step.detail) print(`   ${line}`);
  }
}

function printManualInstructions(plan: SetupGlobalPlan, print: (line: string) => void): void {
  print("No changes made. Same fix, as commands you can run yourself:");
  print(`  mkdir -p ${plan.npmGlobalDir}`);
  print(`  npm config set prefix "${plan.npmrcPrefixValue}"`);
  if (plan.shellSupported) {
    print(`  echo '${plan.markerComment}' >> ${plan.shellProfile}`);
    print(`  echo '${plan.pathExportLine}' >> ${plan.shellProfile}`);
    print(`  source ${plan.shellProfile}`);
  } else {
    print(`  # add this line to your shell's startup file:`);
    print(`  ${plan.pathExportLine}`);
  }
  print(`  npm i -g ${plan.packageSpec}`);
  print("  agent-kit --version   # verify, in a new shell session");
}

/**
 * Run (or simulate) the setup-global self-heal. Pure enough for tests: all
 * filesystem, npm-install, and prompt effects are dependency-injected, and
 * every non-mutating path (already-ok / dry-run / non-interactive) never
 * touches `fsImpl` or `npmInstallImpl`.
 */
export async function runSetupGlobal(
  options: RunSetupGlobalOptions = {},
): Promise<SetupGlobalRunResult> {
  const print = options.print ?? ((line: string) => console.log(line));
  const assessEnvironmentImpl = options.assessEnvironmentImpl ?? assessEnvironment;
  const homeDir = options.homeDir ?? homedir();

  const env = await assessEnvironmentImpl(options);
  const plan = planSetupGlobalSteps(env, { homeDir, packageSpec: options.packageSpec });

  if (plan.alreadyWritable) {
    printHeader(env, print);
    print(green("npm's global prefix is already writable — nothing to fix."));
    return { exitCode: 0, mutated: false, outcome: "already-ok", env, plan };
  }

  if (options.dryRun) {
    printHeader(env, print);
    print("Dry run — no changes will be made. Steps that would run:");
    printPlanSteps(plan, print);
    return { exitCode: 0, mutated: false, outcome: "dry-run", env, plan };
  }

  const nonInteractive = options.nonInteractive ?? isNonInteractive();
  if (nonInteractive) {
    printHeader(env, print);
    printManualInstructions(plan, print);
    return { exitCode: 0, mutated: false, outcome: "manual-instructions", env, plan };
  }

  printHeader(env, print);
  print("You just hit the classic 'command not found' / EACCES fresh-install blocker.");
  print("The following steps need your confirmation, one at a time:");
  printPlanSteps(plan, print);

  const fs = options.fsImpl ?? defaultFsImpl;
  const confirmStep = options.confirmImpl ?? defaultConfirmImpl;
  const npmInstall = options.npmInstallImpl ?? defaultNpmInstallImpl;
  let mutated = false;

  // Step 1: set-prefix
  const setPrefixStep = plan.steps[0] as SetupGlobalStep;
  print(`\n${setPrefixStep.title}`);
  for (const line of setPrefixStep.detail) print(`   ${line}`);
  const proceedPrefix = await confirmStep(`Set npm's global prefix to ${plan.npmGlobalDir}?`);
  if (!proceedPrefix) {
    print(yellow("Cancelled — no changes made."));
    return { exitCode: 1, mutated, outcome: "cancelled", env, plan };
  }
  await fs.mkdir(plan.npmGlobalDir);
  const npmrcContent = await safeReadFile(fs, plan.npmrcPath);
  await fs.writeFile(plan.npmrcPath, upsertNpmrcPrefix(npmrcContent, plan.npmrcPrefixValue));
  mutated = true;
  print(green(`  done: prefix set (${plan.npmrcPath}).`));

  // Step 2: append-path
  const appendPathStep = plan.steps[1] as SetupGlobalStep;
  print(`\n${appendPathStep.title}`);
  for (const line of appendPathStep.detail) print(`   ${line}`);
  if (!plan.shellSupported) {
    print(yellow("  shell not auto-detected as zsh/bash — add the line above yourself."));
  } else {
    const profilePath = plan.shellProfile as string;
    const profileContent = await safeReadFile(fs, profilePath);
    if (profileContent.includes(plan.markerComment)) {
      print(`  already present in ${profilePath} (marker found) — skipping.`);
    } else {
      const proceedPath = await confirmStep(`Append the PATH export to ${profilePath}?`);
      if (!proceedPath) {
        print(yellow("Cancelled — prefix was set, PATH export was not appended."));
        return { exitCode: 1, mutated, outcome: "cancelled", env, plan };
      }
      await fs.appendFile(profilePath, `\n${plan.markerComment}\n${plan.pathExportLine}\n`);
      mutated = true;
      print(green(`  done: PATH export appended to ${profilePath}.`));
    }
  }

  // Step 3: npm-install
  const installStep = plan.steps[2] as SetupGlobalStep;
  print(`\n${installStep.title}`);
  for (const line of installStep.detail) print(`   ${line}`);
  const proceedInstall = await confirmStep(`Run: npm i -g ${plan.packageSpec}?`);
  if (!proceedInstall) {
    print(yellow("Cancelled — prefix/PATH changes above are still in place."));
    return { exitCode: 1, mutated, outcome: "cancelled", env, plan };
  }
  const installResult = await npmInstall(plan.packageSpec);
  if (!installResult.ok) {
    const hint = classifyInstallError(installResult.error);
    print(`  npm install failed: ${hint.message}`);
    print(hint.recovery);
    return { exitCode: 1, mutated, outcome: "error", env, plan };
  }
  mutated = true;
  print(green(`  done: ${plan.packageSpec} installed globally.`));

  // Step 4: verify
  const verifyStep = plan.steps[3] as SetupGlobalStep;
  print(`\n${verifyStep.title}`);
  for (const line of verifyStep.detail) print(`   ${line}`);
  const proceedVerify = await confirmStep("Verify now (re-check PATH in this process)?");
  if (proceedVerify) {
    const verifyEnv = await assessEnvironmentImpl(options);
    if (verifyEnv.binOnPath) {
      print(green("  verify: `agent-kit` resolves on PATH."));
    } else {
      print("  verify: `agent-kit` isn't resolvable in THIS process's PATH yet — that's expected.");
      print(
        `  Open a new terminal (or run: source ${plan.shellProfile ?? "<your shell profile>"}) and re-check with: agent-kit --version`,
      );
    }
  } else {
    print("  skipped verification. Open a new terminal and run: agent-kit --version");
  }

  return { exitCode: 0, mutated, outcome: "completed", env, plan };
}

export const setupGlobalCommand = defineCommand({
  meta: {
    name: "setup-global",
    description:
      "Self-heal a root-owned npm prefix: relocate to ~/.npm-global, fix PATH, reinstall globally.",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Print the resolved plan; mutate nothing.",
      default: false,
    },
    yes: {
      type: "boolean",
      alias: "y",
      description:
        "Treat as non-interactive: print the manual steps instead of prompting (never mutates).",
      default: false,
    },
  },
  async run({ args }) {
    const nonInteractive = args.yes || isNonInteractive();
    const result = await runSetupGlobal({
      dryRun: Boolean(args["dry-run"]),
      nonInteractive,
    });
    process.exitCode = result.exitCode;
  },
});
