#!/usr/bin/env node
/**
 * Release mirror: posts an already-public release to each network from the /kit-prod
 * "After Done" step (ADR 2026-11-21_community-presence-discord-and-release-mirror).
 * Factory-only, local, never CI. Dry-run by default; idempotent per version and network
 * through a ledger under .cursor/comms-drafts/mirror/ (gitignored); never prints a token.
 *
 *   node .cursor/scripts/release-mirror.mjs --version 6.20.0             # dry run
 *   node .cursor/scripts/release-mirror.mjs --version 6.20.0 --apply \
 *     --done-evidence "<the /kit-prod Done line for v6.20.0>"
 *
 * A network gets a client only after its own gate (spend Ask, app approval, account, instance;
 * see docs/comms-presence.md "Release mirror candidates"). Until then its row prints `gated`
 * and nothing is sent. No network has a client today.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATE_PATH = "docs/comms-templates/release.md";
export const CHANGELOG_PATH = "CHANGELOG.md";
// Public repository that holds the GitHub Release; plan missionkit-rename-2026-11-22 moves it.
export const PUBLIC_REPO = "agent-kit-startup/agent-kit";
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * One row per network with a supported native posting path (docs/comms-presence.md).
 * `env` is the one secret per network (ADR open question (b)); public identifiers such as
 * a handle or an instance URL go in the row when the client is written, not in .env.
 * `gate` non-null means no client exists yet and nothing is sent.
 */
export const NETWORKS = [
  {
    key: "x",
    template: "short",
    env: "MISSION_KIT_COMMS_X_BEARER",
    gate: "spend Ask (X API is paid per request)",
  },
  {
    key: "bluesky",
    template: "short",
    env: "MISSION_KIT_COMMS_BLUESKY_APP_PASSWORD",
    gate: "account (to-do c7-tier1-accounts)",
  },
  {
    key: "mastodon",
    template: "english",
    env: "MISSION_KIT_COMMS_MASTODON_TOKEN",
    gate: "own instance (to-do c8b-mastodon-instance, deferred 2026-11-21)",
  },
  {
    key: "threads",
    template: "short",
    env: "MISSION_KIT_COMMS_THREADS_TOKEN",
    gate: "Threads App Review",
  },
  {
    key: "linkedin",
    template: "english",
    env: "MISSION_KIT_COMMS_LINKEDIN_TOKEN",
    gate: "LinkedIn Community Management approval and company page",
  },
  {
    key: "telegram",
    template: "english",
    env: "MISSION_KIT_COMMS_TELEGRAM_BOT_TOKEN",
    gate: "Tier 3 hold (operator activates the channel)",
  },
  {
    key: "matrix",
    template: "english",
    env: "MISSION_KIT_COMMS_MATRIX_TOKEN",
    gate: "Tier 3 hold (operator activates the room)",
  },
];

/** Discord gets the release from GitHub repository webhooks (to-do c5), not from this script. */
export const WEBHOOK_ROWS = [
  { key: "discord", note: "GitHub Release webhook into #releases (no client here)" },
];

export function parseArgs(argv) {
  const out = { version: null, apply: false, doneEvidence: null, network: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const [flag, inline] =
      a.startsWith("--") && a.includes("=")
        ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]
        : [a, undefined];
    const value = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === "--help" || flag === "-h") out.help = true;
    else if (flag === "--apply") out.apply = true;
    else if (flag === "--version") out.version = value();
    else if (flag === "--done-evidence") out.doneEvidence = value();
    else if (flag === "--network") out.network = value();
  }
  return out;
}

/** The closed CHANGELOG section for `version`, or null. [Unreleased] never counts. */
export function closedSection(changelog, version) {
  if (!VERSION_RE.test(version ?? "")) return null;
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## [")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The two text blocks of the release template, so the template stays the one source. */
export function parseTemplate(markdown) {
  const block = (heading) => {
    const at = markdown.indexOf(`## ${heading}`);
    if (at < 0) return null;
    const m = markdown.slice(at).match(/```text\n([\s\S]*?)```/);
    return m ? m[1].trimEnd() : null;
  };
  return { english: block("English"), short: block("Short (X)") };
}

export function releaseUrl(version) {
  return `https://github.com/${PUBLIC_REPO}/releases/tag/v${version}`;
}

export function renderPost(templates, kind, version) {
  const text = templates[kind];
  if (!text) throw new Error(`release template has no ${kind} block`);
  const out = text
    .replaceAll("{{version}}", version)
    .replace("{{link to CHANGELOG section or GitHub Release}}", releaseUrl(version));
  if (/\{\{[^}]+\}\}/.test(out)) throw new Error(`unresolved placeholder in the ${kind} block`);
  return out;
}

export function ledgerPath(repoRoot, version) {
  return join(repoRoot, ".cursor", "comms-drafts", "mirror", `v${version}.json`);
}

export function readLedger(repoRoot, version) {
  const file = ledgerPath(repoRoot, version);
  if (!existsSync(file)) return { version, networks: {} };
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeLedger(repoRoot, ledger) {
  const file = ledgerPath(repoRoot, ledger.version);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

/** Replace every token value we hold with <redacted> before anything is printed or stored. */
export function redact(text, env, networks = NETWORKS) {
  let out = String(text);
  for (const n of networks) {
    const v = env[n.env];
    if (v && v.length >= 4) out = out.split(v).join("<redacted>");
  }
  return out;
}

/**
 * Plan and, with apply, send. `clients` maps a network key to async ({ text, token }) => ({ url }).
 * Returns one evidence line per network, in registry order.
 */
export async function mirror({
  repoRoot,
  version,
  apply,
  doneEvidence,
  only,
  env,
  clients = {},
  networks = NETWORKS,
  now = () => new Date(),
}) {
  if (!VERSION_RE.test(version ?? "")) throw new Error("--version X.Y.Z is required");
  const changelog = readFileSync(join(repoRoot, CHANGELOG_PATH), "utf8");
  if (!closedSection(changelog, version))
    throw new Error(
      `CHANGELOG.md has no closed section [${version}]; the mirror only posts a released version`,
    );
  if (apply && !doneEvidence)
    throw new Error(
      "--apply needs --done-evidence: the /kit-prod Done line for this version is the recorded decision",
    );
  const templates = parseTemplate(readFileSync(join(repoRoot, TEMPLATE_PATH), "utf8"));
  const ledger = readLedger(repoRoot, version);
  const lines = [];
  let failed = 0;
  for (const n of networks) {
    if (only && n.key !== only) continue;
    const text = renderPost(templates, n.template, version);
    const prior = ledger.networks[n.key];
    const tag = `mirror v${version} ${n.key}:`;
    if (prior?.status === "posted") {
      lines.push(`${tag} already posted ${prior.url}`);
      continue;
    }
    const client = clients[n.key];
    if (n.gate || !client) {
      lines.push(`${tag} gated: ${n.gate ?? "no client"}`);
      continue;
    }
    if (!apply) {
      lines.push(`${tag} dry-run (${text.length} chars)`);
      continue;
    }
    const token = env[n.env];
    if (!token) {
      lines.push(`${tag} failed: ${n.env} is not set`);
      failed += 1;
      continue;
    }
    try {
      const { url } = await client({ text, token });
      ledger.networks[n.key] = {
        status: "posted",
        url,
        at: now().toISOString(),
        doneEvidence: redact(doneEvidence, env, networks),
      };
      writeLedger(repoRoot, ledger);
      lines.push(`${tag} posted ${url}`);
    } catch (err) {
      failed += 1;
      lines.push(`${tag} failed: ${redact(err?.message ?? err, env, networks)}`);
    }
  }
  if (!only) for (const w of WEBHOOK_ROWS) lines.push(`mirror v${version} ${w.key}: ${w.note}`);
  return { lines, failed };
}

const HELP = `release-mirror: post an already-public release to each network (dry-run by default)

  --version X.Y.Z          closed CHANGELOG version, live on npm and the site
  --apply                  send; needs --done-evidence
  --done-evidence "<line>" the /kit-prod Done line for this version
  --network <key>          one network only
`;

export async function main(argv, repoRoot, env = process.env) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    const { lines, failed } = await mirror({
      repoRoot,
      version: opts.version,
      apply: opts.apply,
      doneEvidence: opts.doneEvidence,
      only: opts.network,
      env,
    });
    process.stdout.write(`${lines.join("\n")}\n${opts.apply ? "" : "dry run: nothing sent\n"}`);
    return failed ? 1 : 0;
  } catch (err) {
    process.stderr.write(`${redact(err?.message ?? err, env)}\n`);
    return 1;
  }
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  process.exitCode = await main(process.argv.slice(2), root);
}
