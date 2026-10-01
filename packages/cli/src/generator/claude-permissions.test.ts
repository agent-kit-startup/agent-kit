import { describe, expect, it } from "vitest";
import { evaluateShellCommand } from "../invariants/shell-guard.js";
import {
  HEADLESS_DENY_RULES,
  HEADLESS_ONLY_DENY_RULES,
  INTERACTIVE_DENY_RULES,
} from "./claude-permissions.js";

/**
 * Test-only model of Claude Code's `Bash(...)` rule glob: `*` matches any run
 * of characters (spaces included) and the pattern covers the whole command.
 * Documents intent; the real matcher lives in Claude Code.
 */
function bashRuleMatches(rule: string, command: string): boolean {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m?.[1]) return false;
  const re = m[1].split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${re.join(".*")}$`).test(command);
}

/**
 * One row per Bash rule: commands it denies and neighbours it must allow.
 * `guardDenies` = shell-guard.ts also denies every `deny` example (the native
 * rule is a backstop for the same shape); force rows are stricter than the
 * guard, which only blocks force pushes that reach main.
 */
const TABLE: { rule: string; deny: string[]; allow: string[]; guardDenies: boolean }[] = [
  {
    rule: "Bash(git push * main)",
    deny: ["git push origin main", "git push -u origin main"],
    allow: ["git push origin staging", "git push origin mainline", "git push origin feature/main"],
    guardDenies: true,
  },
  {
    rule: "Bash(git push *:main*)",
    deny: ["git push origin HEAD:main", "git push origin HEAD:main --dry-run"],
    allow: ["git push origin HEAD:staging", "git push origin main-fix"],
    guardDenies: true,
  },
  {
    rule: "Bash(git push * master)",
    deny: ["git push origin master"],
    allow: ["git push origin staging", "git push origin masterplan"],
    guardDenies: true,
  },
  {
    rule: "Bash(git push *:master*)",
    deny: ["git push origin HEAD:master"],
    allow: ["git push origin HEAD:staging"],
    guardDenies: true,
  },
  {
    rule: "Bash(git push * @)",
    deny: ["git push origin @"],
    allow: ["git push origin staging"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push * main *)",
    deny: [
      "git push origin main --no-verify",
      "git push origin main -f",
      "git push origin main --tags",
    ],
    allow: ["git push origin staging --tags", "git push origin mainline -u"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push *+main*)",
    deny: ["git push origin +main", "git push origin +main:main"],
    allow: ["git push origin staging", "git push origin feature/plus"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push *refs/heads/main*)",
    deny: ["git push origin refs/heads/main", "git push origin HEAD:refs/heads/main"],
    allow: ["git push origin refs/heads/staging"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push * master *)",
    deny: ["git push origin master --no-verify"],
    allow: ["git push origin masterplan -u"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push *+master*)",
    deny: ["git push origin +master"],
    allow: ["git push origin staging"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push *refs/heads/master*)",
    deny: ["git push origin refs/heads/master"],
    allow: ["git push origin refs/heads/staging"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push -f*)",
    deny: ["git push -f origin staging", "git push -fu origin feat"],
    allow: ["git push origin staging", "git push --follow-tags origin staging"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push * -f*)",
    deny: ["git push origin staging -f", "git push origin feat -fu"],
    allow: ["git push origin feature-fix", "git push origin staging --follow-tags"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push *--no-veri*)",
    deny: [
      "git push --no-verify origin staging",
      "git push origin feat --no-verify",
      "git push --no-veri origin main",
    ],
    allow: ["git push origin staging", "git push -u origin feat"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push * +*)",
    deny: ["git push origin +staging", "git push origin +feat:feat"],
    allow: ["git push origin staging", "git push -u origin feat"],
    guardDenies: false,
  },
  {
    rule: "Bash(git -* push*)",
    deny: [
      "git -C . push --no-verify origin main",
      "git -c core.hooksPath=/dev/null push origin main",
      "git -P push --no-verify origin HEAD:main",
      "git --no-pager push origin main",
      "git --config-env=core.hooksPath=PWD push origin main",
      "git --git-dir=.git push origin +main",
    ],
    allow: ["git -C . log -- git-hooks/pre-push", "git -C . status", "git push origin staging"],
    guardDenies: false,
  },
  {
    rule: "Bash(ALLOW_MAIN_PUSH=*)",
    deny: ["ALLOW_MAIN_PUSH=1 git push origin main"],
    allow: ["git push origin staging"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push --force*)",
    deny: ["git push --force origin main", "git push --force-with-lease origin staging"],
    allow: ["git push origin staging", "git push -u origin feature/x"],
    guardDenies: false,
  },
  {
    rule: "Bash(git push * --force*)",
    deny: ["git push origin main --force", "git push origin staging --force-with-lease"],
    allow: ["git push origin staging", "git push origin staging --tags"],
    guardDenies: false,
  },
];

describe("claude permission deny rules", () => {
  it("covers every Bash rule in the table and nothing extra", () => {
    const bashRules = HEADLESS_DENY_RULES.filter((r) => r.startsWith("Bash("));
    expect(TABLE.map((row) => row.rule).sort()).toEqual([...bashRules].sort());
  });

  for (const row of TABLE) {
    it(`${row.rule} denies its targets and allows neighbours`, () => {
      for (const cmd of row.deny) {
        expect(bashRuleMatches(row.rule, cmd), cmd).toBe(true);
        if (row.guardDenies) {
          expect(evaluateShellCommand(cmd).permission, cmd).toBe("deny");
        }
      }
      for (const cmd of row.allow) {
        expect(bashRuleMatches(row.rule, cmd), cmd).toBe(false);
        expect(evaluateShellCommand(cmd).permission, cmd).toBe("allow");
      }
    });
  }

  it("never denies the authorized feature/staging pushes under any rule", () => {
    for (const cmd of ["git push origin staging", "git push -q -u origin ultracode/phase6"]) {
      expect(
        HEADLESS_DENY_RULES.some((r) => bashRuleMatches(r, cmd)),
        cmd,
      ).toBe(false);
    }
  });

  it("headless = interactive + ALLOW_MAIN_PUSH and the promote skills", () => {
    expect(HEADLESS_ONLY_DENY_RULES).toEqual([
      "Bash(ALLOW_MAIN_PUSH=*)",
      "Skill(git-prod)",
      "Skill(kit-prod)",
      "Edit(.cursor/hooks/**)",
      "Write(.cursor/hooks/**)",
      "Edit(.claude/settings.json)",
      "Write(.claude/settings.json)",
      "Edit(packages/cli/dist/**)",
      "Write(packages/cli/dist/**)",
    ]);
    expect([...HEADLESS_DENY_RULES].sort()).toEqual(
      [...INTERACTIVE_DENY_RULES, ...HEADLESS_ONLY_DENY_RULES].sort(),
    );
  });

  it("interactive rules keep attended /git-prod working", () => {
    expect(INTERACTIVE_DENY_RULES).not.toContain("Bash(ALLOW_MAIN_PUSH=*)");
    expect(INTERACTIVE_DENY_RULES.some((r) => r.startsWith("Skill("))).toBe(false);
    expect(INTERACTIVE_DENY_RULES.some((r) => /^(Edit|Write)\(/.test(r))).toBe(false);
    // The authorized inline push starts with the env assignment, so no
    // `Bash(git push ...)` row matches it under the anchored glob.
    const authorized = "ALLOW_MAIN_PUSH=1 git push origin main";
    expect(INTERACTIVE_DENY_RULES.some((r) => bashRuleMatches(r, authorized))).toBe(false);
    expect(evaluateShellCommand(authorized).permission).toBe("allow");
  });
});
