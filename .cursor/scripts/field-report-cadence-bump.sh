#!/usr/bin/env bash
# field-report-cadence-bump.sh - bump / clear Field Report activity cadence ledger.
#
# ADR: .cursor/memory/decisions/2026-07-27_field-report-activity-review-cadence.md
# Ledger: .cursor/context/field-report-cadence.json (gitignored)
#
# Usage:
#   .cursor/scripts/field-report-cadence-bump.sh tick
#   .cursor/scripts/field-report-cadence-bump.sh batch-complete
#   .cursor/scripts/field-report-cadence-bump.sh clear
#   .cursor/scripts/field-report-cadence-bump.sh classify [--survival]
#
# Called from /run-plan tick close and /run-plan-all queue-complete.
# classify prints the owed plans with one class and evidence line each and
# writes nothing; --survival adds git blame survival of the merge SHAs named
# in to-do evidence (on demand at triage only, never from Mission Control).
# Never /git-prod. Does not stage the ledger (gitignored).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LEDGER_REL=".cursor/context/field-report-cadence.json"
CONFIG="$ROOT/.cursor/context/config.json"
ACTION="${1:-}"
SURVIVAL="${2:-}"

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
}

if [[ -z "$ACTION" || "$ACTION" == "-h" || "$ACTION" == "--help" ]]; then
  usage
  exit 0
fi

case "$ACTION" in
  tick|batch-complete|clear|classify) ;;
  *)
    echo "error: unknown action: $ACTION (tick | batch-complete | clear | classify)" >&2
    exit 2
    ;;
esac

if [[ -n "$SURVIVAL" && ( "$ACTION" != "classify" || "$SURVIVAL" != "--survival" ) ]]; then
  echo "error: unexpected argument: $SURVIVAL (only classify takes --survival)" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node required to bump cadence ledger" >&2
  exit 2
fi

node --input-type=module - "$ROOT" "$ACTION" "$LEDGER_REL" "$CONFIG" "$SURVIVAL" <<'NODE'
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, action, ledgerRel, configPath, survivalFlag] = process.argv.slice(2);

// semantic-model.mjs lives in the repo only in the factory; consumers get it
// inside the installed @dadado/agent-kit-cli package (files: dashboard).
const SM_REL = join("dashboard", "lib", "semantic-model.mjs");
function findUp(start, levels) {
  let dir = start;
  for (let i = 0; i <= levels; i++) {
    const candidate = join(dir, SM_REL);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function fromAgentKitBinary() {
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    const bin = join(dir, "agent-kit");
    if (!existsSync(bin)) continue;
    try {
      const found = findUp(dirname(realpathSync(bin)), 3);
      if (found) return found;
    } catch {}
  }
  return null;
}
function fromNpmGlobalRoot() {
  try {
    const npmRoot = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const candidate = join(npmRoot, "@dadado", "agent-kit-cli", SM_REL);
    return npmRoot && existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
const smPath = [join(root, SM_REL)].find((p) => existsSync(p)) || fromAgentKitBinary() || fromNpmGlobalRoot();
if (!smPath) {
  console.error(
    `warning: field-report cadence skipped (${action}): ${SM_REL} not found in the repo or the installed @dadado/agent-kit-cli package; install or update the CLI`,
  );
  process.exit(0);
}
const sm = await import(pathToFileURL(smPath).href);
const {
  parseCadenceLedger,
  serializeCadenceLedger,
  parseFieldReportReviewCadenceConfig,
  listUnreviewedReviewTargets,
  attachTodoEvidenceRefs,
  classifyOwedPlan,
  planDeliveryRefs,
  resolvePlanLifecycle,
  recordCadenceTickClose,
  recordCadenceBatchComplete,
  clearCadenceWarning,
  parseHandoffMarkdown,
  parseExternalReport,
  EXTERNAL_REPORT_FILE_RE,
} = sm;
const SM_REQUIRED = [
  "parseCadenceLedger", "serializeCadenceLedger", "parseFieldReportReviewCadenceConfig",
  "listUnreviewedReviewTargets", "attachTodoEvidenceRefs", "classifyOwedPlan", "planDeliveryRefs",
  "resolvePlanLifecycle", "recordCadenceTickClose", "recordCadenceBatchComplete", "clearCadenceWarning",
  "parseHandoffMarkdown", "parseExternalReport", "EXTERNAL_REPORT_FILE_RE",
];
const smMissing = SM_REQUIRED.filter((name) => sm[name] === undefined);
if (smMissing.length) {
  console.error(
    `warning: field-report cadence skipped (${action}): ${smPath} lacks ${smMissing.join(", ")}; update the agent-kit CLI to match this script`,
  );
  process.exit(0);
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function collectPlans() {
  const dir = join(root, ".cursor/plans");
  if (!existsSync(dir)) return [];
  const plans = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".plan.md")) continue;
    const full = join(dir, name);
    let content = "";
    try {
      content = readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    const todos = [];
    let overview = "";
    let id = name.replace(/\.plan\.md$/i, "");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      if (nameMatch) id = nameMatch[1].trim();
      const overviewMatch = fm.match(/^overview:\s*"(.+)"$/m);
      if (overviewMatch) overview = overviewMatch[1];
      const todoRegex = /^\s*-\s+id:\s*(\S+)\s*\n\s*content:\s*"(.+)"\s*\n\s*status:\s*(\S+)/gm;
      for (const m of fm.matchAll(todoRegex)) {
        todos.push({ id: m[1], content: m[2], status: m[3] });
      }
      attachTodoEvidenceRefs(fm, todos);
    }
    plans.push({
      id,
      file: name,
      path: `.cursor/plans/${name}`,
      overview,
      todos: {
        total: todos.length,
        completed: todos.filter((t) => t.status === "completed").length,
        pending: todos.filter((t) => t.status === "pending").length,
        inProgress: todos.filter((t) => t.status === "in_progress").length,
        items: todos,
      },
    });
  }
  return plans;
}

function collectArchived() {
  const dir = join(root, ".cursor/plans/archive");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".plan.md"));
}

function collectReports() {
  const dir = join(root, ".cursor/memory");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!EXTERNAL_REPORT_FILE_RE.test(name)) continue;
    const full = join(dir, name);
    let content = "";
    try {
      content = readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    const parsed = parseExternalReport({
      file: name,
      content,
      path: `.cursor/memory/${name}`,
    });
    if (parsed) out.push(parsed);
  }
  return out;
}

function git(args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * Blame survival of merge SHAs: lines each commit added (numstat, no renames)
 * against lines HEAD still blames on it. SHAs that are not commits reachable
 * from HEAD are skipped (a PR head SHA is not the merge), and so are merge
 * commits (blame credits their lines to the merged commits). The same patch
 * landed twice (cherry-pick) counts once by `git patch-id --stable`, while
 * blame on either copy counts as alive. A file renamed since delivery reads
 * as gone, so the figure is a lower bound. Argv only, -z paths.
 */
function deliverySurvival(shas) {
  const commits = [];
  for (const short of shas) {
    let full = "";
    try {
      full = git(["rev-parse", "--verify", "--quiet", `${short}^{commit}`]).trim();
      git(["merge-base", "--is-ancestor", full, "HEAD"]);
      const parents = git(["rev-list", "--parents", "-n", "1", full]).trim().split(/\s+/);
      if (parents.length > 2) continue;
    } catch {
      continue;
    }
    if (full && !commits.includes(full)) commits.push(full);
  }
  if (commits.length === 0) return null;
  const patchIds = new Set();
  const counted = [];
  for (const sha of commits) {
    let patchId = sha;
    try {
      patchId =
        execFileSync("git", ["-C", root, "patch-id", "--stable"], {
          input: git(["show", sha]),
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"],
        }).split(" ")[0] || sha;
    } catch {
      patchId = sha;
    }
    if (patchIds.has(patchId)) continue;
    patchIds.add(patchId);
    counted.push(sha);
  }
  let added = 0;
  const files = new Set();
  for (const sha of counted) {
    const out = git(["show", "--numstat", "-z", "--no-renames", "--format=", sha]);
    for (const rec of out.split("\0")) {
      const m = /^\s*(\d+|-)\t(\d+|-)\t(.+)$/s.exec(rec);
      if (!m || m[1] === "-") continue;
      added += Number(m[1]);
      files.add(m[3].trim());
    }
  }
  const wanted = new Set(commits);
  let alive = 0;
  for (const file of files) {
    let blame = "";
    try {
      blame = git(["blame", "--line-porcelain", "HEAD", "--", file]);
    } catch {
      continue;
    }
    for (const line of blame.split("\n")) {
      const head = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
      if (head && wanted.has(head[1])) alive += 1;
    }
  }
  return { added, alive, commits: commits.map((c) => c.slice(0, 8)) };
}

if (action === "classify") {
  const handoffPath = join(root, ".cursor/HANDOFF.md");
  let handoff = null;
  if (existsSync(handoffPath)) {
    try {
      handoff = parseHandoffMarkdown(readFileSync(handoffPath, "utf-8"));
    } catch {
      handoff = null;
    }
  }
  const plans = collectPlans();
  const archived = collectArchived();
  const targets = listUnreviewedReviewTargets(plans, handoff, collectReports(), archived);
  const rows = [];
  for (const t of targets) {
    if (t.kind !== "owed") continue;
    const plan = plans.find((p) => p.file === t.planFile);
    if (!plan) continue;
    const lifecycle = resolvePlanLifecycle(t.planFile, plans, handoff, archived);
    let survival = null;
    if (survivalFlag === "--survival") {
      survival = deliverySurvival(planDeliveryRefs(plan).shas);
    }
    const verdict = classifyOwedPlan(plan, lifecycle, { survival });
    rows.push({ planFile: t.planFile, lifecycle, ...verdict, survival });
  }
  process.stdout.write(
    JSON.stringify({ action, survival: survivalFlag === "--survival", plans: rows }, null, 2) + "\n",
  );
  process.exit(0);
}

const ledgerPath = join(root, ledgerRel);
const prev = parseCadenceLedger(readJson(ledgerPath));
const cadenceConfig = parseFieldReportReviewCadenceConfig(readJson(configPath));

let next = prev;
if (action === "clear") {
  next = clearCadenceWarning(prev);
} else {
  const handoffPath = join(root, ".cursor/HANDOFF.md");
  let handoff = null;
  if (existsSync(handoffPath)) {
    try {
      handoff = parseHandoffMarkdown(readFileSync(handoffPath, "utf-8"));
    } catch {
      handoff = null;
    }
  }
  const plans = collectPlans();
  const targets = listUnreviewedReviewTargets(
    plans,
    handoff,
    collectReports(),
    collectArchived(),
  );
  if (action === "tick") {
    next = recordCadenceTickClose(prev, {
      enabled: cadenceConfig.enabled,
      tickThreshold: cadenceConfig.tickThreshold,
      unreviewedTargets: targets,
    });
  } else {
    next = recordCadenceBatchComplete(prev, {
      enabled: cadenceConfig.enabled,
      unreviewedTargets: targets,
    });
  }
}

mkdirSync(dirname(ledgerPath), { recursive: true });
writeFileSync(ledgerPath, serializeCadenceLedger(next), "utf-8");
process.stdout.write(
  JSON.stringify(
    {
      action,
      ticksSinceClear: next.ticksSinceClear,
      activeWarningId: next.activeWarningId,
      pendingPlanFiles: next.pendingPlanFiles,
    },
    null,
    2,
  ) + "\n",
);
NODE
