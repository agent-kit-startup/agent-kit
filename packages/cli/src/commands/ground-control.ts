import path from "node:path";
import { defineCommand } from "citty";
import { redactSecrets } from "../plan-loop/backends.js";
import {
  defaultExec,
  type ExecFn,
  findAuthenticatedForge,
  GATE_EXIT_BRANCH_PREFIX,
  GATE_EXIT_MARKER_RELPATH,
  type GateExitEntry,
  type GateExitMarker,
  type GateExitRefs,
  type GitFn,
  gateExitBranch,
  gateExitNotePath,
  gateExitRedactions,
  isGateExitStamp,
  isSafeBaseRef,
  listGateExitBranches,
  type MarkerRead,
  readGateExitMarker,
  resolveGateExitRefs,
  writeGateExitMarker,
} from "../plan-loop/gate-exit.js";
import { blobId, isTicketMerged } from "../plan-loop/merge-detect.js";
import { findOnPath } from "../utils/find-on-path.js";
import { logger } from "../utils/logger.js";

/**
 * Ground Control: the operator-side triage of gate exits (ADR
 * 2026-10-08_countdown-coming-home-generic-lane point 3). `status` lists the
 * pending tickets (marker entries and gate-exit branches), `accept <stamp>`
 * clears a ticket whose branch is merged into the base, `discard <stamp>`
 * closes the PR/MR, deletes the branch and clears the ticket. It never
 * merges, never force-pushes, never promotes, and only ever deletes the one
 * `gate-exit/<stamp>` branch the operator named.
 */

/** Shared with the review job (`plan-loop/merge-detect.ts`); re-exported for existing callers. */
export { isTicketMerged };

export const GROUND_CONTROL_EXIT = {
  ok: 0,
  usage: 1,
  /** `accept` on a branch that is not merged into the base yet. */
  waiting: 2,
  /** A git or forge step failed; the ticket is kept. */
  failed: 3,
} as const;

export type TicketBranchState = "unmerged" | "merged" | "none";

export interface GroundControlTicket {
  stamp: string;
  /** First line of the note (`# Gate exit <stamp>: ...`), when the note is readable. */
  headline: string | null;
  askId: string | null;
  labels: string[];
  trigger: string | null;
  openedAt: string | null;
  url: string | null;
  /** Short ref of the gate-exit branch, when one exists. */
  branch: string | null;
  branchState: TicketBranchState;
  /** Whether the marker holds an entry for this stamp. */
  inMarker: boolean;
}

export interface GroundControlStatus {
  marker: MarkerRead["kind"];
  markerDetail?: string;
  base: string;
  tickets: GroundControlTicket[];
  skipped: string[];
  warnings: string[];
}

interface Context {
  root: string;
  env: NodeJS.ProcessEnv;
  exec: ExecFn;
  git: GitFn;
  hasOrigin: boolean;
  originUrl: string;
}

async function openContext(
  cwd: string,
  env: NodeJS.ProcessEnv,
  exec: ExecFn,
): Promise<Context | string> {
  const root = path.resolve(cwd);
  const git: GitFn = (args) => exec("git", args, { cwd: root, env });
  const top = await git(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return "not a git repository";
  const origin = await git(["remote", "get-url", "origin"]);
  const originUrl = origin.code === 0 ? origin.stdout.trim() : "";
  return { root, env, exec, git, hasOrigin: originUrl.length > 0, originUrl };
}

async function fetchOrigin(ctx: Context): Promise<string | null> {
  if (!ctx.hasOrigin) return null;
  const fetched = await ctx.git(["fetch", "--prune", "--quiet", "origin"]);
  return fetched.code === 0
    ? null
    : `git fetch --prune origin failed (${fetched.stderr.trim().split("\n")[0] ?? ""})`;
}

function stampOfBranch(short: string): string | null {
  const i = short.lastIndexOf(GATE_EXIT_BRANCH_PREFIX);
  if (i < 0) return null;
  const stamp = short.slice(i + GATE_EXIT_BRANCH_PREFIX.length);
  return isGateExitStamp(stamp) ? stamp : null;
}

async function refExists(git: GitFn, ref: string): Promise<boolean> {
  return (await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).code === 0;
}

async function readHeadline(git: GitFn, ref: string, stamp: string): Promise<string | null> {
  const shown = await git(["show", `${ref}:${gateExitNotePath(stamp)}`]);
  if (shown.code !== 0) return null;
  const first = shown.stdout.split("\n")[0]?.trim() ?? "";
  return first || null;
}

/** Where the branch of one stamp lives: the remote-tracking ref first, then a local branch. */
async function locateBranch(
  ctx: Context,
  stamp: string,
): Promise<{ remote: string | null; local: string | null }> {
  const branch = gateExitBranch(stamp);
  const remote = ctx.hasOrigin ? `refs/remotes/origin/${branch}` : null;
  const local = `refs/heads/${branch}`;
  return {
    remote: remote && (await refExists(ctx.git, remote)) ? remote : null,
    local: (await refExists(ctx.git, local)) ? local : null,
  };
}

async function baseRefsFor(ctx: Context, entry: GateExitEntry | undefined): Promise<GateExitRefs> {
  const requested = entry?.base && isSafeBaseRef(entry.base) ? entry.base : undefined;
  return resolveGateExitRefs(ctx.git, ctx.hasOrigin, requested);
}

function shortRef(ref: string): string {
  return ref.replace(/^refs\/remotes\//, "").replace(/^refs\/heads\//, "");
}

export async function groundControlStatus(input: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  exec?: ExecFn;
}): Promise<GroundControlStatus | string> {
  const env = input.env ?? process.env;
  const ctx = await openContext(input.cwd, env, input.exec ?? defaultExec);
  if (typeof ctx === "string") return ctx;
  const warnings: string[] = [];
  const fetchError = await fetchOrigin(ctx);
  if (fetchError) warnings.push(`${fetchError}; showing the last fetched state`);

  const marker = await readGateExitMarker(ctx.root);
  const entries = marker.kind === "ok" ? marker.marker.pending : [];
  const refs = await resolveGateExitRefs(ctx.git, ctx.hasOrigin);
  const listed = await listGateExitBranches(ctx.git, refs);
  const local = ctx.hasOrigin
    ? await listGateExitBranches(ctx.git, {
        ...refs,
        scope: `refs/heads/${GATE_EXIT_BRANCH_PREFIX}`,
      })
    : { ok: true, branches: [] };

  const stamps = new Set<string>(entries.map((e) => e.stamp));
  for (const short of [...listed.branches, ...local.branches]) {
    const stamp = stampOfBranch(short);
    if (stamp) stamps.add(stamp);
  }

  const tickets: GroundControlTicket[] = [];
  for (const stamp of [...stamps].sort()) {
    const entry = entries.find((e) => e.stamp === stamp);
    const where = await locateBranch(ctx, stamp);
    const branchRef = where.remote ?? where.local;
    const ticketRefs = await baseRefsFor(ctx, entry);
    let branchState: TicketBranchState = "none";
    if (branchRef) {
      branchState = (await isTicketMerged(ctx.git, branchRef, ticketRefs.baseRef, stamp))
        ? "merged"
        : "unmerged";
    }
    // A merged branch with no marker entry is history, not a ticket.
    if (!entry && branchState === "merged") continue;
    const headline =
      (branchRef ? await readHeadline(ctx.git, branchRef, stamp) : null) ??
      (await readHeadline(ctx.git, ticketRefs.baseRef, stamp));
    tickets.push({
      stamp,
      headline,
      askId: entry?.askId ?? null,
      labels: entry?.labels ?? [],
      trigger: entry?.trigger ?? null,
      openedAt: entry?.openedAt ?? null,
      url: entry?.url ?? null,
      branch: branchRef ? shortRef(branchRef) : null,
      branchState,
      inMarker: Boolean(entry),
    });
  }

  return {
    marker: marker.kind,
    ...(marker.kind === "invalid" ? { markerDetail: marker.detail } : {}),
    base: refs.base,
    tickets,
    skipped: marker.kind === "ok" ? marker.marker.skipped : [],
    warnings,
  };
}

export function formatGroundControlStatus(status: GroundControlStatus): string {
  const lines: string[] = [];
  const n = status.tickets.length;
  lines.push(
    n === 0
      ? "Ground Control: no pending operator ticket."
      : `Ground Control: ${n} pending operator ticket${n === 1 ? "" : "s"} (base ${status.base}).`,
  );
  for (const t of status.tickets) {
    lines.push("");
    lines.push(`- ${t.stamp}: ${t.headline?.replace(/^#\s*/, "") ?? "(note not readable)"}`);
    if (t.askId) {
      lines.push(
        `  Ask id: ${t.askId}${t.labels.length ? ` | labels: ${t.labels.join(" / ")}` : ""}`,
      );
    }
    const branch =
      t.branchState === "none"
        ? "no gate-exit branch"
        : `${t.branch} (${t.branchState === "merged" ? "merged; accept to close the ticket" : "not merged"})`;
    lines.push(`  Branch: ${branch}${t.url ? ` | review: ${t.url}` : ""}`);
    if (!t.inMarker)
      lines.push(
        `  Not in ${GATE_EXIT_MARKER_RELPATH} (Countdown refuses until it is merged or discarded)`,
      );
  }
  lines.push("");
  if (status.marker === "invalid") {
    lines.push(
      `Marker: ${GATE_EXIT_MARKER_RELPATH} is unreadable (${status.markerDetail ?? "?"}).`,
    );
  } else if (status.marker === "absent") {
    lines.push(`Marker: ${GATE_EXIT_MARKER_RELPATH} absent.`);
  } else {
    const pending = status.tickets.filter((t) => t.inMarker).length;
    lines.push(
      `Marker: ${GATE_EXIT_MARKER_RELPATH}, ${pending} pending entr${pending === 1 ? "y" : "ies"}.`,
    );
  }
  if (status.skipped.length > 0) {
    lines.push(`Skipped runs: ${status.skipped.length} (latest: ${status.skipped.at(-1)}).`);
  }
  for (const w of status.warnings) lines.push(`Warning: ${w}`);
  if (n > 0) {
    lines.push(
      "Next: read the note, then `agent-kit ground-control accept <stamp>` once merged, or `discard <stamp>`.",
    );
  }
  return `${lines.join("\n")}\n`;
}

export interface TriageInput {
  cwd: string;
  stamp: string;
  env?: NodeJS.ProcessEnv;
  exec?: ExecFn;
  which?: (bin: string) => Promise<string | null>;
  log?: (line: string) => void;
}

export interface TriageResult {
  exitCode: number;
  error?: string;
}

/** Remove one stamp's entry; `skipped` records stay readable for `status`. */
async function clearEntry(root: string, stamp: string): Promise<string | null> {
  const marker = await readGateExitMarker(root);
  if (marker.kind === "absent") return null;
  if (marker.kind === "invalid") {
    return `${GATE_EXIT_MARKER_RELPATH} is unreadable (${marker.detail}); left as is`;
  }
  const pending = marker.marker.pending.filter((e) => e.stamp !== stamp);
  if (pending.length === marker.marker.pending.length) return null;
  const next: GateExitMarker = { ...marker.marker, pending };
  try {
    await writeGateExitMarker(root, next);
    return null;
  } catch (err) {
    return `could not write ${GATE_EXIT_MARKER_RELPATH}: ${String(err)}`;
  }
}

async function prepareTriage(
  input: TriageInput,
): Promise<
  | { ok: true; ctx: Context; entry: GateExitEntry | undefined; log: (line: string) => void }
  | { ok: false; result: TriageResult }
> {
  if (!isGateExitStamp(input.stamp)) {
    return {
      ok: false,
      result: {
        exitCode: GROUND_CONTROL_EXIT.usage,
        error: `invalid stamp: expected YYYYMMDDTHHMMSSZ (as \`agent-kit ground-control status\` prints it)`,
      },
    };
  }
  const env = input.env ?? process.env;
  const redactions = gateExitRedactions(env);
  const log = (line: string) => input.log?.(redactSecrets(line, redactions));
  const ctx = await openContext(input.cwd, env, input.exec ?? defaultExec);
  if (typeof ctx === "string") {
    return { ok: false, result: { exitCode: GROUND_CONTROL_EXIT.usage, error: ctx } };
  }
  const marker = await readGateExitMarker(ctx.root);
  if (marker.kind === "invalid") {
    return {
      ok: false,
      result: {
        exitCode: GROUND_CONTROL_EXIT.failed,
        error: `${GATE_EXIT_MARKER_RELPATH} is unreadable (${marker.detail}); fix or remove it by hand`,
      },
    };
  }
  const fetchError = await fetchOrigin(ctx);
  if (fetchError) {
    return {
      ok: false,
      result: { exitCode: GROUND_CONTROL_EXIT.failed, error: `${fetchError}; nothing changed` },
    };
  }
  const entry =
    marker.kind === "ok" ? marker.marker.pending.find((e) => e.stamp === input.stamp) : undefined;
  return { ok: true, ctx, entry, log };
}

async function deleteBranch(
  ctx: Context,
  stamp: string,
  where: { remote: string | null; local: string | null },
  log: (line: string) => void,
): Promise<boolean> {
  const branch = gateExitBranch(stamp);
  let ok = true;
  if (where.remote) {
    const pushed = await ctx.git(["push", "--quiet", "origin", "--delete", `refs/heads/${branch}`]);
    if (pushed.code === 0) log(`deleted origin/${branch}`);
    else {
      ok = false;
      log(`could not delete origin/${branch}: ${pushed.stderr.trim().split("\n")[0] ?? ""}`);
    }
  }
  if (where.local) {
    const removed = await ctx.git(["branch", "-D", "--", branch]);
    if (removed.code === 0) log(`deleted local ${branch}`);
    else {
      ok = false;
      log(`could not delete local ${branch}: ${removed.stderr.trim().split("\n")[0] ?? ""}`);
    }
  }
  return ok;
}

/**
 * `accept <stamp>`: the ticket closes only when its branch is merged into the
 * base (ancestor or identical note on the base); then the branch is deleted
 * and the marker entry removed. Unmerged: exit 2, nothing changes.
 */
export async function acceptTicket(input: TriageInput): Promise<TriageResult> {
  const prep = await prepareTriage(input);
  if (!prep.ok) return prep.result;
  const { ctx, entry, log } = prep;
  const stamp = input.stamp;
  const refs = await baseRefsFor(ctx, entry);
  const where = await locateBranch(ctx, stamp);
  const branchRef = where.remote ?? where.local;

  if (branchRef) {
    if (!(await isTicketMerged(ctx.git, branchRef, refs.baseRef, stamp))) {
      log(`${shortRef(branchRef)} is not merged into ${refs.base} yet; waiting on the merge`);
      return { exitCode: GROUND_CONTROL_EXIT.waiting };
    }
    if (!(await deleteBranch(ctx, stamp, where, log))) {
      return { exitCode: GROUND_CONTROL_EXIT.failed, error: "branch not deleted; ticket kept" };
    }
  } else {
    const noteOnBase = await blobId(ctx.git, `${refs.baseRef}:${gateExitNotePath(stamp)}`);
    if (!entry) {
      return {
        exitCode: GROUND_CONTROL_EXIT.usage,
        error: `no ticket ${stamp}: not in ${GATE_EXIT_MARKER_RELPATH} and no gate-exit branch`,
      };
    }
    if (!noteOnBase && entry.branch) {
      log(
        `${entry.branch} is gone and its note is not on ${refs.base}; use \`agent-kit ground-control discard ${stamp}\``,
      );
      return { exitCode: GROUND_CONTROL_EXIT.waiting };
    }
    log(
      noteOnBase
        ? `the note of ${stamp} is on ${refs.base} (branch already deleted)`
        : `ticket ${stamp} never landed a branch; nothing to merge`,
    );
  }
  const markerError = await clearEntry(ctx.root, stamp);
  if (markerError) return { exitCode: GROUND_CONTROL_EXIT.failed, error: markerError };
  log(`accepted ${stamp}; ticket cleared`);
  return { exitCode: GROUND_CONTROL_EXIT.ok };
}

/**
 * `discard <stamp>`: close the PR/MR when an authenticated `gh`/`glab` is on
 * PATH, delete the branch (remote and local), remove the marker entry. A
 * failed delete keeps the ticket (exit 3).
 */
export async function discardTicket(input: TriageInput): Promise<TriageResult> {
  const prep = await prepareTriage(input);
  if (!prep.ok) return prep.result;
  const { ctx, entry, log } = prep;
  const stamp = input.stamp;
  const branch = gateExitBranch(stamp);
  const where = await locateBranch(ctx, stamp);
  if (!entry && !where.remote && !where.local) {
    return {
      exitCode: GROUND_CONTROL_EXIT.usage,
      error: `no ticket ${stamp}: not in ${GATE_EXIT_MARKER_RELPATH} and no gate-exit branch`,
    };
  }

  if (where.remote) {
    const which = input.which ?? ((bin: string) => findOnPath(bin, { env: ctx.env }));
    const forge = await findAuthenticatedForge({
      originUrl: ctx.originUrl,
      cwd: ctx.root,
      exec: ctx.exec,
      which,
      env: ctx.env,
      log,
    });
    if (forge) {
      const closed =
        forge.forge === "gh"
          ? await ctx.exec(
              forge.bin,
              ["pr", "close", branch, "--comment", "Discarded with agent-kit ground-control."],
              { cwd: ctx.root, env: ctx.env },
            )
          : await ctx.exec(forge.bin, ["mr", "close", branch], { cwd: ctx.root, env: ctx.env });
      log(
        closed.code === 0
          ? `${forge.forge === "gh" ? "PR" : "MR"} for ${branch} closed`
          : `${forge.forge} could not close the review for ${branch} (${closed.stderr.trim().split("\n")[0] ?? ""}); deleting the branch closes it on most forges`,
      );
    } else {
      log("no authenticated gh/glab; the review closes when its branch is deleted");
    }
  }
  if (!(await deleteBranch(ctx, stamp, where, log))) {
    return { exitCode: GROUND_CONTROL_EXIT.failed, error: "branch not deleted; ticket kept" };
  }
  const markerError = await clearEntry(ctx.root, stamp);
  if (markerError) return { exitCode: GROUND_CONTROL_EXIT.failed, error: markerError };
  log(`discarded ${stamp}; ticket cleared`);
  return { exitCode: GROUND_CONTROL_EXIT.ok };
}

const cwdArg = {
  type: "string" as const,
  description: "Project root (default: current directory)",
  default: process.cwd(),
};

const stampArg = {
  type: "positional" as const,
  description: "Gate-exit stamp (YYYYMMDDTHHMMSSZ, as `status` prints it)",
  required: true,
};

/**
 * The error line `accept` / `discard` / `status` print, redacted like every
 * other Ground Control line (a fetch stderr or a marker error can carry a
 * token from the environment or a remote URL).
 */
export function groundControlErrorText(
  error: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return redactSecrets(error, gateExitRedactions(env));
}

function report(result: TriageResult): void {
  if (result.error) logger.error(groundControlErrorText(result.error));
  process.exitCode = result.exitCode;
}

export const groundControlCommand = defineCommand({
  meta: {
    name: "ground-control",
    description:
      "Ground Control: triage gate exits. status lists pending operator tickets; accept <stamp> clears a merged one; discard <stamp> closes and deletes it. Never merges, never git-prod.",
  },
  subCommands: {
    status: defineCommand({
      meta: {
        name: "status",
        description: "List pending operator tickets, gate-exit branches and skipped runs",
      },
      args: {
        cwd: cwdArg,
        json: { type: "boolean", description: "Print JSON", default: false },
      },
      async run({ args }) {
        const status = await groundControlStatus({ cwd: String(args.cwd) });
        if (typeof status === "string") {
          logger.error(groundControlErrorText(status));
          process.exitCode = GROUND_CONTROL_EXIT.usage;
          return;
        }
        const env = process.env;
        const text = args.json
          ? `${JSON.stringify(status, null, 2)}\n`
          : formatGroundControlStatus(status);
        process.stdout.write(redactSecrets(text, gateExitRedactions(env)));
      },
    }),
    accept: defineCommand({
      meta: {
        name: "accept",
        description:
          "Clear a ticket whose gate-exit branch is merged into the base, deleting the branch (exit 2 while unmerged)",
      },
      args: { stamp: stampArg, cwd: cwdArg },
      async run({ args }) {
        report(
          await acceptTicket({
            cwd: String(args.cwd),
            stamp: String(args.stamp),
            log: (line) => logger.info(`ground-control: ${line}`),
          }),
        );
      },
    }),
    discard: defineCommand({
      meta: {
        name: "discard",
        description: "Close the PR/MR (gh/glab), delete the gate-exit branch and clear the ticket",
      },
      args: { stamp: stampArg, cwd: cwdArg },
      async run({ args }) {
        report(
          await discardTicket({
            cwd: String(args.cwd),
            stamp: String(args.stamp),
            log: (line) => logger.info(`ground-control: ${line}`),
          }),
        );
      },
    }),
  },
});
