import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findUnmodeledRuleParameters,
  formatRulesetPreflight,
  MODELED_RULE_PARAMETERS,
  MODELED_RULE_TYPES,
  parseBranchRules,
  rulesetPreflightFromGh,
} from "./promote-ruleset-preflight.js";

/** Real `gh api repos/<o>/<r>/rules/branches/main` response (2026-11-07), repo name genericized. */
const FIXTURE = readFileSync(
  new URL("./fixtures/rules-branches-main.json", import.meta.url),
  "utf8",
);

describe("parseBranchRules", () => {
  it("parses the fixture ruleset response", () => {
    const rules = parseBranchRules(FIXTURE);
    expect(rules?.map((r) => r.type)).toEqual([
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ]);
    expect(rules?.[2]?.rulesetId).toBe(20826407);
  });

  it("returns null for anything that is not a rule array", () => {
    expect(parseBranchRules("nope")).toBeNull();
    expect(parseBranchRules('{"message":"Not Found"}')).toBeNull();
    expect(parseBranchRules('[{"no_type":1}]')).toBeNull();
  });
});

describe("findUnmodeledRuleParameters", () => {
  it("names require_extra_approval_for_unattributed_changes from the fixture, and only that", () => {
    const rules = parseBranchRules(FIXTURE) ?? [];
    expect(findUnmodeledRuleParameters(rules)).toEqual([
      {
        name: "pull_request.require_extra_approval_for_unattributed_changes",
        value: true,
        rulesetId: 20826407,
      },
    ]);
  });

  it("an unmodeled parameter left at its non-restrictive value is not printed", () => {
    const rules = parseBranchRules(
      JSON.stringify([
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            require_code_owner_review: false,
            required_reviewers: [],
          },
        },
      ]),
    );
    expect(findUnmodeledRuleParameters(rules ?? [])).toEqual([]);
  });

  it("names a restrictive value of a modeled parameter and any unknown parameter or rule type", () => {
    const rules = parseBranchRules(
      JSON.stringify([
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 1,
            require_code_owner_review: true,
            brand_new_param: "x",
          },
          ruleset_id: 7,
        },
        { type: "merge_queue", parameters: { merge_method: "SQUASH" }, ruleset_id: 8 },
        { type: "required_signatures", ruleset_id: 9 },
      ]),
    );
    expect(findUnmodeledRuleParameters(rules ?? []).map((u) => u.name)).toEqual([
      "pull_request.required_approving_review_count",
      "pull_request.require_code_owner_review",
      "pull_request.brand_new_param",
      "merge_queue",
      "required_signatures",
    ]);
  });

  it("models exactly the documented rule types", () => {
    expect([...MODELED_RULE_TYPES].sort()).toEqual([
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ]);
    expect(Object.keys(MODELED_RULE_PARAMETERS)).toContain(
      "pull_request.required_approving_review_count",
    );
    expect(Object.keys(MODELED_RULE_PARAMETERS)).not.toContain(
      "pull_request.require_extra_approval_for_unattributed_changes",
    );
  });
});

describe("formatRulesetPreflight", () => {
  it("prints one advisory line per unmodeled parameter, by name", () => {
    const rules = parseBranchRules(FIXTURE) ?? [];
    const text = formatRulesetPreflight("main", { ok: true, rules });
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^ruleset advisory \(main\): /);
    expect(lines[0]).toContain(
      "pull_request.require_extra_approval_for_unattributed_changes = true",
    );
    expect(lines[0]).toContain("ruleset 20826407");
    expect(text).toMatch(/CLEAN/);
  });

  it("prints one ok line when every parameter is modeled", () => {
    const text = formatRulesetPreflight("main", { ok: true, rules: [{ type: "deletion" }] });
    expect(text).toBe("ruleset preflight (main): every rule parameter is modeled by the kit.\n");
  });

  it("prints one note line on failure", () => {
    expect(formatRulesetPreflight("main", { ok: false, note: "gh not found" })).toBe(
      "ruleset preflight (main): skipped (gh not found); advisory only, not a blocker.\n",
    );
  });
});

describe("rulesetPreflightFromGh (never blocks)", () => {
  it("calls gh api on the base branch rules and parses the answer", async () => {
    const calls: string[][] = [];
    const r = await rulesetPreflightFromGh({
      base: "main",
      runGh: async (args) => {
        calls.push(args);
        return FIXTURE;
      },
    });
    expect(calls[0]).toEqual(["api", "repos/{owner}/{repo}/rules/branches/main"]);
    expect(r.ok).toBe(true);
  });

  it("uses an explicit repo and URL-encodes the branch", async () => {
    const calls: string[][] = [];
    await rulesetPreflightFromGh({
      base: "release/x",
      repo: "o/r",
      runGh: async (args) => {
        calls.push(args);
        return "[]";
      },
    });
    expect(calls[0]).toEqual(["api", "repos/o/r/rules/branches/release%2Fx"]);
  });

  it.each([
    ["missing gh", Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }), /gh not found/],
    ["auth", new Error("HTTP 401: Bad credentials"), /HTTP 401/],
    ["offline", new Error("error connecting to api.github.com"), /error connecting/],
  ])("%s gives a note, not a throw", async (_label, err, note) => {
    const r = await rulesetPreflightFromGh({
      base: "main",
      runGh: async () => {
        throw err;
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.note).toMatch(note);
  });

  it("a non-JSON answer gives a note", async () => {
    const r = await rulesetPreflightFromGh({ base: "main", runGh: async () => "<html>" });
    expect(r).toEqual({ ok: false, note: "unreadable rules response" });
  });
});
