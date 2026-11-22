#!/usr/bin/env node
/**
 * Paste-ready profile kits, one per network and name, from docs/community/presence-source.json.
 * Factory-only, same family as comms-draft.mjs. Writes only under .cursor/comms-drafts/presence/
 * (gitignored). Never creates an account and never calls a network.
 *
 *   node .cursor/scripts/presence-kits.mjs                 # every network and name
 *   node .cursor/scripts/presence-kits.mjs --network mastodon
 *   node .cursor/scripts/presence-kits.mjs --check         # validate only, write nothing
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_PATH = "docs/community/presence-source.json";
export const PRESENCE_DOC = "docs/comms-presence.md";
const NOT_VERIFIED = "not verified";
// En dash and em dash, by code point so the source stays ASCII.
const DASH_RE = /[\u2013\u2014]/;

/**
 * Field limits are filled only from an official page checked on the date given (see
 * docs/comms-presence.md). A null limit means the kit shows both bios and asks the
 * operator to watch the field counter at signup.
 */
export const NETWORKS = [
  { key: "github", label: "GitHub", names: ["suite", "outpost", "oligarchy"] },
  {
    key: "x",
    label: "X",
    names: ["suite", "outpost", "oligarchy"],
    note: "Product account exists (@missionKitAgent); keep it for the suite.",
  },
  {
    key: "bluesky",
    label: "Bluesky",
    names: ["suite", "outpost", "oligarchy"],
    note: "Prefer the missionkit.io domain handle (DNS TXT record at signup).",
  },
  {
    key: "reddit",
    label: "Reddit",
    names: ["suite"],
    note: "Community r/missionkit, moderated by the operator; no brand posting automation.",
  },
  {
    key: "mastodon",
    label: "Mastodon (own instance)",
    names: ["suite", "outpost", "oligarchy"],
    limits: { displayName: 30, bio: 500 },
    images: { avatar: "400x400, up to 2 MB", banner: "1500x500, up to 2 MB" },
    limitsSource:
      "https://docs.joinmastodon.org/user/profile/ (checked 2026-11-21; Mastodon instance defaults)",
    note: "Limits are Mastodon defaults; if the instance runs GoToSocial (Ask fediverse-software, deferred 2026-11-21), check its field counters instead.",
  },
  { key: "threads", label: "Threads", names: ["suite", "outpost", "oligarchy"] },
  { key: "linkedin", label: "LinkedIn page", names: ["suite", "outpost", "oligarchy"] },
  { key: "substack", label: "Substack", names: ["suite", "outpost", "oligarchy"] },
  {
    key: "youtube",
    label: "YouTube",
    names: ["suite", "outpost", "oligarchy"],
    handleRule: { min: 3, max: 30 },
    limitsSource:
      "https://support.google.com/youtube/answer/11585688 (handle rules, checked 2026-11-21)",
  },
  { key: "devto", label: "dev.to", names: ["suite", "outpost", "oligarchy"] },
  { key: "hashnode", label: "Hashnode", names: ["suite"] },
  {
    key: "producthunt",
    label: "Product Hunt",
    names: ["suite", "outpost", "oligarchy"],
    note: "Maker page on the operator's personal account; company accounts cannot post.",
  },
  { key: "dailydev", label: "daily.dev Squad", names: ["suite"] },
  { key: "tabnews", label: "TabNews", names: ["suite", "outpost", "oligarchy"] },
  { key: "matrix", label: "Matrix", names: ["suite", "outpost", "oligarchy"] },
  { key: "telegram", label: "Telegram", names: ["suite", "outpost", "oligarchy"] },
  { key: "instagram", label: "Instagram", names: ["suite", "outpost", "oligarchy"] },
  { key: "tiktok", label: "TikTok", names: ["suite", "outpost", "oligarchy"] },
  { key: "farcaster", label: "Farcaster", names: ["suite", "outpost", "oligarchy"] },
  { key: "lens", label: "Lens", names: ["suite", "outpost", "oligarchy"] },
  { key: "paragraph", label: "Paragraph", names: ["suite", "outpost", "oligarchy"] },
];

export function loadSource(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, SOURCE_PATH), "utf8"));
}

export function validateSource(source) {
  const errors = [];
  for (const [key, n] of Object.entries(source.names ?? {})) {
    for (const f of ["displayName", "shortBio", "longBio"]) {
      if (!n[f]) errors.push(`${key}: missing ${f}`);
      else if (DASH_RE.test(n[f]))
        errors.push(`${key}.${f}: uses a dash character; rewrite the sentence`);
    }
    if (!n.handles?.length) errors.push(`${key}: no handles`);
    if (!n.links?.length) errors.push(`${key}: no links`);
    if (n.shortBio && n.longBio && n.shortBio.length > n.longBio.length)
      errors.push(`${key}: shortBio longer than longBio`);
  }
  for (const net of NETWORKS) {
    for (const name of net.names)
      if (!source.names?.[name]) errors.push(`network ${net.key}: unknown name ${name}`);
  }
  return errors;
}

/** Pick the longest bio that fits; never truncate silently. */
export function pickBio(name, limit) {
  if (limit == null) return { bio: null, problem: null };
  if (name.longBio.length <= limit) return { bio: name.longBio, problem: null };
  if (name.shortBio.length <= limit) return { bio: name.shortBio, problem: null };
  return {
    bio: null,
    problem: `both bios exceed the ${limit}-character limit; shorten the source`,
  };
}

export function buildKit(net, nameKey, name) {
  const limits = net.limits ?? {};
  const problems = [];
  const handles = name.handles.filter((h) => {
    if (!net.handleRule) return true;
    return h.length >= net.handleRule.min && h.length <= net.handleRule.max;
  });
  if (!handles.length) problems.push("no handle candidate fits the handle rule");
  if (limits.displayName != null && name.displayName.length > limits.displayName) {
    problems.push(`display name exceeds ${limits.displayName} characters`);
  }
  const { bio, problem } = pickBio(name, limits.bio);
  if (problem) problems.push(problem);
  return {
    network: net.key,
    label: net.label,
    name: nameKey,
    handles,
    displayName: name.displayName,
    bio,
    shortBio: name.shortBio,
    longBio: name.longBio,
    bioLimit: limits.bio ?? null,
    displayNameLimit: limits.displayName ?? null,
    links: name.links,
    avatar: name.avatar,
    banner: name.banner,
    images: net.images ?? null,
    limitsSource: net.limitsSource ?? null,
    note: net.note ?? null,
    problems,
  };
}

export function buildKits(source, { network = null } = {}) {
  const kits = [];
  for (const net of NETWORKS) {
    if (network && net.key !== network) continue;
    for (const nameKey of net.names) kits.push(buildKit(net, nameKey, source.names[nameKey]));
  }
  return kits;
}

export function renderKit(kit, checked) {
  const lines = [
    `# ${kit.label}: ${kit.displayName} profile kit`,
    "",
    `Generated from ${SOURCE_PATH} (copy checked ${checked}). Paste during account creation; record the created URL in ${PRESENCE_DOC}.`,
    "",
    `- Handle (first free, in order): ${kit.handles.map((h) => `\`${h}\``).join(", ") || "none"}`,
    `- Display name: ${kit.displayName} (limit: ${kit.displayNameLimit ?? NOT_VERIFIED})`,
  ];
  if (kit.bio) lines.push(`- Bio (${kit.bio.length}/${kit.bioLimit}): ${kit.bio}`);
  else {
    lines.push(
      `- Bio limit: ${kit.bioLimit ?? NOT_VERIFIED}; use the long bio if the field counter allows, else the short one`,
    );
    lines.push(`  - Long (${kit.longBio.length}): ${kit.longBio}`);
    lines.push(`  - Short (${kit.shortBio.length}): ${kit.shortBio}`);
  }
  lines.push(`- Links: ${kit.links.join(", ")}`);
  lines.push(`- Avatar source: ${kit.avatar} (size: ${kit.images?.avatar ?? NOT_VERIFIED})`);
  lines.push(`- Banner source: ${kit.banner} (size: ${kit.images?.banner ?? NOT_VERIFIED})`);
  if (kit.limitsSource) lines.push(`- Limits source: ${kit.limitsSource}`);
  if (kit.note) lines.push(`- Note: ${kit.note}`);
  lines.push(
    "- Account: created by the operator; 2FA and recovery codes go to the password manager only.",
  );
  for (const p of kit.problems) lines.push(`- PROBLEM: ${p}`);
  return `${lines.join("\n")}\n`;
}

export function kitsDir(repoRoot) {
  return join(repoRoot, ".cursor", "comms-drafts", "presence");
}

export function writeKits(repoRoot, kits, checked) {
  const dir = kitsDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  return kits.map((k) => {
    const file = join(dir, `${k.network}-${k.name}.md`);
    writeFileSync(file, renderKit(k, checked), "utf8");
    return file;
  });
}

export function parseArgs(argv) {
  const out = { network: null, check: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--check") out.check = true;
    else if (a === "--network") out.network = argv[++i] ?? null;
  }
  return out;
}

export function main(argv, { repoRoot, out = process.stdout, err = process.stderr } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    out.write(
      `presence-kits: paste-ready profile kits from ${SOURCE_PATH}\n\n  --network <key>  one network (${NETWORKS.map((n) => n.key).join(", ")})\n  --check          validate only\n`,
    );
    return 0;
  }
  if (opts.network && !NETWORKS.some((n) => n.key === opts.network)) {
    err.write(`unknown --network ${opts.network}\n`);
    return 1;
  }
  const source = loadSource(repoRoot);
  const errors = validateSource(source);
  const kits = buildKits(source, { network: opts.network });
  for (const k of kits) for (const p of k.problems) errors.push(`${k.network}/${k.name}: ${p}`);
  if (errors.length) {
    err.write(`${errors.join("\n")}\n`);
    return 1;
  }
  if (opts.check) {
    out.write(`ok: ${kits.length} kit(s)\n`);
    return 0;
  }
  const files = writeKits(repoRoot, kits, source.checked);
  out.write(`wrote ${files.length} kit(s) under ${kitsDir(repoRoot)}\n`);
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  process.exitCode = main(process.argv.slice(2), { repoRoot: root });
}
