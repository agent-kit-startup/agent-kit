import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const ciYmlPath = resolve(repoRoot, ".github/workflows/ci.yml");

/**
 * Mechanical pin: Path C remirrors ci.yml every release. If the private-origin
 * allowlist condition is dropped or flipped back to a public denylist, public
 * (or fork) tag CI can re-run sync-public / publish-npm without secrets.
 * ADR: 2026-07-29_public-mirror-skip-sync-publish-ci (allowlist amend).
 *
 * When ci.yml is absent from a checkout, tests skip (no collection-time throw).
 */
describe("ci.yml private-origin allowlist pin", () => {
  const ciPresent = existsSync(ciYmlPath);
  const body = ciPresent ? readFileSync(ciYmlPath, "utf8") : "";
  const allowlist = "github.repository == 'agent-kit-startup/agent-kit-dev'";
  // Tolerant denylist pin (\s* around !=; single or double quotes), same technique as allowlist count.
  const denylistRe = /github\.repository\s*!=\s*['"]agent-kit-startup\/agent-kit['"]/;

  it.skipIf(!ciPresent)(
    "keeps the allowlist condition on sync-public and publish-npm job ifs",
    () => {
      expect(body).toContain("sync-public:");
      expect(body).toContain("publish-npm:");
      const syncIdx = body.indexOf("sync-public:");
      const publishIdx = body.indexOf("publish-npm:");
      expect(syncIdx).toBeGreaterThan(-1);
      expect(publishIdx).toBeGreaterThan(syncIdx);
      const syncBlock = body.slice(syncIdx, publishIdx);
      const publishBlock = body.slice(publishIdx);
      expect(syncBlock).toContain(allowlist);
      expect(publishBlock).toContain(allowlist);
      expect(syncBlock).not.toMatch(denylistRe);
      expect(publishBlock).not.toMatch(denylistRe);
    },
  );

  it.skipIf(!ciPresent)(
    "keeps private-only build steps on the same allowlist (exactly six sites, no denylist)",
    () => {
      expect(body).toContain("Authority graph parity");
      expect(body).toContain("Public-deny-link guard");
      expect(body).toContain("Evidence checks");
      expect(body).toContain("Registry catalog parity");
      // Exactly six allowlist sites today: 4 build steps + sync-public + publish-npm.
      // Maintenance: changing this count requires matching comments at every counted
      // site in .github/workflows/ci.yml (build private-only steps, sync-public, publish-npm).
      const matches = body.match(/github\.repository\s*==\s*'agent-kit-startup\/agent-kit-dev'/g);
      expect(matches?.length).toBe(6);
      expect(body).not.toMatch(denylistRe);
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
