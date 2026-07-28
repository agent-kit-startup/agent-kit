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
#
# Called from /run-plan tick close and /run-plan-all queue-complete.
# Never /git-prod. Does not stage the ledger (gitignored).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LEDGER_REL=".cursor/context/field-report-cadence.json"
CONFIG="$ROOT/.cursor/context/config.json"
ACTION="${1:-}"

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

if [[ -z "$ACTION" || "$ACTION" == "-h" || "$ACTION" == "--help" ]]; then
  usage
  exit 0
fi

case "$ACTION" in
  tick|batch-complete|clear) ;;
  *)
    echo "error: unknown action: $ACTION (tick | batch-complete | clear)" >&2
    exit 2
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "error: node required to bump cadence ledger" >&2
  exit 2
fi

node --input-type=module - "$ROOT" "$ACTION" "$LEDGER_REL" "$CONFIG" <<'NODE'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, action, ledgerRel, configPath] = process.argv.slice(2);
const sm = await import(pathToFileURL(join(root, "dashboard/lib/semantic-model.mjs")).href);
const {
  parseCadenceLedger,
  serializeCadenceLedger,
  parseFieldReportReviewCadenceConfig,
  listUnreviewedReviewTargets,
  recordCadenceTickClose,
  recordCadenceBatchComplete,
  clearCadenceWarning,
  parseHandoffMarkdown,
  parseExternalReport,
  EXTERNAL_REPORT_FILE_RE,
} = sm;

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
