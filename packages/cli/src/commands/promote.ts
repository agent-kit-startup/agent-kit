import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { defineCommand } from "citty";
import { loadContextConfig } from "../lifecycle/context-config.js";
import {
  formatPromoteMergeWaitResult,
  PROMOTE_PR_VIEW_FIELDS,
  type PromoteMergeWaitResult,
  parsePromotePrView,
  resolvePromoteMergeWaitMs,
  waitForPromoteMerge,
} from "../plan-loop/promote-merge-wait.js";
import {
  findUnmodeledRuleParameters,
  formatRulesetPreflight,
  type RulesetPreflight,
  rulesetPreflightFromGh,
} from "../plan-loop/promote-ruleset-preflight.js";

const execFileAsync = promisify(execFile);

export type GhRunner = (args: string[], opts: { cwd: string }) => Promise<string>;

const defaultRunGh: GhRunner = async (args, opts) => {
  const { stdout } = await execFileAsync("gh", args, {
    cwd: opts.cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout;
};

/** Exit code per outcome: 0 merged, 3 cap reached (open the Ask), 1 closed without a merge. */
export function promoteWaitExitCode(result: PromoteMergeWaitResult): number {
  if (result.outcome === "merged") return 0;
  if (result.outcome === "timeout") return 3;
  return 1;
}

export function promotePrViewArgs(pr: number, repo?: string): string[] {
  const args = ["pr", "view", String(pr), "--json", PROMOTE_PR_VIEW_FIELDS];
  if (repo) args.push("--repo", repo);
  return args;
}

/** Read-only bounded wait. Never merges, never pushes, never tags. */
export async function runPromoteWait(opts: {
  pr: number;
  cwd: string;
  repo?: string;
  capMs?: number;
  runGh?: GhRunner;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ result: PromoteMergeWaitResult; capMs: number }> {
  const runGh = opts.runGh ?? defaultRunGh;
  const capMs = opts.capMs ?? resolvePromoteMergeWaitMs(await loadContextConfig(opts.cwd));
  const result = await waitForPromoteMerge({
    capMs,
    sleep: opts.sleep,
    readPr: async () =>
      parsePromotePrView(await runGh(promotePrViewArgs(opts.pr, opts.repo), { cwd: opts.cwd })),
  });
  return { result, capMs };
}

const waitCommand = defineCommand({
  meta: {
    name: "wait",
    description:
      "Wait, read-only and bounded, for the operator merge of a staging→main promote PR; at the cap (config promoteMergeWaitMs, default 60 min) print the promote-merge-wait Ask and exit 3",
  },
  args: {
    pr: { type: "string", description: "Promote PR number", required: true },
    repo: { type: "string", description: "owner/name (default: the checkout's gh repo)" },
    "cap-minutes": {
      type: "string",
      description: "Override the cap for this run (minutes; clamped like the config key)",
    },
    json: { type: "boolean", description: "Print the result as JSON", default: false },
    cwd: { type: "string", description: "Workspace folder (default: current directory)" },
  },
  async run({ args }) {
    const pr = Number.parseInt(String(args.pr), 10);
    if (!Number.isInteger(pr) || pr <= 0) {
      process.stderr.write("--pr must be a positive PR number.\n");
      process.exitCode = 1;
      return;
    }
    const root = path.resolve(typeof args.cwd === "string" && args.cwd ? args.cwd : ".");
    const capArg = args["cap-minutes"];
    const capMs =
      typeof capArg === "string" && capArg
        ? resolvePromoteMergeWaitMs({ promoteMergeWaitMs: Number(capArg) * 60_000 })
        : undefined;
    const { result } = await runPromoteWait({
      pr,
      cwd: root,
      repo: typeof args.repo === "string" && args.repo ? args.repo : undefined,
      capMs,
    });
    process.stdout.write(
      args.json ? `${JSON.stringify(result, null, 2)}\n` : formatPromoteMergeWaitResult(pr, result),
    );
    process.exitCode = promoteWaitExitCode(result);
  },
});

/** Advisory ruleset preflight for the promote base. Never blocks: always exit 0. */
export async function runPromoteRules(opts: {
  base: string;
  cwd: string;
  repo?: string;
  runGh?: GhRunner;
}): Promise<RulesetPreflight> {
  const runGh = opts.runGh ?? defaultRunGh;
  return rulesetPreflightFromGh({
    base: opts.base,
    repo: opts.repo,
    runGh: (args) => runGh(args, { cwd: opts.cwd }),
  });
}

const rulesCommand = defineCommand({
  meta: {
    name: "rules",
    description:
      "Promote preflight: read the base branch rules (gh api .../rules/branches/<base>) and print each rule parameter the kit does not model; advisory, always exit 0",
  },
  args: {
    base: { type: "string", description: "Promote base branch (default: main)", default: "main" },
    repo: { type: "string", description: "owner/name (default: the checkout's gh repo)" },
    json: {
      type: "boolean",
      description: "Print the unmodeled parameters as JSON",
      default: false,
    },
    cwd: { type: "string", description: "Workspace folder (default: current directory)" },
  },
  async run({ args }) {
    const base = typeof args.base === "string" && args.base ? args.base : "main";
    const root = path.resolve(typeof args.cwd === "string" && args.cwd ? args.cwd : ".");
    const result = await runPromoteRules({
      base,
      cwd: root,
      repo: typeof args.repo === "string" && args.repo ? args.repo : undefined,
    });
    if (args.json) {
      const payload = result.ok
        ? { ok: true, base, unmodeled: findUnmodeledRuleParameters(result.rules) }
        : { ok: false, base, note: result.note };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(formatRulesetPreflight(base, result));
    }
    process.exitCode = 0;
  },
});

export const promoteCommand = defineCommand({
  meta: {
    name: "promote",
    description:
      "Read-only helpers for the staging→main promote PR (`wait`: bounded wait for the operator merge; `rules`: ruleset preflight)",
  },
  subCommands: { wait: waitCommand, rules: rulesCommand },
});
