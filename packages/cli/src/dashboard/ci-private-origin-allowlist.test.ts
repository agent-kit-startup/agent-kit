import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const ciYmlPath = resolve(repoRoot, ".github/workflows/ci.yml");

/**
 * Mechanical pin: Path C remirrors ci.yml every release. If the private-origin
 * allowlist condition is dropped or flipped back to a public denylist, public
 * (or fork) tag CI can re-run sync-public / the npm token fallback without secrets.
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

  it.skipIf(!ciPresent)(
    "keeps the allowlist condition on sync-public and the npm token fallback job ifs",
    () => {
      const syncBlock = jobBlock("sync-public");
      const fallbackBlock = jobBlock("publish-npm-token-fallback");
      expect(syncBlock).toContain(allowlist);
      expect(fallbackBlock).toContain(allowlist);
      expect(fallbackBlock).toContain("workflow_dispatch");
      expect(fallbackBlock).toContain("secrets.NPM_TOKEN");
      expect(fallbackBlock).not.toContain("refs/tags/v')");
      expect(syncBlock).not.toMatch(denylistRe);
      expect(fallbackBlock).not.toMatch(denylistRe);
    },
  );

  it.skipIf(!ciPresent)(
    "runs publish-npm only on the public origin, with OIDC on a hosted runner and no secret",
    () => {
      // ADR 2026-10-26_npm-publish-from-public-repo-oidc-provenance: npm trusted
      // publishing (provenance) works only from the public repo on a GitHub-hosted
      // runner; a secret or vars.CI_RUNNER here would undo both.
      const publicOrigin = /github\.repository\s*==\s*'agent-kit-startup\/agent-kit'/g;
      expect(body.match(publicOrigin)?.length).toBe(1);
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

  it.skipIf(!ciPresent)("never reaches secrets through pull_request_target or workflow_run", () => {
    expect(body).not.toMatch(/pull_request_target|workflow_run/);
  });

  it.skipIf(!ciPresent)(
    "keeps private-only build steps on the same allowlist (exactly eight sites, no denylist)",
    () => {
      expect(body).toContain("Authority graph parity");
      expect(body).toContain("Public-deny-link guard");
      expect(body).toContain("Evidence checks");
      expect(body).toContain("Registry catalog parity");
      expect(body).toContain("sync-landing:");
      expect(body).toContain("publish-engine:");
      expect(body).toContain("publish-npm-token-fallback:");
      // Exactly eight allowlist sites today: 4 build steps + sync-public +
      // publish-npm-token-fallback + sync-landing + publish-engine (publish-npm itself is
      // public-origin only since ADR 2026-10-26_npm-publish-from-public-repo-oidc-provenance).
      // Maintenance: changing this count requires matching comments at every counted site in
      // .github/workflows/ci.yml (build private-only steps, sync-public,
      // publish-npm-token-fallback, sync-landing, publish-engine).
      const matches = body.match(/github\.repository\s*==\s*'agent-kit-startup\/agent-kit-dev'/g);
      expect(matches?.length).toBe(8);
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
