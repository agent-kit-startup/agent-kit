/**
 * Schema validation for catalog data. Zero dependencies, no fs. Returns a list of readable
 * errors; an empty list means the catalog is valid. `validateRulesCatalog` covers what the rules
 * read; `validateCatalog` adds story screens and lessons for a full content pack.
 */
export const FAMILIES = ["electronic", "biological", "social", "economic", "political"];
export const STATUSES = ["canon", "proposed"];
export const TERRAINS = ["centre", "plain", "tundra"];
export const ACTS = [
  "title",
  "prologue",
  "first-open",
  "act-1",
  "act-2",
  "act-3",
  "milestone",
  "horizon",
];

const isText = (value) => typeof value === "string" && value.trim() !== "";
const isCount = (value) => Number.isInteger(value) && value >= 0;

function checkArt(row, label, errors) {
  if (row.art === null) {
    if (!isText(row.placeholder)) errors.push(`${label}: no art and no declared placeholder`);
  } else if (!isText(row.art)) {
    errors.push(`${label}: art must be an art id or null`);
  } else if (row.placeholder !== null) {
    errors.push(`${label}: art and placeholder are both set`);
  }
}

function checkUnique(rows, key, label, errors) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row[key])) errors.push(`${label}: duplicate ${key} ${row[key]}`);
    seen.add(row[key]);
  }
}

function checkStructure(row, errors) {
  const label = `structure ${row.id}`;
  for (const key of ["id", "name", "glyph", "blurb"]) {
    if (!isText(row[key])) errors.push(`${label}: ${key} is required`);
  }
  for (const key of ["logic", "compute", "rare"]) {
    if (!isCount(row.cost?.[key])) errors.push(`${label}: cost.${key} must be a whole number`);
  }
  if (!isCount(row.build_minutes)) errors.push(`${label}: build_minutes must be a whole number`);
  if (!isCount(row.greens)) errors.push(`${label}: greens must be a whole number`);
  if (typeof row.unique !== "boolean") errors.push(`${label}: unique must be a boolean`);
  if (!Array.isArray(row.aliases)) errors.push(`${label}: aliases must be a list`);
  if (!TERRAINS.includes(row.terrain)) errors.push(`${label}: unknown terrain ${row.terrain}`);
  if (!STATUSES.includes(row.status)) errors.push(`${label}: unknown status ${row.status}`);
  checkArt(row, label, errors);
}

function checkThreat(row, errors) {
  const label = `threat ${row.id}`;
  for (const key of ["id", "name", "vector", "countermeasure"]) {
    if (!isText(row[key])) errors.push(`${label}: ${key} is required`);
  }
  if (![1, 2, 3].includes(row.tier)) errors.push(`${label}: tier must be 1, 2 or 3`);
  if (!FAMILIES.includes(row.family)) errors.push(`${label}: unknown family ${row.family}`);
  if (!isText(row.capture?.name) || !isText(row.capture?.effect)) {
    errors.push(`${label}: capture needs a name and an effect`);
  }
  if (!STATUSES.includes(row.status)) errors.push(`${label}: unknown status ${row.status}`);
  checkArt(row, label, errors);
}

function checkScreen(row, errors) {
  const label = `screen ${row.id}`;
  for (const key of ["id", "trigger", "title", "copy", "shape", "status_note"]) {
    if (!isText(row[key])) errors.push(`${label}: ${key} is required`);
  }
  if (!ACTS.includes(row.act)) errors.push(`${label}: unknown act ${row.act}`);
  if (row.tier !== null && ![1, 2, 3].includes(row.tier)) {
    errors.push(`${label}: tier must be 1, 2, 3 or null`);
  }
  if (!STATUSES.includes(row.status)) errors.push(`${label}: unknown status ${row.status}`);
  checkArt(row, label, errors);
}

/**
 * What `createRules` needs: valid structure and threat rows, unique ids, known countermeasure
 * targets, exactly one hub (terrain `centre`), and `twoHex` naming only known structures.
 * @returns {string[]} every problem found; empty when the catalog is valid.
 */
export function validateRulesCatalog({ structures, threats, twoHex = [] } = {}) {
  if (!Array.isArray(structures) || !Array.isArray(threats)) {
    return ["structures and threats must be lists"];
  }
  const errors = [];
  for (const row of structures) checkStructure(row, errors);
  for (const row of threats) checkThreat(row, errors);
  checkUnique(structures, "id", "structures", errors);
  checkUnique(threats, "id", "threats", errors);
  const threatIds = new Set(threats.map((row) => row.id));
  for (const row of structures) {
    if (row.countermeasure_for && !threatIds.has(row.countermeasure_for)) {
      errors.push(`structure ${row.id}: unknown threat ${row.countermeasure_for}`);
    }
  }
  const hubs = structures.filter((row) => row.terrain === "centre");
  if (hubs.length !== 1)
    errors.push(`exactly one structure needs terrain centre, found ${hubs.length}`);
  for (const tier of [1, 2, 3]) {
    if (!threats.some((row) => row.tier === tier)) errors.push(`no threat of tier ${tier}`);
  }
  if (!Array.isArray(twoHex)) errors.push("twoHex must be a list of structure ids");
  else {
    const structureIds = new Set(structures.map((row) => row.id));
    for (const id of twoHex) {
      if (!structureIds.has(id)) errors.push(`twoHex: unknown structure ${id}`);
    }
  }
  return errors;
}

/** @returns {string[]} every problem found; empty when the catalog is valid. */
export function validateCatalog({ structures, threats, lessons, screens }) {
  const errors = validateRulesCatalog({ structures, threats });
  for (const row of screens) checkScreen(row, errors);
  checkUnique(screens, "id", "screens", errors);
  checkUnique(lessons, "threat", "lessons", errors);

  const threatIds = new Set(threats.map((row) => row.id));
  for (const row of lessons) {
    if (!threatIds.has(row.threat)) errors.push(`lesson: unknown threat ${row.threat}`);
    if (!isText(row.lesson)) errors.push(`lesson ${row.threat}: lesson is required`);
  }
  const lessonIds = new Set(lessons.map((row) => row.threat));
  for (const id of threatIds) {
    if (!lessonIds.has(id)) errors.push(`threat ${id}: no lesson`);
  }
  return errors;
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Manifest rules without touching disk: fields, unique ids, unique derived hashes, and one
 * entry per source unless the later one names the entry it is a variant of.
 * @returns {string[]} every problem found.
 */
export function validateManifest(manifest) {
  const errors = [];
  checkUnique(manifest, "id", "manifest", errors);
  checkUnique(manifest, "sha256", "manifest", errors);
  const ids = new Set(manifest.map((row) => row.id));
  const firstForSource = new Map();
  for (const row of manifest) {
    const label = `art ${row.id}`;
    if (!isText(row.id) || !isText(row.file)) errors.push(`${label}: id and file are required`);
    if (!SHA256.test(row.sha256 ?? "")) errors.push(`${label}: sha256 is not a full hash`);
    if (!SHA256.test(row.source_sha256 ?? "")) {
      errors.push(`${label}: source_sha256 is not a full hash`);
    }
    if (!["hash", "perceptual"].includes(row.source_match)) {
      errors.push(`${label}: source_match must be hash or perceptual`);
    }
    if (!["base", "rich"].includes(row.layer)) errors.push(`${label}: unknown layer ${row.layer}`);
    if (!STATUSES.includes(row.status)) errors.push(`${label}: unknown status ${row.status}`);
    if (!["colony", "oligarchy"].includes(row.palette)) {
      errors.push(`${label}: unknown palette ${row.palette}`);
    }
    if (!Array.isArray(row.used_by)) errors.push(`${label}: used_by must be a list`);
    if (row.variant_of !== null && !ids.has(row.variant_of)) {
      errors.push(`${label}: variant_of names an unknown entry ${row.variant_of}`);
    }
    const first = firstForSource.get(row.source_sha256);
    if (first === undefined) firstForSource.set(row.source_sha256, row.id);
    else if (row.variant_of === null) {
      errors.push(`${label}: same source as ${first} and no variant_of`);
    }
  }
  return errors;
}
