import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const ciYmlPath = resolve(repoRoot, ".github/workflows/ci.yml");

/**
 * Mechanical pin: Path C remirrors ci.yml every release. If the private-origin
 * allowlist condition is dropped or flipped back to a public denylist, public
 * (or fork) tag CI can re-run sync-public / sync-landing / publish-engine without secrets.
 * ADR: 2026-07-29_public-mirror-skip-sync-publish-ci (allowlist amend); publish-npm is
 * public-origin only per 2026-10-26_npm-publish-from-public-repo-oidc-provenance.
 *
 * When ci.yml is absent from a checkout, tests skip (no collection-time throw).
 */
describe("ci.yml private-origin allowlist pin", () => {
  const ciPresent = existsSync(ciYmlPath);
  const body = ciPresent ? readFileSync(ciYmlPath, "utf8") : "";
  const allowlist = "github.repository == 'agent-kit-startup/agent-kit-dev'";
  // Tolerant denylist pin (\s* around !=; single or double quotes), same technique as allowlist count.
  const denylistRe = /github\.repository\s*!=\s*['"]agent-kit-startup\/agent-kit['"]/;

  /** Body of one top-level job: from `  <name>:` to the next top-level job key. */
  const jobBlock = (name: string): string => {
    const start = body.indexOf(`\n  ${name}:\n`);
    if (start < 0) return "";
    const rest = body.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
    return next < 0 ? rest : rest.slice(0, next + 2);
  };

  it.skipIf(!ciPresent)("keeps the allowlist condition on the sync-public job if", () => {
    const syncBlock = jobBlock("sync-public");
    expect(syncBlock).toContain(allowlist);
    expect(syncBlock).not.toMatch(denylistRe);
  });

  it.skipIf(!ciPresent)(
    "scopes the App key to the public-sync Environment on the two jobs that read it",
    () => {
      // Environment secrets reach only jobs that name the Environment: without this line the
      // mint step gets an empty key. publish-npm stays out because its npm Trusted Publisher
      // binds no environment; sync-landing stays out because it reads no public repo credential.
      const line = "\n    environment: public-sync\n";
      expect(jobBlock("sync-public")).toContain(line);
      expect(jobBlock("publish-engine")).toContain(line);
      expect(jobBlock("publish-npm")).not.toContain("environment:");
      expect(jobBlock("sync-landing")).not.toContain("environment:");
    },
  );

  it.skipIf(!ciPresent)(
    "has no npm token publish path (the cutover fallback was removed after v6.11.0)",
    () => {
      // Plan kit-public-release-pipeline p4: v6.11.0 published from the public repo with
      // provenance, so the private NPM_TOKEN fallback job and its dispatch input are gone.
      expect(jobBlock("publish-npm-token-fallback")).toBe("");
      expect(body).not.toContain("npm_fallback_version");
      expect(body).not.toContain("secrets.NPM_TOKEN");
    },
  );

  it.skipIf(!ciPresent)(
    "uses the public-sync App as the only public repo credential (no PAT fallback, fail loud)",
    () => {
      // Plan ci-secrets-no-surprise-expiry p3: the App path was proved on the v6.15.0 tag
      // run, then PUBLIC_REPO_TOKEN was deleted. A missing App config must fail the job
      // before the mint step, not skip it and fall back to a PAT.
      expect(body).not.toContain("secrets.PUBLIC_REPO_TOKEN");
      for (const job of ["sync-public", "publish-engine"]) {
        const block = jobBlock(job);
        const guard = block.indexOf("- name: Require the public-sync App");
        const mint = block.indexOf("- name: Mint public repo App token");
        expect(guard).toBeGreaterThan(-1);
        expect(mint).toBeGreaterThan(guard);
        expect(block).toContain("exit 1");
        expect(block).not.toContain("if: vars.PUBLIC_SYNC_APP_CLIENT_ID");
        expect(block).toContain("GH_TOKEN: ${{ steps.app-token.outputs.token }}\n");
      }
    },
  );

  it.skipIf(!ciPresent)(
    "runs publish-npm only on the public origin, with OIDC on a hosted runner and no secret",
    () => {
      // ADR 2026-10-26_npm-publish-from-public-repo-oidc-provenance: npm trusted
      // publishing (provenance) works only from the public repo on a GitHub-hosted
      // runner; a secret or vars.CI_RUNNER here would undo both.
      // Two public-origin sites: publish-npm and publish-oligarchy-engine (next test).
      const publicOrigin = /github\.repository\s*==\s*'agent-kit-startup\/agent-kit'/g;
      expect(body.match(publicOrigin)?.length).toBe(2);
      const publishBlock = jobBlock("publish-npm");
      expect(publishBlock).toMatch(publicOrigin);
      expect(publishBlock).toContain("startsWith(github.ref, 'refs/tags/v')");
      expect(publishBlock).toMatch(/^ {4}runs-on: ubuntu-latest$/m);
      expect(publishBlock).toContain("id-token: write");
      expect(publishBlock).toContain("npm publish --provenance --access public");
      expect(publishBlock).toContain("npm install -g npm@^11.5.1");
      expect(publishBlock).toContain('npm view "@dadado/agent-kit-cli@$version" version');
      expect(publishBlock).not.toContain("secrets.");
      expect(publishBlock).not.toContain("CI_RUNNER");
      expect(publishBlock).not.toContain(allowlist);
    },
  );

  it.skipIf(!ciPresent)(
    "publishes the Oligarchy engine the same way, only a new version, and never game content",
    () => {
      // @dadado/oligarchy-engine has its own Trusted Publisher row (ci.yml, no environment).
      // npm binds a Trusted Publisher only to an existing package, so a name absent from npm
      // packs with --dry-run only; the first publish is the operator's.
      const block = jobBlock("publish-oligarchy-engine");
      expect(block).toMatch(/github\.repository\s*==\s*'agent-kit-startup\/agent-kit'/);
      expect(block).toContain("startsWith(github.ref, 'refs/tags/v')");
      expect(block).toMatch(/^ {4}runs-on: ubuntu-latest$/m);
      expect(block).toContain("id-token: write");
      expect(block).toContain("npm install -g npm@^11.5.1");
      expect(block).not.toContain("environment:");
      expect(block).not.toContain("secrets.");
      expect(block).not.toContain("CI_RUNNER");
      expect(block).not.toContain(allowlist);
      expect(block).toContain("working-directory: packages/game-engine");
      expect(block).not.toMatch(/packages\/game(\/|\s|$)/m);
      expect(block).toContain("grep -q 'E404'");
      expect(block).toContain('npm view "$name@$version" version');
      expect(block).toContain("npm publish --dry-run --access public");
      expect(block).toContain("if: steps.version.outputs.mode == 'publish'");
      expect(block).toContain("npm publish --provenance --access public");
      // The tag names the CLI version; the engine has its own version gate.
      expect(block).not.toContain("GITHUB_REF_NAME");
    },
  );

  it.skipIf(!ciPresent)("never reaches secrets through pull_request_target or workflow_run", () => {
    expect(body).not.toMatch(/pull_request_target|workflow_run/);
  });

  it.skipIf(!ciPresent)(
    "keeps private-only build steps on the same allowlist (exactly seven sites, no denylist)",
    () => {
      expect(body).toContain("Authority graph parity");
      expect(body).toContain("Public-deny-link guard");
      expect(body).toContain("Evidence checks");
      expect(body).toContain("Registry catalog parity");
      expect(body).toContain("sync-landing:");
      expect(body).toContain("publish-engine:");
      // Exactly seven allowlist sites today: 4 build steps + sync-public + sync-landing +
      // publish-engine (publish-npm itself is public-origin only since ADR
      // 2026-10-26_npm-publish-from-public-repo-oidc-provenance; the private NPM_TOKEN
      // fallback job was removed after v6.11.0 proved provenance).
      // Maintenance: changing this count requires matching comments at every counted site in
      // .github/workflows/ci.yml (build private-only steps, sync-public, sync-landing,
      // publish-engine).
      const matches = body.match(/github\.repository\s*==\s*'agent-kit-startup\/agent-kit-dev'/g);
      expect(matches?.length).toBe(7);
      expect(body).not.toMatch(denylistRe);
    },
  );

  const sigScanPath = resolve(repoRoot, ".github/workflows/signature-scan.yml");
  it.skipIf(!existsSync(sigScanPath))(
    "keeps the signature-scan workflow job on the same allowlist (its script is not public-synced)",
    () => {
      const wf = readFileSync(sigScanPath, "utf8");
      const matches = wf.match(/github\.repository\s*==\s*'agent-kit-startup\/agent-kit-dev'/g);
      expect(matches?.length).toBe(1);
      expect(wf).toContain("signature-scan:");
      expect(wf).toContain("sh scripts/ci-pr-signature-scan.sh");
      expect(wf).not.toMatch(denylistRe);
    },
  );

  it.skipIf(!ciPresent)("runs the three root node --test suites from Evidence checks", () => {
    const evidenceIdx = body.indexOf("- name: Evidence checks");
    const guardIdx = body.indexOf("- name: Guard generated CLI dashboard is untracked");
    expect(evidenceIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(evidenceIdx);
    const evidenceBlock = body.slice(evidenceIdx, guardIdx);
    expect(evidenceBlock).toContain("pnpm test:root-node");

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const rootNode = pkg.scripts?.["test:root-node"] ?? "";
    expect(rootNode).toContain("plan-external-review-progress-gate.test.mjs");
    expect(rootNode).toContain("check-public-deny-links.test.mjs");
    expect(rootNode).toContain("verify-cli-dashboard-pack.test.mjs");
  });

  it.skipIf(!ciPresent)("does not run the whole build twice per pull-request push", () => {
    // push: branches ["**"] plus pull_request duplicated every PR run.
    const onIdx = body.indexOf("on:");
    const jobsIdx = body.indexOf("concurrency:");
    const triggers = body.slice(onIdx, jobsIdx);
    expect(triggers).toContain("pull_request:");
    expect(triggers).not.toContain('branches: ["**"]');
  });

  it.skipIf(!ciPresent)("builds before the guard steps that need packages/cli/dist", () => {
    // hook-session-start-diagnostic asserts the session-start hook resolves the
    // CLI through packages/cli/dist rather than reporting degraded mode, so a
    // Build step ordered after Evidence checks fails it on a clean runner.
    const buildIdx = body.indexOf("- name: Build");
    const evidenceIdx = body.indexOf("- name: Evidence checks");
    expect(buildIdx).toBeGreaterThan(-1);
    expect(evidenceIdx).toBeGreaterThan(buildIdx);
  });
});
