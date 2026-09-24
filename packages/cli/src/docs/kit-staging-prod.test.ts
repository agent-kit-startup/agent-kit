import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { L0_ARTIFACTS } from "../lifecycle/l0.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

/** Factory command files and the sync manifest are omitted from the public tree. */
const factoryKitCommandsPresent = (["kit-staging", "kit-prod"] as const).every((name) =>
  existsSync(resolve(repoRoot, `.cursor/commands/${name}.md`)),
);
const publicSyncManifestPresent = existsSync(resolve(repoRoot, "scripts/public-sync.manifest"));

function readRel(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("docs-contract: kit-staging / kit-prod wrap native git", () => {
  it("drops both commands from consumer L0", () => {
    const targets = L0_ARTIFACTS.map((a) => a.target);
    expect(targets).not.toContain(".cursor/commands/kit-staging.md");
    expect(targets).not.toContain(".cursor/commands/kit-prod.md");
  });

  it.skipIf(!factoryKitCommandsPresent)("keeps factory kit command files on disk", () => {
    expect(existsSync(resolve(repoRoot, ".cursor/commands/kit-staging.md"))).toBe(true);
    expect(existsSync(resolve(repoRoot, ".cursor/commands/kit-prod.md"))).toBe(true);
  });

  it.skipIf(!publicSyncManifestPresent)(
    "excludes kit-staging and kit-prod from public-sync.manifest",
    () => {
      const manifest = readRel("scripts/public-sync.manifest");
      expect(manifest).toMatch(/^!\.cursor\/commands\/kit-staging\.md$/m);
      expect(manifest).toMatch(/^!\.cursor\/commands\/kit-prod\.md$/m);
      expect(manifest).toMatch(/^!\.cursor\/commands\/public-issue-triage\.md$/m);
      expect(manifest).toMatch(/^!\.cursor\/commands\/public-inbound-radar\.md$/m);
    },
  );

  it("keeps native git-staging and git-prod git-only (no landing deploy)", () => {
    for (const rel of [".cursor/commands/git-staging.md", ".cursor/commands/git-prod.md"]) {
      const body = readRel(rel);
      expect(body).not.toMatch(/landing:promote/);
      expect(body).not.toMatch(/landing:deploy:staging/);
      expect(body).toMatch(/Factory landing wrap \(not consumer L0\)/);
    }
  });

  it.skipIf(!factoryKitCommandsPresent)(
    "kit-staging wraps gitupdate Prompt git staging and gates landing HITL",
    () => {
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
    },
  );

  it.skipIf(!factoryKitCommandsPresent)(
    "kit-prod keeps git-prod Ask labels and never rebuilds dist on promote",
    () => {
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
    },
  );

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
    expect(gitupdate).toMatch(/Post-prod verification \(do not skip\)/);
    expect(gitupdate).toMatch(/Otherwise Done = main pushed, tag pushed, tag CI green/);

    const gitProd = readRel(".cursor/commands/git-prod.md");
    expect(gitProd).toMatch(/One confirm, one ship/);
    expect(gitProd).toMatch(/Sync staging \(mandatory\)/);
    expect(gitProd).toMatch(/merge-base --is-ancestor/);
    expect(gitProd).toMatch(/If the project defines post-prod release verification/);
    expect(gitProd).toMatch(/all on the same `vX\.Y\.Z`/);

    const hitl = readRel(".cursor/skills/core/hitl-gates/SKILL.md");
    expect(hitl).toMatch(/one `Proceed with production deploy` is one ship/);
    expect(hitl).toMatch(/The next patch needs a new Ask/);
  });

  it("keeps maintainer-only release plumbing out of consumer L0 git commands", () => {
    // Public mirror, npm package, landing, Hostinger, storefront verification
    // live on factory-only /kit-staging + /kit-prod (L0 omit, public-sync exclude).
    const factoryOnly =
      /sync-landing|sync-public|trigger-public-sync|publish-npm|@dadado\/agent-kit-cli|missionkit|Hostinger|HOSTINGER|Path C|public sync PR|public-changelog\.mjs|agent-kit-dev|storefront|12\.5/;
    for (const rel of [
      "autogit/gitupdate.md",
      ".cursor/commands/git-staging.md",
      ".cursor/commands/git-prod.md",
      ".cursor/commands/run-plan-all.md",
      ".cursor/skills/core/hitl-gates/run-plan-all-queue.md",
      ".cursor/skills/core/hitl-gates/SKILL.md",
      ".cursor/rules/cursor-skills-git-workflow.mdc",
    ]) {
      expect(L0_ARTIFACTS.map((a) => a.target)).toContain(rel);
      expect(readRel(rel), rel).not.toMatch(factoryOnly);
    }
  });

  it.skipIf(!factoryKitCommandsPresent)(
    "pins kit-prod one-confirm-one-ship on the factory command",
    () => {
      const kitProd = readRel(".cursor/commands/kit-prod.md");
      expect(kitProd).toMatch(/One confirm, one ship/);
      expect(kitProd).toMatch(/all name the same tag/);
      expect(kitProd).toMatch(/sync-landing/);
    },
  );

  it.skipIf(!factoryKitCommandsPresent)(
    "owns the factory release steps and post-prod verification moved out of consumer L0",
    () => {
      const kitProd = readRel(".cursor/commands/kit-prod.md");
      expect(kitProd).toMatch(/## 5\. Factory release steps \+ post-prod verification/);
      expect(kitProd).toMatch(/all name the same `vX\.Y\.Z`/);
      expect(kitProd).toMatch(/npm view @dadado\/agent-kit-cli version/);
      expect(kitProd).toMatch(/Public sync PR \*\*merged\*\*/);
      expect(kitProd).toMatch(/Public GitHub Release/);
      expect(kitProd).toMatch(/Scoped-install Path C smoke/);
      expect(kitProd).toMatch(/pnpm git:trigger-public-sync/);
      expect(kitProd).toMatch(/publish-npm/);
      expect(kitProd).toMatch(/sync-public/);
      expect(kitProd).toMatch(/\.cursor-plugin\/plugin\.json/);
      expect(kitProd).toMatch(/public-changelog\.mjs --version <X\.Y\.Z>/);
      expect(kitProd).toMatch(/Protect main and staging/);
    },
  );

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
