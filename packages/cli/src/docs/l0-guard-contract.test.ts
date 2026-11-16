import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateShellCommand } from "../invariants/shell-guard.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

/**
 * Docs-contract: an L0 command or an autogit/ routine must never mandate a shell
 * command that `agent-kit guard shell` denies. Every inline code span and every
 * fenced code line in `.cursor/commands/*.md` and `autogit/*.md` goes through
 * the same `evaluateShellCommand` the PreToolUse hook runs. A denied span passes
 * only when the text right around it says it is forbidden ("Bare `git push
 * origin main` stays denied", "Never run `...`"). The directories are read, not
 * listed, so a new or grown routine is scanned without touching this file.
 * Origin: `/git-prod` PR path mandated `git reset --hard origin/main` (memory
 * errors/2026-11-10_git-prod-pr-path-contract-vs-guard-and-forge.md).
 */

const SCANNED_DIRS = [".cursor/commands", "autogit"] as const;

/** Prohibition markers right before a denied span ("Bare `x`", "Never run `x`"). */
const BEFORE_MARKER = /\b(?:bare|never|do not|don't|must not|avoid|not)\b[^`.;|]*$/i;
/** Prohibition markers right after a denied span ("`x` stays denied", "`x` (step 9) | **No.**"). */
const AFTER_MARKER = /^[^`.;]*?\b(?:denied|blocked|forbidden|refused)\b|^[^`]*?\*\*No\.\*\*/i;
const WINDOW = 48;

interface DeniedMandate {
  file: string;
  line: number;
  rule: string;
  command: string;
}

/** Shell-command candidates in one markdown body: inline spans plus fenced lines. */
function commandCandidates(
  body: string,
): Array<{ line: number; command: string; before: string; after: string }> {
  const out: Array<{ line: number; command: string; before: string; after: string }> = [];
  let inFence = false;
  body.split("\n").forEach((text, index) => {
    const line = index + 1;
    if (/^\s*(?:```|~~~)/.test(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      const command = text.replace(/^\s*\$\s+/, "").trim();
      if (command && !command.startsWith("#")) {
        out.push({ line, command, before: "", after: "" });
      }
      return;
    }
    for (const match of text.matchAll(/`([^`]+)`/g)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      out.push({
        line,
        command: match[1] ?? "",
        before: text.slice(Math.max(0, start - WINDOW), start),
        after: text.slice(end, end + WINDOW),
      });
    }
  });
  return out;
}

/** Denied commands a body presents as something to run (no prohibition marker beside them). */
function deniedMandates(file: string, body: string): DeniedMandate[] {
  const found: DeniedMandate[] = [];
  for (const { line, command, before, after } of commandCandidates(body)) {
    const verdict = evaluateShellCommand(command);
    if (verdict.permission !== "deny") continue;
    if (BEFORE_MARKER.test(before) || AFTER_MARKER.test(after)) continue;
    found.push({ file, line, rule: verdict.rule ?? "?", command });
  }
  return found;
}

function scannedFiles(): string[] {
  return SCANNED_DIRS.flatMap((dir) =>
    readdirSync(resolve(repoRoot, dir))
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => `${dir}/${name}`),
  );
}

describe("docs-contract: L0 commands vs agent-kit guard shell", () => {
  it("flags a mandated denied command and lets a forbidden mention through", () => {
    const mandated = "While on local `main`, `git reset --hard origin/main`, then open the PR.";
    expect(deniedMandates("x.md", mandated)).toEqual([
      { file: "x.md", line: 1, rule: "git-reset-hard", command: "git reset --hard origin/main" },
    ]);
    const fenced = "Run:\n\n```bash\ngit reset --hard origin/main\n```\n";
    expect(deniedMandates("x.md", fenced).map((d) => d.rule)).toEqual(["git-reset-hard"]);
    const forbidden = [
      "Bare `git push origin main` stays denied.",
      "Never run `git reset --hard origin/main` here.",
      "(`git reset --hard` is denied by the guard).",
      "| Direct `git push origin main` (step 9) | **No.** GitHub ruleset requires a PR. |",
    ].join("\n");
    expect(deniedMandates("x.md", forbidden)).toEqual([]);
  });

  it("scans the command catalog and autogit", () => {
    const files = scannedFiles();
    expect(files).toContain(".cursor/commands/git-prod.md");
    expect(files).toContain("autogit/gitupdate.md");
  });

  it("no L0 command or autogit routine mandates a command the guard denies", () => {
    const offenders = scannedFiles().flatMap((rel) =>
      deniedMandates(rel, readFileSync(resolve(repoRoot, rel), "utf8")),
    );
    expect(
      offenders.map((o) => `${o.file}:${o.line} [${o.rule}] ${o.command}`),
      "rewrite the step to a guard-allowed command (the guard is not relaxed to fit a doc)",
    ).toEqual([]);
  });
});
