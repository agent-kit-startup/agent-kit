import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { L0_ARTIFACTS } from "../lifecycle/l0.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

function readRel(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("docs-contract: kit-staging / kit-prod wrap native git", () => {
  it("drops both commands from consumer L0 and keeps factory files", () => {
    const targets = L0_ARTIFACTS.map((a) => a.target);
    expect(targets).not.toContain(".cursor/commands/kit-staging.md");
    expect(targets).not.toContain(".cursor/commands/kit-prod.md");
    expect(existsSync(resolve(repoRoot, ".cursor/commands/kit-staging.md"))).toBe(true);
    expect(existsSync(resolve(repoRoot, ".cursor/commands/kit-prod.md"))).toBe(true);
  });

  it("keeps native git-staging and git-prod git-only (no landing deploy)", () => {
    for (const rel of [".cursor/commands/git-staging.md", ".cursor/commands/git-prod.md"]) {
      const body = readRel(rel);
      expect(body).not.toMatch(/landing:promote/);
      expect(body).not.toMatch(/landing:deploy:staging/);
      expect(body).toMatch(/Factory landing wrap \(not consumer L0\)/);
    }
  });

  it("kit-staging wraps gitupdate Prompt git staging and gates landing HITL", () => {
    const body = readRel(".cursor/commands/kit-staging.md");
    expect(body).toMatch(/Prompt: git staging/);
    expect(body).toMatch(/autogit\/gitupdate\.md/);
    expect(body).not.toMatch(/#### 1\.\s+\*\*Security Validation\*\*/);
    expect(body).toMatch(/Deploy landing to staging/);
    expect(body).toMatch(/Skip landing \(repo only\)/);
    expect(body).toMatch(/docs\(memory\)/);
    expect(body).toMatch(/landing:deploy:staging/);
    expect(body).toMatch(/Never `pnpm landing:promote`/);
    expect(body).toMatch(/Do not invent a second updater/);
    expect(body).toMatch(/landing:update-release -- --version/);
    expect(body).toMatch(/--notes-file \.\/public-release-notes\.txt/);
    expect(body).toMatch(/--dry-run/);
    expect(body).toMatch(/data-release-version/);
    expect(body).toMatch(/data-changelog-content/);
    expect(body).toMatch(/agent-kit-startup\/agent-kit/);
    expect(body).toMatch(/CHANGELOG\.md` as `--notes-file`/);
    expect(body).toMatch(/1200/);
    expect(body).toMatch(/agent-kit-dev/);
    expect(body).toMatch(/landing:sync/);
    expect(body).toMatch(/public-changelog\.mjs --version Unreleased --blurb/);
    expect(body).toMatch(/landing:build/);
    expect(body.split("\n").length).toBeLessThan(130);
  });

  it("kit-prod keeps git-prod Ask labels and never rebuilds dist on promote", () => {
    const body = readRel(".cursor/commands/kit-prod.md");
    expect(body).toMatch(/Prompt: git prod/);
    expect(body).toMatch(/Proceed with production deploy/);
    expect(body).toMatch(/Review changes first/);
    expect(body).toMatch(/Promote landing to production/);
    expect(body).toMatch(/Skip landing \(repo only\)/);
    expect(body).toMatch(/do not steal|Do not steal|not steal/i);
    expect(body).toMatch(/promote script itself must not rebuild/i);
    expect(body).toMatch(/landing:promote/);
    expect(body).toMatch(/landing:update-release -- --version/);
    expect(body).toMatch(/--notes-file \.\/public-release-notes\.txt/);
    expect(body).toMatch(/--dry-run/);
    expect(body).toMatch(/data-release-version/);
    expect(body).toMatch(/data-changelog-content/);
    expect(body).toMatch(/agent-kit-startup\/agent-kit/);
    expect(body).toMatch(/CHANGELOG\.md` as `--notes-file`/);
    expect(body).toMatch(/1200/);
    expect(body).toMatch(/agent-kit-dev/);
    expect(body).toMatch(/landing:sync/);
    expect(body).toMatch(/public-changelog\.mjs --version <X\.Y\.Z> --blurb/);
    expect(body).toMatch(/Do not invent a second updater/);
    expect(body).toMatch(/landing:build/);
    expect(body.split("\n").length).toBeLessThan(130);
  });

  it("gitupdate points at the bundles without replacing native prompts", () => {
    const body = readRel("autogit/gitupdate.md");
    expect(body).toMatch(/### Prompt: git staging/);
    expect(body).toMatch(/### Prompt: git prod/);
    expect(body).toMatch(/\/kit-staging/);
    expect(body).toMatch(/\/kit-prod/);
    expect(body).toMatch(/Bundles vs native/);
  });

  it("pins git-prod one-confirm-one-ship and mandatory staging FF sync", () => {
    const gitupdate = readRel("autogit/gitupdate.md");
    expect(gitupdate).toMatch(/One confirm, one ship/);
    expect(gitupdate).toMatch(/Sync staging \(mandatory after main is pushed\)/);
    expect(gitupdate).toMatch(/merge-base --is-ancestor origin\/staging origin\/main/);
    expect(gitupdate).toMatch(/merge --ff-only origin\/main/);
    expect(gitupdate).not.toMatch(/#### 10\. \*\*Sync staging \(optional\)\*\*/);
    expect(gitupdate).toMatch(/does not authorize another patch/);
    expect(gitupdate).toMatch(/all name the same `vX\.Y\.Z`/);
    expect(gitupdate).toMatch(/sync-landing/);

    const gitProd = readRel(".cursor/commands/git-prod.md");
    expect(gitProd).toMatch(/One confirm, one ship/);
    expect(gitProd).toMatch(/Sync staging \(mandatory\)/);
    expect(gitProd).toMatch(/merge-base --is-ancestor/);
    expect(gitProd).toMatch(/all name the same `vX\.Y\.Z`/);
    expect(gitProd).toMatch(/sync-landing/);

    const kitProd = readRel(".cursor/commands/kit-prod.md");
    expect(kitProd).toMatch(/One confirm, one ship/);
    expect(kitProd).toMatch(/all name the same tag/);
    expect(kitProd).toMatch(/sync-landing/);

    const hitl = readRel(".cursor/skills/core/hitl-gates/SKILL.md");
    expect(hitl).toMatch(/one `Proceed with production deploy` is one ship/);
    expect(hitl).toMatch(/The next patch needs a new Ask/);
  });

  // Factory `.claude/commands/**` is private-only (not on public-sync.manifest).
  const factoryClaudeKitCommandsPresent = (["kit-staging", "kit-prod"] as const).every((name) =>
    existsSync(resolve(repoRoot, `.claude/commands/${name}.md`)),
  );

  it.skipIf(!factoryClaudeKitCommandsPresent)(
    "ships Claude thin adapters for factory dogfood",
    () => {
      for (const name of ["kit-staging", "kit-prod"] as const) {
        const cursor = readRel(`.cursor/commands/${name}.md`);
        const claudePath = resolve(repoRoot, `.claude/commands/${name}.md`);
        expect(existsSync(claudePath)).toBe(true);
        const desc = /^description:\s*(.+)$/m.exec(cursor)?.[1]?.trim();
        expect(desc).toBeTruthy();
        expect(readRel(`.claude/commands/${name}.md`)).toContain(`description: ${desc}`);
        expect(readRel(`.claude/commands/${name}.md`)).toContain(
          `Read \`.cursor/commands/${name}.md\` now and follow that contract exactly`,
        );
      }
    },
  );
});
