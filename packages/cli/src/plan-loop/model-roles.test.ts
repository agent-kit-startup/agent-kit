import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ROLE_CAPABILITIES as GUARD_ROLE_CAPABILITIES,
  ROLE_MODEL_ID as GUARD_ROLE_MODEL_ID,
} from "../../../../dashboard/lib/guards.mjs";
import { listBackendIds } from "./backends.js";
import {
  describeResolvedRoles,
  parseModelRoles,
  ROLE_CAPABILITIES,
  ROLE_MODEL_ID,
  readPlanRoleOverrides,
  resolveReviewerRole,
  resolveReviewJobRole,
  resolveSubworkerModel,
  resolveWorkerRole,
  reviewModelFamily,
  reviewModelRelation,
} from "./model-roles.js";

describe("ROLE_CAPABILITIES", () => {
  it("has one row per kit backend", () => {
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([...listBackendIds()].sort());
  });

  it("matches the Mission Control guards mirror", () => {
    expect(JSON.parse(JSON.stringify(GUARD_ROLE_CAPABILITIES))).toEqual(
      JSON.parse(JSON.stringify(ROLE_CAPABILITIES)),
    );
    expect(GUARD_ROLE_MODEL_ID.source).toBe(ROLE_MODEL_ID.source);
  });

  it("accepts aliases, full ids, OpenRouter and Cursor parameter ids, never shell text", () => {
    for (const ok of [
      "sonnet",
      "claude-opus-5-5",
      "anthropic/claude-sonnet-4.6",
      "claude-opus-4-8[context=1m,effort=high]",
    ]) {
      expect(ROLE_MODEL_ID.test(ok), ok).toBe(true);
    }
    for (const bad of ["", "a b", "x;rm", "$(id)", "a".repeat(129)]) {
      expect(ROLE_MODEL_ID.test(bad), bad).toBe(false);
    }
  });
});

describe("parseModelRoles", () => {
  it("absent roles is empty", () => {
    expect(parseModelRoles(undefined)).toEqual({ ok: true, roles: {} });
  });

  it("parses every role", () => {
    const parsed = parseModelRoles({
      worker: { backend: "Claude", model: " claude-opus-5-5 " },
      subworker: { model: "sonnet", byWorkerType: { "docs-repo": "haiku" } },
      reviewer: {
        enabled: true,
        scope: "plan",
        backend: "claude",
        model: "fable",
        advisorModel: "opus",
      },
    });
    expect(parsed).toEqual({
      ok: true,
      roles: {
        worker: { backend: "claude", model: "claude-opus-5-5" },
        subworker: { model: "sonnet", byWorkerType: { "docs-repo": "haiku" } },
        reviewer: {
          enabled: true,
          scope: "plan",
          backend: "claude",
          model: "fable",
          advisorModel: "opus",
        },
      },
    });
  });

  it("rejects an unknown backend instead of falling back to the default", () => {
    const parsed = parseModelRoles({ worker: { backend: "opnerouter" } });
    expect(parsed.ok).toBe(false);
  });

  it("rejects unknown keys and malformed models", () => {
    expect(parseModelRoles({ tester: {} }).ok).toBe(false);
    expect(parseModelRoles({ worker: { model: "a b" } }).ok).toBe(false);
    expect(parseModelRoles({ subworker: { byWorkerType: { "Bad Key": "x" } } }).ok).toBe(false);
    expect(parseModelRoles({ reviewer: { scope: "always" } }).ok).toBe(false);
    expect(parseModelRoles({ reviewer: { backend: "codex" } }).ok).toBe(false);
  });
});

describe("readPlanRoleOverrides", () => {
  const plan = [
    "---",
    "name: x",
    "worker_backend: claude",
    'worker_model: "claude-opus-5-5"',
    "subworker_model: haiku",
    "todos:",
    "  - id: a",
    "    status: completed",
    "    worker_type: tech-lead",
    "  - id: b",
    "    status: pending",
    "    worker_type: docs-repo",
    "---",
    "",
    "worker_backend: codex",
  ].join("\n");

  it("reads flat frontmatter keys and the next to-do's worker_type", () => {
    expect(readPlanRoleOverrides(plan)).toEqual({
      workerBackend: "claude",
      workerModel: "claude-opus-5-5",
      subworkerModel: "haiku",
      nextWorkerType: "docs-repo",
    });
  });

  it("is empty without frontmatter", () => {
    expect(readPlanRoleOverrides("# no frontmatter")).toEqual({});
  });
});

describe("resolveWorkerRole", () => {
  it("absent config reproduces each command's old default", () => {
    for (const def of ["cursor-agent", "auto"]) {
      expect(resolveWorkerRole({ defaultBackend: def })).toEqual({
        backend: def,
        backendSource: "default",
        warnings: [],
      });
    }
  });

  it("CLI flag > plan > config > default", () => {
    const roles = { worker: { backend: "claude", model: "opus" } };
    const plan = { workerBackend: "codex", workerModel: "gpt-x" };
    expect(
      resolveWorkerRole({
        flagBackend: "cursor-agent",
        flagModel: "m1",
        plan,
        roles,
        defaultBackend: "auto",
      }),
    ).toMatchObject({
      backend: "cursor-agent",
      backendSource: "flag",
      model: "m1",
      modelSource: "flag",
    });
    expect(resolveWorkerRole({ plan, roles, defaultBackend: "auto" })).toMatchObject({
      backend: "codex",
      backendSource: "plan",
      model: "gpt-x",
      modelSource: "plan",
    });
    expect(resolveWorkerRole({ roles, defaultBackend: "auto" })).toMatchObject({
      backend: "claude",
      backendSource: "config",
      model: "opus",
      modelSource: "config",
    });
  });

  it("a config model never rides onto a backend picked by a flag", () => {
    const r = resolveWorkerRole({
      flagBackend: "cursor-agent",
      roles: { worker: { backend: "claude", model: "opus" } },
      defaultBackend: "cursor-agent",
    });
    expect(r.backend).toBe("cursor-agent");
    expect(r.model).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/config model opus ignored/);
  });

  it("a flag model alone applies on top of the config backend", () => {
    expect(
      resolveWorkerRole({
        flagModel: "sonnet",
        roles: { worker: { backend: "claude", model: "opus" } },
        defaultBackend: "cursor-agent",
      }),
    ).toMatchObject({
      backend: "claude",
      backendSource: "config",
      model: "sonnet",
      modelSource: "flag",
    });
  });

  it("drops a config model on a backend that cannot select one", () => {
    const r = resolveWorkerRole({
      roles: { worker: { backend: "cursor-acp", model: "x" } },
      defaultBackend: "cursor-agent",
    });
    expect(r).toMatchObject({ backend: "cursor-acp", backendSource: "config" });
    expect(r.model).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
  });

  it("keeps an explicit-only paid backend from config as the requested backend (no auto fallback)", () => {
    expect(
      resolveWorkerRole({ roles: { worker: { backend: "openrouter" } }, defaultBackend: "auto" })
        .backend,
    ).toBe("openrouter");
  });
});

describe("resolveSubworkerModel", () => {
  const roles = { subworker: { model: "sonnet", byWorkerType: { "docs-repo": "haiku" } } };

  it("plan override > worker_type map > default model on claude", () => {
    expect(
      resolveSubworkerModel({
        backend: "claude",
        roles,
        plan: { subworkerModel: "opus", nextWorkerType: "docs-repo" },
      }),
    ).toEqual({ model: "opus", source: "plan" });
    expect(
      resolveSubworkerModel({ backend: "claude", roles, plan: { nextWorkerType: "docs-repo" } }),
    ).toEqual({ model: "haiku", source: "worker_type" });
    expect(resolveSubworkerModel({ backend: "claude", roles })).toEqual({
      model: "sonnet",
      source: "config",
    });
  });

  it("is empty with no subworker role", () => {
    expect(resolveSubworkerModel({ backend: "claude" })).toEqual({});
  });

  it("auto is reserved and warns not implemented", () => {
    const r = resolveSubworkerModel({ backend: "claude", roles: { subworker: { model: "auto" } } });
    expect(r.model).toBeUndefined();
    expect(r.warning).toMatch(/not implemented/);
  });

  it("warns and sets nothing on backends the matrix marks unsupported", () => {
    for (const backend of ["cursor-agent", "codex", "openrouter", "cursor-acp"] as const) {
      const r = resolveSubworkerModel({ backend, roles });
      expect(r.model, backend).toBeUndefined();
      expect(r.warning, backend).toMatch(/not supported/);
    }
  });
});

describe("describeResolvedRoles", () => {
  it("names backend, model and sources", () => {
    expect(
      describeResolvedRoles({
        backendId: "claude",
        backendSource: "config",
        model: "opus",
        modelSource: "config",
        subworker: { model: "haiku", source: "worker_type" },
      }),
    ).toBe("roles: worker claude (config), model opus (config), subworker haiku (worker_type)");
    expect(describeResolvedRoles({ backendId: "cursor-agent", backendSource: "default" })).toBe(
      "roles: worker cursor-agent (default), model backend default",
    );
  });
});

describe("resolveReviewerRole", () => {
  it("with no roles.reviewer the legacy key decides and the scope is plan", () => {
    expect(resolveReviewerRole(undefined, undefined)).toEqual({ scope: "off", source: "default" });
    expect(resolveReviewerRole({}, { enabled: false })).toEqual({
      scope: "off",
      source: "default",
    });
    expect(resolveReviewerRole({}, { enabled: true })).toEqual({
      scope: "plan",
      source: "externalPlanReview",
    });
  });

  it("enabled false or scope off wins over externalPlanReview.enabled", () => {
    expect(resolveReviewerRole({ reviewer: { enabled: false } }, { enabled: true }).scope).toBe(
      "off",
    );
    expect(
      resolveReviewerRole({ reviewer: { enabled: true, scope: "off" } }, { enabled: true }),
    ).toMatchObject({ scope: "off", source: "roles" });
  });

  it("enabled true turns the review on; scope defaults to plan; tick is explicit", () => {
    expect(resolveReviewerRole({ reviewer: { enabled: true } }, undefined)).toEqual({
      scope: "plan",
      source: "roles",
    });
    expect(
      resolveReviewerRole(
        { reviewer: { enabled: true, scope: "tick", backend: "claude", model: "fable" } },
        undefined,
      ),
    ).toEqual({ scope: "tick", source: "roles", backend: "claude", model: "fable" });
    // A scope alone does not turn the review on.
    expect(resolveReviewerRole({ reviewer: { scope: "tick" } }, undefined).scope).toBe("off");
    // An absent `enabled` falls back to the legacy key.
    expect(resolveReviewerRole({ reviewer: { scope: "tick" } }, { enabled: true })).toMatchObject({
      scope: "tick",
      source: "externalPlanReview",
    });
  });
});

/** Same table as `.cursor/scripts/plan-external-review-model-routing.test.mjs`. */
const RELATION_CASES: readonly (readonly [string, string, string])[] = [
  ["auto", "auto", "identical"],
  ["", "Auto", "identical"],
  ["cursor-auto", "default", "identical"],
  ["opus", "opus", "identical"],
  ["Claude-Opus-5-5", "claude-opus-5-5", "identical"],
  ["opus", "claude-opus-5-5", "identical"],
  ["claude-opus-5-5", "claude-opus", "identical"],
  ["fable", "claude-fable-5-2", "identical"],
  ["composer", "composer-2.5-fast", "identical"],
  ["opus[1m]", "opus", "identical"],
  ["claude-opus-4-7[1m]", "claude-opus-4-7", "identical"],
  ["gpt-5", "gpt-5", "identical"],
  ["claude-opus-5-5", "claude-opus-4-8", "same-family"],
  ["claude-opus-4-7", "claude-opus-4-7-20260101", "same-family"],
  ["claude-fable-5-2", "claude-fable-5-1", "same-family"],
  ["opus", "sonnet", "different"],
  ["claude-opus-5-5", "fable", "different"],
  ["claude-opus-5-5", "claude-fable-5-2", "different"],
  ["auto", "sonnet", "different"],
  ["gpt-5", "gpt-5.1", "different"],
  ["sonnet-4.5", "sonnet", "different"],
  ["anthropic/claude-opus-5-5", "claude-opus-5-5", "different"],
];

describe("reviewModelRelation (ADR 2026-11-16 reviewer same-family rule)", () => {
  it("refuses the identical model, warns on the same family, runs different families", () => {
    for (const [a, b, want] of RELATION_CASES) {
      expect(reviewModelRelation(a, b), `${a} / ${b}`).toBe(want);
      expect(reviewModelRelation(b, a), `${b} / ${a}`).toBe(want);
    }
    expect(reviewModelRelation(undefined, undefined)).toBe("identical");
  });

  it("knows the fable family", () => {
    expect(reviewModelFamily("claude-fable-5-2")).toBe("fable");
    expect(reviewModelFamily("Fable")).toBe("fable");
  });

  it("matches the audits launcher rule (bash parity)", () => {
    const script = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../.cursor/scripts/plan-external-review.sh",
    );
    const fns = [
      "normalize_model_id",
      "normalize_model_family",
      "model_is_family_alias",
      "review_model_relation",
    ]
      .map((name) => {
        const out = spawnSync("sed", ["-n", `/^${name}() {/,/^}$/p`, script], { encoding: "utf8" });
        expect(out.stdout, name).toContain(`${name}()`);
        return out.stdout;
      })
      .join("\n");
    const body = RELATION_CASES.map(
      ([a, b]) => `echo "$(review_model_relation ${JSON.stringify(a)} ${JSON.stringify(b)})"`,
    ).join("\n");
    const out = spawnSync("bash", ["-c", `set -euo pipefail\n${fns}\n${body}`], {
      encoding: "utf8",
    });
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout.trim().split("\n")).toEqual(RELATION_CASES.map((c) => c[2]));
  });
});

describe("resolveReviewJobRole", () => {
  it("with no roles nothing changes: the flag or auto, no rule", () => {
    expect(resolveReviewJobRole({})).toEqual({ backend: "auto", backendSource: "default" });
    expect(resolveReviewJobRole({ flagBackend: "claude", flagModel: "opus" })).toEqual({
      backend: "claude",
      backendSource: "flag",
      model: "opus",
      modelSource: "flag",
    });
  });

  it("reads roles.reviewer when no flag is given; a config model never rides on a flag backend", () => {
    const roles = { reviewer: { backend: "claude" as const, model: "fable" } };
    expect(resolveReviewJobRole({ roles })).toEqual({
      backend: "claude",
      backendSource: "config",
      model: "fable",
      modelSource: "config",
    });
    expect(resolveReviewJobRole({ flagBackend: "cursor-agent", roles })).toEqual({
      backend: "cursor-agent",
      backendSource: "flag",
    });
    expect(resolveReviewJobRole({ flagModel: "sonnet", roles }).model).toBe("sonnet");
  });

  it("refuses the worker model as reviewer and warns on its family", () => {
    const worker = { model: "claude-opus-5-5" };
    expect(
      resolveReviewJobRole({ roles: { worker, reviewer: { model: "opus" } } }).refusal,
    ).toMatch(/identical-model review is refused/);
    const family = resolveReviewJobRole({
      roles: { worker, reviewer: { model: "claude-opus-4-8" } },
    });
    expect(family.refusal).toBeUndefined();
    expect(family.warning).toMatch(/same family \(opus\)/);
    const other = resolveReviewJobRole({ roles: { worker, reviewer: { model: "fable" } } });
    expect(other.refusal).toBeUndefined();
    expect(other.warning).toBeUndefined();
    // No worker model on record: no implementer stamp, no rule.
    expect(
      resolveReviewJobRole({ roles: { reviewer: { model: "opus" } } }).refusal,
    ).toBeUndefined();
  });
});
