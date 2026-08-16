#!/usr/bin/env node
/**
 * Local Mission Kit comms drafts. Never posts to a network.
 *
 *   node .cursor/scripts/comms-draft.mjs --kind recap --channel x
 *   node .cursor/scripts/comms-draft.mjs --publish   # always exits 2
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KINDS = new Set(["recap", "release", "contributor-ask"]);
const CHANNELS = new Set(["x", "medium", "substack", "hn", "github", "site"]);
const PUBLISH_REFUSE = "publish refused: comms-draft never posts; operator Ask then human publish";

export function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function draftId(kind, channel, day) {
  return `${kind}-${channel}-${day}`;
}

export function parseArgs(argv) {
  const out = {
    kind: "recap",
    channel: "x",
    version: "5.0.0",
    publish: false,
    forceNew: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--publish") out.publish = true;
    else if (a === "--force-new") out.forceNew = true;
    else if (a === "--kind") out.kind = argv[++i] ?? out.kind;
    else if (a === "--channel") out.channel = argv[++i] ?? out.channel;
    else if (a === "--version") out.version = argv[++i] ?? out.version;
    else if (a.startsWith("--kind=")) out.kind = a.slice("--kind=".length);
    else if (a.startsWith("--channel=")) out.channel = a.slice("--channel=".length);
    else if (a.startsWith("--version=")) out.version = a.slice("--version=".length);
  }
  return out;
}

export function validate(opts) {
  if (!KINDS.has(opts.kind)) return `unknown --kind ${opts.kind}`;
  if (!CHANNELS.has(opts.channel)) return `unknown --channel ${opts.channel}`;
  if (opts.publish) return PUBLISH_REFUSE;
  return null;
}

/** Redact any accidental secret-shaped assignment in draft bodies. */
export function redactSecrets(text) {
  return text.replace(
    /\b(MISSION_KIT_COMMS_[A-Z0-9_]+|BEARER|TOKEN|WEBHOOK|PASSWORD|SECRET)\s*=\s*\S+/gi,
    "$1=<redacted>",
  );
}

export function renderDraft(opts, day) {
  const id = draftId(opts.kind, opts.channel, day);
  const version = opts.version;
  const bodies = {
    recap: `Mission Kit recap (${day})\n\nShipped this cycle: fill from CHANGELOG [Unreleased] that is already in staging.\n\nInstall: npx @dadado/agent-kit-cli@${version} install\nSite: https://missionkit.io\nHITL: production still needs a human yes.\n`,
    release: `Mission Kit ${version} / Agent Kit CLI @${version}\n\nnpx @dadado/agent-kit-cli@${version} install\nhttps://missionkit.io\nPolyForm Noncommercial; commercial: sales@missionkit.io\n`,
    "contributor-ask":
      "Help Mission Kit: skills under registry/skills/community/, or agent-kit contribute from a consumer project.\nIssues: https://github.com/agent-kit-startup/agent-kit\nDo not use public issues for vulnerabilities (SECURITY.md).\nCursor Marketplace submit is not this ask.\n",
  };
  const body = redactSecrets(bodies[opts.kind]);
  return {
    id,
    kind: opts.kind,
    channel: opts.channel,
    version,
    day,
    hitl: "pending",
    body,
  };
}

export function draftsDir(repoRoot) {
  return join(repoRoot, ".cursor", "comms-drafts");
}

export function writeDraft(repoRoot, draft, { forceNew = false } = {}) {
  const dir = draftsDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${draft.id}.json`);
  if (existsSync(file) && !forceNew) {
    return { path: file, reused: true, draft: JSON.parse(readFileSync(file, "utf8")) };
  }
  const payload = `${JSON.stringify(draft, null, 2)}\n`;
  writeFileSync(file, payload, "utf8");
  return { path: file, reused: false, draft };
}

function printHelp() {
  process.stdout.write(`comms-draft: local drafts only (never publishes)

Options:
  --kind recap|release|contributor-ask
  --channel x|medium|substack|hn|github|site
  --version 5.0.0
  --force-new
  --publish   refused (exit 2)
`);
}

export function main(argv, repoRoot) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  const err = validate(opts);
  if (err) {
    process.stderr.write(`${err}\n`);
    return opts.publish ? 2 : 1;
  }
  const day = utcDay();
  const draft = renderDraft(opts, day);
  const result = writeDraft(repoRoot, draft, { forceNew: opts.forceNew });
  process.stdout.write(`${result.reused ? "reused" : "wrote"} ${result.path}\n`);
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  process.exitCode = main(process.argv.slice(2), root);
}
