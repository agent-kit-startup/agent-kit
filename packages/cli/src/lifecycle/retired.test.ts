import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contentHash } from "./overlay.js";
import { KNOWN_SHIPPED_OVERLAY_HASHES } from "./overlay-known-hashes.js";
import {
  dropRetiredSkillIds,
  RETIRED_MANAGED_FILES,
  RETIRED_SKILL_IDS,
  type RetiredManagedFile,
  retireManagedFiles,
} from "./retired.js";

const BODY = "synthetic retired body\n";
const FILE: RetiredManagedFile = {
  path: ".cursor/skills/community/gone/SKILL.md",
  hashes: new Set([contentHash(BODY)]),
};

async function project(body?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ak-retired-"));
  if (body !== undefined) {
    await mkdir(path.join(root, path.dirname(FILE.path)), { recursive: true });
    await writeFile(path.join(root, FILE.path), body, "utf8");
  }
  return root;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("retireManagedFiles", () => {
  it("reports absent when nothing is installed", async () => {
    const root = await project();
    expect(await retireManagedFiles(root, [], undefined, [FILE])).toEqual([
      { path: FILE.path, outcome: "absent" },
    ]);
  });

  it("removes a known shipped body and its now-empty directory", async () => {
    const root = await project(BODY);
    const res = await retireManagedFiles(root, [], undefined, [FILE]);
    expect(res).toEqual([{ path: FILE.path, outcome: "removed" }]);
    expect(await exists(path.join(root, path.dirname(FILE.path)))).toBe(false);
  });

  it("removes a body that matches the managed-hash ledger and clears the entry", async () => {
    const edited = "text the ledger recorded\n";
    const root = await project(edited);
    const ledger = { schemaVersion: 1, hashes: { [FILE.path]: contentHash(edited) } };
    const res = await retireManagedFiles(root, [], ledger as never, [FILE]);
    expect(res[0]?.outcome).toBe("removed");
    expect(ledger.hashes[FILE.path]).toBeUndefined();
  });

  it("keeps an edited body", async () => {
    const root = await project("my own notes\n");
    const res = await retireManagedFiles(root, [], undefined, [FILE]);
    expect(res[0]?.outcome).toBe("preserved-customized");
    expect(await readFile(path.join(root, FILE.path), "utf8")).toBe("my own notes\n");
  });

  it("skips a protected path and a symlink", async () => {
    const protectedRoot = await project(BODY);
    const protectedRes = await retireManagedFiles(protectedRoot, [FILE.path], undefined, [FILE]);
    expect(protectedRes[0]?.outcome).toBe("skipped-protected");
    expect(await exists(path.join(protectedRoot, FILE.path))).toBe(true);

    const linkRoot = await project();
    const outside = path.join(linkRoot, "outside.md");
    await writeFile(outside, BODY, "utf8");
    await mkdir(path.join(linkRoot, path.dirname(FILE.path)), { recursive: true });
    await symlink(outside, path.join(linkRoot, FILE.path));
    const linkRes = await retireManagedFiles(linkRoot, [], undefined, [FILE]);
    expect(linkRes[0]?.outcome).toBe("skipped-symlink");
    expect(await exists(outside)).toBe(true);
  });
});

describe("retired registry content", () => {
  it("drops retired skill ids and leaves the others in order", () => {
    expect(RETIRED_SKILL_IDS).toEqual(["cursor-skills-groovy"]);
    expect(dropRetiredSkillIds(["a", "cursor-skills-groovy", "b"])).toEqual({
      skills: ["a", "b"],
      dropped: ["cursor-skills-groovy"],
    });
    expect(dropRetiredSkillIds(undefined)).toEqual({ skills: undefined, dropped: [] });
  });

  it("lists every file the kit ever installed for groovy, with hashes", () => {
    expect(RETIRED_MANAGED_FILES.map((f) => f.path)).toEqual([
      ".cursor/rules/cursor-skills-groovy.mdc",
      ".cursor/skills/community/cursor-skills-groovy/SKILL.md",
    ]);
    for (const file of RETIRED_MANAGED_FILES) expect(file.hashes.size).toBeGreaterThan(0);
  });
});

describe("overlay known hashes after the clean-room rewrite", () => {
  // sha256 of the pre-rewrite community skill bodies (hashes only, no text):
  // an unedited install without a ledger must keep refreshing to the new body.
  const PRE_REWRITE: Record<string, string> = {
    api: "17818e47e06349ee35c1d8e1cc16e8bcbbbcc89c664014e9096e1f08c8567807",
    integrations: "989e7e1bdfb29dedf850405f28648810d008885196efe7ae38c6e7554c7ce45d",
    mobile: "bd9fd1efacbd132c5dafc12cd0cf2b651a2b1fab7b2d7a9ba4a3e44128097f48",
    node: "8108b202c829627c3c2df33575016ebe942df42acf4f1cc393900be3b82b402c",
    php: "54dda8addb74bc187ee23c31f8b7d17ad19e745a45169d29ffea094860eb18f2",
    python: "f981764422d468567b5aff31148dc659aeee22cb13dc0ecd873d737deaf07372",
    webdesign: "875b0a8805280b2a2df43f2c42f9063fe0623a34fa19c3aa5d2ec48211f3ebae",
  };

  for (const [id, hash] of Object.entries(PRE_REWRITE)) {
    it(`still recognises the pre-rewrite cursor-skills-${id} body as unedited kit content`, () => {
      expect(KNOWN_SHIPPED_OVERLAY_HASHES.has(hash)).toBe(true);
    });
  }
});

describe("no third-party framing in the stack rules and community skills", () => {
  const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const THIRD_PARTY = /CURSOR-SKILLS|araguaci|cursor-skills\.vercel/;

  it("keeps the cursor-skills rules and registry entries free of upstream titles and Source lines", async () => {
    const files: string[] = [];
    for (const name of await readdir(path.join(kitRoot, ".cursor/rules"))) {
      if (name.startsWith("cursor-skills-")) files.push(`.cursor/rules/${name}`);
    }
    const community = "registry/skills/community";
    for (const name of await readdir(path.join(kitRoot, community))) {
      if (name.startsWith("cursor-skills-")) files.push(`${community}/${name}/SKILL.md`);
    }
    files.push(".cursor/skills/community/cursor-skills-node/SKILL.md");
    expect(files.length).toBeGreaterThan(15);
    const offenders: string[] = [];
    for (const rel of files) {
      if (THIRD_PARTY.test(await readFile(path.join(kitRoot, rel), "utf8"))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("no longer ships the groovy rule or registry entry", async () => {
    expect(await exists(path.join(kitRoot, ".cursor/rules/cursor-skills-groovy.mdc"))).toBe(false);
    expect(await exists(path.join(kitRoot, "registry/skills/community/cursor-skills-groovy"))).toBe(
      false,
    );
  });
});
