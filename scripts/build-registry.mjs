#!/usr/bin/env node
/**
 * Build registry/registry.json (schemaVersion 2) from skills under
 * registry/skills/{core,community}/ and packs under registry/packs/.
 *
 * Usage: node scripts/build-registry.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readSkillMeta(skillDir) {
  const skillMd = path.join(skillDir, "SKILL.md");
  const raw = await readFile(skillMd, "utf8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  const get = (key) => {
    if (!fm) return "";
    const m = fm[1].match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
    return m ? m[1].trim() : "";
  };
  const id = path.basename(skillDir);
  const meta = {
    id,
    title: get("name") || id,
    description: get("description") || "",
    path: path.relative(root, skillDir).split(path.sep).join("/"),
  };
  const version = get("version");
  const category = get("category");
  if (version) meta.version = version;
  if (category) meta.category = category;
  return meta;
}

async function listSkillTier(tier) {
  const dir = path.join(root, "registry", "skills", tier);
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    out.push(await readSkillMeta(path.join(dir, e.name)));
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function listPacks() {
  const packsRoot = path.join(root, "registry", "packs");
  const entries = await readdir(packsRoot, { withFileTypes: true });
  const packs = [];
  const artifacts = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const packPath = path.join(packsRoot, e.name);
    const manifest = JSON.parse(await readFile(path.join(packPath, "pack.json"), "utf8"));
    packs.push({
      id: manifest.id,
      title: manifest.title,
      description: manifest.description,
      version: manifest.version,
      path: path.relative(root, packPath).split(path.sep).join("/"),
    });
    for (const m of manifest.members ?? []) {
      artifacts.push({
        kind: m.kind,
        id: m.id,
        path: m.source,
        pack: manifest.id,
        layer: "L1",
      });
    }
  }

  packs.sort((a, b) => a.id.localeCompare(b.id));
  artifacts.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  return { packs, artifacts };
}

const core = await listSkillTier("core");
const community = await listSkillTier("community");
const { packs, artifacts } = await listPacks();

const index = {
  schemaVersion: 2,
  skills: { core, community },
  packs,
  artifacts,
};

const outPath = path.join(root, "registry", "registry.json");
await writeFile(outPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${outPath} (skills: ${core.length + community.length}, packs: ${packs.length}, artifacts: ${artifacts.length})`,
);
