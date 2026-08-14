import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOST,
  MAX_GIT_FILES,
  MAX_GIT_PATH,
  allowlistConfig,
  applyCorsHeaders,
  escapePerlDoubleQuoted,
  isAllowedOrigin,
  isLoopbackAddress,
  isSafeRepoRelativePath,
  mergeConfigAllowlist,
  parseGitStatusShort,
  resolveBindHost,
  resolveContextConfigPath,
  resolveDashboardStatic,
  validateConfigWriteBody,
} from "../../../../dashboard/lib/guards.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

describe("escapePerlDoubleQuoted", () => {
  it("escapes @ so scoped npm package paths survive Perl double-quoted strings", () => {
    const path = "/tmp/x/node_modules/@dadado/agent-kit-cli/dashboard/serve.mjs";
    expect(escapePerlDoubleQuoted(path)).toBe(
      "/tmp/x/node_modules/\\@dadado/agent-kit-cli/dashboard/serve.mjs",
    );
  });

  it("escapes backslashes, double quotes, and dollar signs", () => {
    expect(escapePerlDoubleQuoted('a\\b"c$d')).toBe('a\\\\b\\"c\\$d');
  });
});

describe("allowlistConfig", () => {
  it("keeps only allowlisted config keys and drops nested onboarding checks", () => {
    const raw = {
      onboarded: true,
      autoHandoff: false,
      interTickCooldownMs: 250,
      secretToken: "must-not-leak",
      onboarding: {
        status: "complete",
        contractVersion: 2,
        checks: [
          { id: "git", ok: true, detail: "sensitive repo metadata" },
          { id: "hooks", ok: false, detail: "missing pre-commit" },
        ],
      },
      externalPlanReview: {
        enabled: true,
        offerOnExhausted: false,
        autoRemediate: false,
        backend: "claude",
        reviewerModel: "haiku",
        advisorModel: "opus",
        waitSliceSeconds: 90,
        waitTimeoutSeconds: 900,
        mode: "autonomous",
        midBatchAudits: true,
        preflight: "warn",
        model: "hidden",
      },
      agentPersona: {
        default: "night-shift",
        modes: { "run-plan": "night-shift", "continue-plan": "day-shift" },
      },
    };

    const summary = allowlistConfig(raw);

    expect(summary).toEqual({
      onboarded: true,
      autoHandoff: false,
      interTickCooldownMs: 250,
      onboarding: { status: "complete", contractVersion: 2 },
      externalPlanReview: {
        enabled: true,
        backend: "claude",
        autoRemediate: false,
        offerOnExhausted: false,
        mode: "autonomous",
        midBatchAudits: true,
        preflight: "warn",
        reviewerModel: "haiku",
        advisorModel: "opus",
        waitSliceSeconds: 90,
        waitTimeoutSeconds: 900,
      },
      agentPersona: {
        default: "night-shift",
        modes: { "run-plan": "night-shift", "continue-plan": "day-shift" },
      },
    });
    expect(summary).not.toHaveProperty("secretToken");
    expect(summary.onboarding).not.toHaveProperty("checks");
    expect(summary.externalPlanReview).not.toHaveProperty("model");
  });

  it("maps legacy workspaceSkin into agentPersona summary", () => {
    const summary = allowlistConfig({
      workspaceSkin: {
        default: "autopilot",
        modes: { "cli-run-plan": "ghost-runner" },
      },
    });
    expect(summary).toEqual({
      agentPersona: {
        default: "autopilot",
        modes: { "cli-run-plan": "ghost-runner" },
      },
    });
    expect(summary).not.toHaveProperty("workspaceSkin");
  });

  it("returns error for invalid config input", () => {
    expect(allowlistConfig(null)).toEqual({ error: "invalid" });
    expect(allowlistConfig([])).toEqual({ error: "invalid" });
  });
});

describe("config write allowlist", () => {
  it("accepts editable fields and rejects unknown keys", () => {
    const ok = validateConfigWriteBody({
      autoHandoff: true,
      interTickCooldownMs: 0,
      updateCheck: { enabled: true, intervalDays: 7 },
      externalPlanReview: {
        enabled: true,
        backend: "auto",
        reviewerModel: "haiku",
        advisorModel: "opus",
        waitSliceSeconds: 90,
        waitTimeoutSeconds: 900,
        autoRemediate: false,
        offerOnExhausted: true,
        mode: "autonomous",
        midBatchAudits: true,
        preflight: "warn",
      },
      agentPersona: {
        default: "autopilot",
        modes: { "run-plan": "night-shift" },
      },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.patch.autoHandoff).toBe(true);
      expect(ok.patch.updateCheck).toEqual({ enabled: true, intervalDays: 7 });
      expect(ok.patch.agentPersona?.modes?.["run-plan"]).toBe("night-shift");
    }

    expect(validateConfigWriteBody({ secretToken: "x" }).ok).toBe(false);
    expect(validateConfigWriteBody({ onboarded: true }).ok).toBe(false);
    expect(validateConfigWriteBody({ agentPersona: { default: "nope" } }).ok).toBe(false);
    expect(validateConfigWriteBody({ updateApply: { auto: true } }).ok).toBe(false);
    expect(validateConfigWriteBody({ updateCheck: { enabled: true, lastCheckedAt: "x" } }).ok).toBe(
      false,
    );
    expect(validateConfigWriteBody({}).ok).toBe(false);
  });

  it("accepts externalPlanReview audits keys and rejects invalid enums/types", () => {
    const ok = validateConfigWriteBody({
      externalPlanReview: {
        mode: "paste",
        midBatchAudits: false,
        preflight: "block",
      },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.patch.externalPlanReview).toEqual({
        mode: "paste",
        midBatchAudits: false,
        preflight: "block",
      });
    }

    expect(validateConfigWriteBody({ externalPlanReview: { mode: "headless" } }).ok).toBe(false);
    expect(validateConfigWriteBody({ externalPlanReview: { preflight: "strict" } }).ok).toBe(false);
    expect(validateConfigWriteBody({ externalPlanReview: { midBatchAudits: "yes" } }).ok).toBe(
      false,
    );
    expect(validateConfigWriteBody({ externalPlanReview: { mode: true } }).ok).toBe(false);
    expect(validateConfigWriteBody({ externalPlanReview: { unknownAuditsKey: true } }).ok).toBe(
      false,
    );
    expect(validateConfigWriteBody({ externalPlanReview: { backend: "auto" } }).ok).toBe(true);
    expect(validateConfigWriteBody({ externalPlanReview: { backend: "cursor" } }).ok).toBe(true);
    expect(validateConfigWriteBody({ externalPlanReview: { backend: "windsurf" } }).ok).toBe(false);
    expect(
      validateConfigWriteBody({
        externalPlanReview: { reviewerModel: "haiku", waitSliceSeconds: 90 },
      }).ok,
    ).toBe(true);
    expect(validateConfigWriteBody({ externalPlanReview: { waitSliceSeconds: 0 } }).ok).toBe(false);
    expect(validateConfigWriteBody({ externalPlanReview: { reviewerModel: "bad name" } }).ok).toBe(
      false,
    );
  });

  it("merges without wiping onboarding nests", () => {
    const merged = mergeConfigAllowlist(
      {
        onboarded: true,
        autoHandoff: false,
        onboarding: { status: "completed", checks: { "git.repository": { status: "ready" } } },
        externalPlanReview: {
          enabled: false,
          backend: "claude",
          offerOnExhausted: true,
          mode: "paste",
        },
        agentPersona: { default: "autopilot", modes: { "continue-plan": "autopilot" } },
        customKeep: { nested: true },
      },
      {
        autoHandoff: true,
        externalPlanReview: {
          enabled: true,
          mode: "autonomous",
          midBatchAudits: true,
          preflight: "warn",
        },
        agentPersona: { modes: { "run-plan": "night-shift" } },
        updateCheck: { enabled: true, intervalDays: 14 },
      },
    );
    expect(merged.autoHandoff).toBe(true);
    expect(merged.onboarding.checks["git.repository"].status).toBe("ready");
    expect(merged.externalPlanReview).toEqual({
      enabled: true,
      backend: "claude",
      offerOnExhausted: true,
      mode: "autonomous",
      midBatchAudits: true,
      preflight: "warn",
    });
    expect(merged.agentPersona).toEqual({
      default: "autopilot",
      modes: { "continue-plan": "autopilot", "run-plan": "night-shift" },
    });
    expect(merged.updateCheck).toEqual({ enabled: true, intervalDays: 14 });
    expect(merged.customKeep).toEqual({ nested: true });
  });

  it("clears an existing persona mode override when patch sends null (Inherit)", () => {
    const merged = mergeConfigAllowlist(
      {
        agentPersona: {
          default: "autopilot",
          modes: { "run-plan": "night-shift", "continue-plan": "autopilot" },
        },
      },
      {
        agentPersona: { modes: { "run-plan": null } },
      },
    );
    expect(merged.agentPersona).toEqual({
      default: "autopilot",
      modes: { "continue-plan": "autopilot" },
    });
    expect(validateConfigWriteBody({ agentPersona: { modes: { "run-plan": null } } }).ok).toBe(
      true,
    );
  });

  it("locks config path under repo and recognizes loopback addresses", () => {
    const locked = resolveContextConfigPath(repoRoot, { existsSync, realpathSync });
    expect(locked.ok).toBe(true);
    if (locked.ok) {
      expect(locked.path.replace(/\\/g, "/")).toMatch(/\.cursor\/context\/config\.json$/);
    }
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.10")).toBe(false);
  });
});

describe("parseGitStatusShort", () => {
  it("returns bounded file entries with expected shape", () => {
    const output = [
      " M unstaged-only.txt",
      "M  staged-only.txt",
      "A  dashboard/lib/guards.mjs",
      "?? .cursor/HANDOFF.md",
      "R  old-name.md -> new-name.md",
    ].join("\n");

    const parsed = parseGitStatusShort(output);

    expect(parsed.total).toBe(5);
    expect(parsed.truncated).toBe(false);
    expect(parsed.files).toHaveLength(5);

    for (const file of parsed.files) {
      expect(file).toMatchObject({
        path: expect.any(String),
        status: expect.any(String),
        staged: expect.any(Boolean),
        unstaged: expect.any(Boolean),
        untracked: expect.any(Boolean),
      });
      expect(Object.keys(file).sort()).toEqual(
        expect.arrayContaining(["path", "status", "staged", "unstaged", "untracked"]),
      );
      expect(file.path.length).toBeLessThanOrEqual(MAX_GIT_PATH + 1);
    }

    expect(parsed.files[0]).toMatchObject({
      path: "unstaged-only.txt",
      status: " M",
      staged: false,
      unstaged: true,
      untracked: false,
    });
    expect(parsed.files[1]).toMatchObject({
      path: "staged-only.txt",
      staged: true,
      unstaged: false,
    });
    expect(parsed.files[2]).toMatchObject({ staged: true, untracked: false });
    expect(parsed.files[3]).toMatchObject({ untracked: true });
    expect(parsed.files[4]).toMatchObject({
      path: "new-name.md",
      oldPath: "old-name.md",
      renamed: true,
    });
  });

  it("caps files array at MAX_GIT_FILES", () => {
    const lines = Array.from({ length: MAX_GIT_FILES + 5 }, (_, i) => `?? file-${i}.txt`);
    const parsed = parseGitStatusShort(lines.join("\n"));

    expect(parsed.files).toHaveLength(MAX_GIT_FILES);
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBe(MAX_GIT_FILES + 5);
  });
});

describe("resolveBindHost", () => {
  it("defaults to loopback when HOST env is unset", () => {
    expect(resolveBindHost(undefined)).toBe(DEFAULT_HOST);
    expect(DEFAULT_HOST).toBe("127.0.0.1");
  });

  it("honors explicit HOST override", () => {
    expect(resolveBindHost("0.0.0.0")).toBe("0.0.0.0");
  });
});

describe("broadcast auth gate", () => {
  it("resolves MISSION_CONTROL_REPO_ROOT for consumer snapshots", async () => {
    const { resolveSnapshotRepoRoot, REPO_ROOT_ENV } = await import(
      "../../../../dashboard/lib/guards.mjs"
    );
    const kit = "/tmp/agent-kit-tree";
    expect(resolveSnapshotRepoRoot({}, kit)).toBe(kit);
    expect(resolveSnapshotRepoRoot({ [REPO_ROOT_ENV]: "/tmp/consumer-app" }, kit)).toBe(
      "/tmp/consumer-app",
    );
  });

  it("hashes a stable preferred port per repo root and walks collisions", async () => {
    const {
      preferredPortForRepoRoot,
      portCandidatesForRepoRoot,
      resolveMissionControlPort,
      sameRepoRoot,
      DEFAULT_PORT_BASE,
      DEFAULT_PORT_RANGE,
    } = await import("../../../../dashboard/lib/guards.mjs");

    const a = "/tmp/workspace-alpha";
    const b = "/tmp/workspace-beta";
    const portA = preferredPortForRepoRoot(a);
    const portB = preferredPortForRepoRoot(b);
    expect(portA).toBeGreaterThanOrEqual(DEFAULT_PORT_BASE);
    expect(portA).toBeLessThan(DEFAULT_PORT_BASE + DEFAULT_PORT_RANGE);
    expect(preferredPortForRepoRoot(a)).toBe(portA);
    expect(sameRepoRoot(a, `${a}/`)).toBe(true);

    const candidates = portCandidatesForRepoRoot(a);
    expect(candidates[0]).toBe(portA);
    expect(candidates).toHaveLength(DEFAULT_PORT_RANGE);
    expect(new Set(candidates).size).toBe(DEFAULT_PORT_RANGE);

    // Foreign listener on preferred port → next free candidate.
    const occupied = new Map([
      [portA, { listening: true, repoRoot: b }],
      [candidates[1], { listening: false, repoRoot: null }],
    ]);
    const picked = resolveMissionControlPort({
      repoRoot: a,
      probe: (port) => occupied.get(port) || { listening: false, repoRoot: null },
    });
    expect(picked).toEqual({ port: candidates[1], reuse: false, explicit: false });

    // Matching live root → reuse preferred.
    const reuse = resolveMissionControlPort({
      repoRoot: a,
      probe: (port) =>
        port === portA ? { listening: true, repoRoot: a } : { listening: false, repoRoot: null },
    });
    expect(reuse).toEqual({ port: portA, reuse: true, explicit: false });

    // Explicit PORT with foreign root → refuse (do not kill).
    expect(() =>
      resolveMissionControlPort({
        repoRoot: a,
        envPort: "3333",
        probe: () => ({ listening: true, repoRoot: b }),
      }),
    ).toThrow(/will not kill another workspace/);
  });

  it("requires a strong token for non-loopback bind and allows loopback without token", async () => {
    const {
      isLoopbackBindHost,
      isValidBroadcastToken,
      resolveBroadcastAuth,
      authorizeMissionControlRequest,
      tokensMatch,
      generateBroadcastToken,
      extractRequestToken,
    } = await import("../../../../dashboard/lib/guards.mjs");

    expect(isLoopbackBindHost("127.0.0.1")).toBe(true);
    expect(isLoopbackBindHost("0.0.0.0")).toBe(false);
    expect(isValidBroadcastToken("")).toBe(false);
    expect(isValidBroadcastToken("short")).toBe(false);
    expect(isValidBroadcastToken("a".repeat(16))).toBe(true);

    expect(resolveBroadcastAuth({}).ok).toBe(true);
    expect(resolveBroadcastAuth({ HOST: "0.0.0.0" }).ok).toBe(false);
    const ok = resolveBroadcastAuth({
      HOST: "0.0.0.0",
      MISSION_CONTROL_TOKEN: "a".repeat(16),
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.tokenRequired).toBe(true);
      expect(ok.broadcast).toBe(true);
    }

    const token = generateBroadcastToken();
    expect(tokensMatch(token, token)).toBe(true);
    expect(tokensMatch(token, `${token}x`)).toBe(false);

    const urlOk = new URL(`http://192.168.1.10:3333/?token=${encodeURIComponent(token)}`);
    const allowed = authorizeMissionControlRequest({ headers: {} }, urlOk, {
      tokenRequired: true,
      expectedToken: token,
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.viaQuery).toBe(true);

    const urlBad = new URL("http://192.168.1.10:3333/");
    const denied = authorizeMissionControlRequest({ headers: {} }, urlBad, {
      tokenRequired: true,
      expectedToken: token,
    });
    expect(denied.ok).toBe(false);

    const bearer = authorizeMissionControlRequest(
      { headers: { authorization: `Bearer ${token}` } },
      new URL("http://192.168.1.10:3333/api/data"),
      { tokenRequired: true, expectedToken: token },
    );
    expect(bearer.ok).toBe(true);
    expect(extractRequestToken({ headers: { authorization: `Bearer ${token}` } }, urlBad)).toBe(
      token,
    );
  });
});

describe("broadcast share URL mask", () => {
  it("encodes and decodes fragment payloads with TTL", async () => {
    const {
      buildBroadcastShareUrl,
      decodeBroadcastShareFragment,
      encodeBroadcastSharePayload,
      resolveShareBase,
      resolveShareShowLan,
      DEFAULT_SHARE_BASE,
      validateBroadcastShareTarget,
      normalizeShareBase,
      isPublicBroadcastShareShell,
      shareShellTokenRequired,
    } = await import("../../../../dashboard/lib/broadcast-share.mjs");

    expect(DEFAULT_SHARE_BASE).toBe("https://missionkit.io/mc/open.html");
    expect(resolveShareBase({})).toBe(DEFAULT_SHARE_BASE);
    expect(resolveShareBase({ MISSION_CONTROL_SHARE_BASE: "off" })).toBeNull();
    expect(resolveShareBase({ MISSION_CONTROL_SHARE_BASE: " https://share.example/open/ " })).toBe(
      "https://share.example/open",
    );
    expect(resolveShareBase({ MISSION_CONTROL_SHARE_BASE: "http://evil.example/open" })).toBeNull();
    expect(normalizeShareBase("http://127.0.0.1:4173/open.html").ok).toBe(true);
    expect(resolveShareShowLan({})).toBe(true);
    expect(resolveShareShowLan({ MISSION_CONTROL_SHARE_SHOW_LAN: "0" })).toBe(false);

    expect(validateBroadcastShareTarget("https://attacker.example/login").ok).toBe(false);
    expect(validateBroadcastShareTarget("http://192.168.1.20:3340/?token=x").ok).toBe(true);
    expect(validateBroadcastShareTarget("http://127.0.0.1:3333/?token=x").ok).toBe(true);

    expect(isPublicBroadcastShareShell("GET", "/open.html")).toBe(true);
    expect(isPublicBroadcastShareShell("GET", "/open")).toBe(true);
    expect(isPublicBroadcastShareShell("POST", "/open.html")).toBe(false);
    expect(isPublicBroadcastShareShell("GET", "/dashboard-data.json")).toBe(false);
    expect(shareShellTokenRequired(true, "GET", "/open.html")).toBe(false);
    expect(shareShellTokenRequired(true, "GET", "/open")).toBe(false);
    expect(shareShellTokenRequired(true, "GET", "/api/data")).toBe(true);
    expect(shareShellTokenRequired(true, "POST", "/open")).toBe(true);
    expect(shareShellTokenRequired(false, "GET", "/api/data")).toBe(false);

    const lan = "http://192.168.1.20:3340/?token=tokentrain123456";
    const frag = encodeBroadcastSharePayload(lan, { ttlSec: 60, nowSec: 1_700_000_000 });
    expect(frag.startsWith("v1.")).toBe(true);
    const decoded = decodeBroadcastShareFragment(frag, { nowSec: 1_700_000_010 });
    expect(decoded).toEqual({ ok: true, url: lan, expiresAt: 1_700_000_060 });
    expect(decodeBroadcastShareFragment(frag, { nowSec: 1_700_000_061 })).toEqual({
      ok: false,
      error: "expired",
    });

    expect(() => encodeBroadcastSharePayload("https://attacker.example/login")).toThrow(
      /non-private-target/,
    );
    expect(() =>
      encodeBroadcastSharePayload("http://100.64.1.2:3340/?token=tokentrain123456"),
    ).toThrow(/non-private-target/);
    expect(
      decodeBroadcastShareFragment(
        // crafted public-host payload (same shape as pre-harden attacker fragment)
        `v1.${Buffer.from(
          JSON.stringify({ v: 1, u: "https://attacker.example/login" }),
          "utf8",
        ).toString("base64url")}`,
      ),
    ).toEqual({ ok: false, error: "non-private-target" });

    const share = buildBroadcastShareUrl(lan, {
      base: "https://missionkit.io/mc/open.html/",
      ttlSec: 0,
    });
    expect(share).toBeTruthy();
    if (!share) throw new Error("expected share URL");
    expect(share.startsWith("https://missionkit.io/mc/open.html#v1.")).toBe(true);
    const hash = share.slice(share.indexOf("#") + 1);
    expect(decodeBroadcastShareFragment(hash)).toEqual({
      ok: true,
      url: lan,
      expiresAt: null,
    });
    expect(buildBroadcastShareUrl(lan, { base: null })).toBeNull();
  });
});

describe("isAllowedOrigin", () => {
  const port = 3333;

  it("allows localhost and 127.0.0.1 on the configured port", () => {
    expect(isAllowedOrigin("http://localhost:3333", port)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3333", port)).toBe(true);
  });

  it("rejects wrong port and non-loopback hosts", () => {
    expect(isAllowedOrigin("http://localhost:4444", port)).toBe(false);
    expect(isAllowedOrigin("http://evil.example:3333", port)).toBe(false);
    expect(isAllowedOrigin("", port)).toBe(false);
  });
});

describe("applyCorsHeaders", () => {
  it("sets ACAO only for allowed localhost origins", () => {
    const port = 3333;
    const headers: Record<string, string> = {};
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    };

    const allowed = applyCorsHeaders({ headers: { origin: "http://127.0.0.1:3333" } }, res, port);
    expect(allowed).toBe(true);
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:3333");
    expect(headers.Vary).toBe("Origin");

    const blockedHeaders: Record<string, string> = {};
    const blockedRes = {
      setHeader(name: string, value: string) {
        blockedHeaders[name] = value;
      },
    };
    const blocked = applyCorsHeaders(
      { headers: { origin: "http://evil.example:3333" } },
      blockedRes,
      port,
    );
    expect(blocked).toBe(false);
    expect(blockedHeaders).toEqual({});
  });
});

describe("resolveDashboardStatic", () => {
  it("resolves files inside dashboard dir and blocks repo escape", () => {
    const tmpDashboard = mkdtempSync(join(tmpdir(), "mc-dashboard-"));
    writeFileSync(join(tmpDashboard, "dashboard.html"), "<html></html>");
    const dashboardReal = realpathSync(tmpDashboard);
    const dashboardDir = dashboardReal;

    const ctx = {
      dashboardDir,
      dashboardReal,
      existsSync,
      realpathSync,
    };

    expect(resolveDashboardStatic("/", ctx)).toBe(join(dashboardReal, "dashboard.html"));
    expect(resolveDashboardStatic("/dashboard.html", ctx)).toBe(
      join(dashboardReal, "dashboard.html"),
    );
    expect(resolveDashboardStatic("/../package.json", ctx)).toBeNull();
    expect(resolveDashboardStatic("/../../etc/passwd", ctx)).toBeNull();
    expect(resolveDashboardStatic("/missing.html", ctx)).toBeNull();
    expect(resolveDashboardStatic("/.hidden", ctx)).toBeNull();
  });

  it("blocks paths outside dashboard/ using real repo layout", () => {
    const dashboardDir = join(repoRoot, "dashboard");
    const dashboardReal = realpathSync(dashboardDir);
    const ctx = {
      dashboardDir,
      dashboardReal,
      existsSync,
      realpathSync,
    };

    expect(resolveDashboardStatic("/dashboard.html", ctx)).toBe(
      join(dashboardReal, "dashboard.html"),
    );
    expect(resolveDashboardStatic("/../package.json", ctx)).toBeNull();
    expect(resolveDashboardStatic("/lib/guards.mjs", ctx)).toBe(
      join(dashboardReal, "lib", "guards.mjs"),
    );
  });
});

describe("isSafeRepoRelativePath", () => {
  it("accepts safe relative paths and rejects traversal or absolute forms", () => {
    expect(isSafeRepoRelativePath(".cursor/plans/x.plan.md")).toBe(true);
    expect(isSafeRepoRelativePath(".cursor/HANDOFF.md")).toBe(true);
    expect(isSafeRepoRelativePath("../etc/passwd")).toBe(false);
    expect(isSafeRepoRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRepoRelativePath("C:/Windows/system.ini")).toBe(false);
    expect(isSafeRepoRelativePath("https://example.com/x")).toBe(false);
    expect(isSafeRepoRelativePath("")).toBe(false);
  });
});

describe("serve.mjs HTTP auth exemption for share shell", () => {
  it("GET /open and /open.html succeed without token while data stays 401", async () => {
    const { spawn } = await import("node:child_process");
    const { createServer } = await import("node:net");
    const { once } = await import("node:events");
    const servePath = resolve(repoRoot, "dashboard/serve.mjs");

    const port = await new Promise<number>((resolvePort, reject) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        s.close(() => resolvePort(p));
      });
      s.on("error", reject);
    });

    const token = "a".repeat(16);
    const child = spawn(process.execPath, [servePath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOST: "0.0.0.0",
        PORT: String(port),
        MISSION_CONTROL_TOKEN: token,
        MISSION_CONTROL_NO_OPEN: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const deadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/open.html`);
        if (res.status === 200 || res.status === 401) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    expect(ready).toBe(true);

    try {
      const openHtml = await fetch(`http://127.0.0.1:${port}/open.html`);
      expect(openHtml.status).toBe(200);
      const openAlias = await fetch(`http://127.0.0.1:${port}/open`);
      expect(openAlias.status).toBe(200);
      const data = await fetch(`http://127.0.0.1:${port}/dashboard-data.json`);
      expect(data.status).toBe(401);
      const dataOk = await fetch(`http://127.0.0.1:${port}/dashboard-data.json?token=${token}`);
      expect(dataOk.status).toBe(200);
    } finally {
      child.kill("SIGTERM");
      await once(child, "exit").catch(() => undefined);
    }
  }, 30_000);
});
