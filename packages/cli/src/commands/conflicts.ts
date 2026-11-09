import path from "node:path";
import { defineCommand } from "citty";
import { listConflicts } from "../conflicts/conflicts.js";
import {
  PROPOSE_BACKENDS,
  type ProposeResult,
  proposeBackendMessage,
  runConflictsPropose,
} from "../conflicts/propose.js";
import { detectAgentBackend } from "../plan-loop/detect.js";
import { defaultExec, type GitFn } from "../plan-loop/gate-exit.js";
import { logger } from "../utils/logger.js";

const cwdArg = {
  type: "string" as const,
  description: "Repository directory (default: current directory)",
  default: ".",
};

async function repoRoot(cwd: string): Promise<string | null> {
  const r = await defaultExec("git", ["rev-parse", "--show-toplevel"], { cwd });
  return r.code === 0 ? r.stdout.trim() : null;
}

function printProposal(result: ProposeResult): void {
  const lines = [
    `${result.path}: ${result.hunks.length} hunk(s), backend ${result.backend}`,
    ...(result.replyRefused ? [`reply refused: ${result.replyRefused}`] : []),
    ...result.proposals.map(
      (p) =>
        `  hunk ${p.hunk}: ${p.status}${p.reason ? ` (${p.reason})` : ""}${p.rationale ? ` - ${p.rationale}` : ""}`,
    ),
    result.unresolvedHunks.length
      ? `  no accepted proposal for hunk(s) ${result.unresolvedHunks.join(", ")}`
      : "  every hunk has an accepted proposal",
    `  verification: ${result.verification.status}${result.verification.reason ? ` (${result.verification.reason})` : ""}`,
    ...result.verification.notes.map((n) => `  note: ${n}`),
    "Nothing was written. Apply a proposal in Colony's conflict window, or by hand; use --json for the full result.",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

const proposeCommand = defineCommand({
  meta: {
    name: "propose",
    description:
      "Ask a no-tools agent session (resolve-conflicts) for per-hunk proposals for one conflicted file, check and verify them in a temporary worktree; never writes, stages or commits",
  },
  args: {
    path: { type: "positional", description: "The conflicted file", required: true },
    cwd: cwdArg,
    backend: {
      type: "string",
      description: `Agent CLI: ${PROPOSE_BACKENDS.join(" or ")} (auto picks the first installed)`,
      default: "auto",
    },
    model: { type: "string", description: "Model passed to the agent CLI" },
    json: { type: "boolean", description: "Print the full result as JSON", default: false },
    verify: {
      type: "boolean",
      description:
        "Verify the resolved file in a temporary worktree (stack.validationCommands and stack.testCommands from HEAD's .cursor/agent-kit.config.json); --no-verify skips. The proposal is code: verification runs it",
      default: true,
    },
    "verify-cmd": {
      type: "string",
      description: "Shell command to verify with instead of the configured ones",
    },
    "verify-timeout": {
      type: "string",
      description: "Seconds per verification command (default: 900)",
    },
    "dry-run": {
      type: "boolean",
      description: "Print the prompt (with the redacted pack) and start no session",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = path.resolve(String(args.cwd));
    const requested = String(args.backend ?? "auto");
    let backendId: string;
    let bin: string;
    if (requested === "auto") {
      const found = await detectAgentBackend("auto");
      if (!found.ok) {
        logger.error(found.message);
        process.exitCode = 1;
        return;
      }
      backendId = found.id;
      bin = found.bin;
    } else {
      if (!(PROPOSE_BACKENDS as readonly string[]).includes(requested)) {
        logger.error(proposeBackendMessage(requested));
        process.exitCode = 1;
        return;
      }
      const found = await detectAgentBackend(requested);
      if (!found.ok) {
        logger.error(found.message);
        process.exitCode = 1;
        return;
      }
      backendId = found.id;
      bin = found.bin;
    }
    let verifyTimeoutMs: number | undefined;
    if (args["verify-timeout"] !== undefined) {
      const s = Number.parseInt(String(args["verify-timeout"]), 10);
      if (!Number.isFinite(s) || s <= 0 || String(s) !== String(args["verify-timeout"]).trim()) {
        logger.error("--verify-timeout must be a positive integer (seconds)");
        process.exitCode = 1;
        return;
      }
      verifyTimeoutMs = s * 1000;
    }
    const verifyCmd = args["verify-cmd"] ? String(args["verify-cmd"]).trim() : "";
    const out = await runConflictsPropose({
      root: cwd,
      path: String(args.path),
      backendId: backendId as (typeof PROPOSE_BACKENDS)[number],
      bin,
      model: args.model ? String(args.model) : undefined,
      noVerify: args.verify === false,
      verifyCommands: verifyCmd ? [verifyCmd] : undefined,
      verifyTimeoutMs,
      dryRun: args["dry-run"] === true,
    });
    if (out.error) {
      logger.error(out.error);
      process.exitCode = out.exitCode || 1;
      return;
    }
    if (out.prompt !== undefined) {
      process.stdout.write(
        `--dry-run: no agent will be started and nothing is written.\nBackend: ${backendId} (read-only)\nPrompt:\n${out.prompt}`,
      );
      return;
    }
    if (out.result) {
      if (args.json) process.stdout.write(`${JSON.stringify(out.result, null, 2)}\n`);
      else printProposal(out.result);
    }
    process.exitCode = out.exitCode;
  },
});

export const conflictsCommand = defineCommand({
  meta: {
    name: "conflicts",
    description:
      "List merge conflicts parsed into hunks (base, ours, theirs); `propose <path>` asks a no-tools agent for proposals. Read-only: never writes, stages, commits or pushes",
  },
  args: {
    cwd: cwdArg,
    json: { type: "boolean", description: "Print JSON", default: false },
  },
  subCommands: {
    propose: proposeCommand,
  },
  async run({ args, rawArgs }) {
    // citty also invokes the parent's run after a subcommand.
    if (rawArgs.includes("propose")) return;
    const cwd = path.resolve(String(args.cwd));
    const repo = await repoRoot(cwd);
    if (!repo) {
      logger.error("agent-kit conflicts needs a git repository");
      process.exitCode = 1;
      return;
    }
    const git: GitFn = (a) => defaultExec("git", a, { cwd: repo });
    const listing = await listConflicts({ git, exec: defaultExec, repo });
    if (typeof listing === "string") {
      logger.error(listing);
      process.exitCode = 1;
      return;
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(listing, null, 2)}\n`);
      return;
    }
    if (listing.files.length === 0) {
      process.stdout.write("No unmerged paths.\n");
      return;
    }
    const lines = [
      `${listing.operation ?? "conflict"}: ${listing.files.length} unmerged path(s)${listing.theirs ? ` (theirs ${listing.theirs.ref} ${listing.theirs.sha.slice(0, 12)}: ${listing.theirs.subject})` : ""}`,
      ...listing.files.map(
        (f) =>
          `  ${f.xy} ${f.path}: ${f.kind === "text" ? `${f.hunks.length} hunk(s), base from ${f.baseSource ?? "none"}` : f.kind}${f.reason ? ` (${f.reason})` : ""}`,
      ),
      "Propose: agent-kit conflicts propose <path>",
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
  },
});
