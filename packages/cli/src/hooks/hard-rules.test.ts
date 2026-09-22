import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HARD_RULES } from "./hard-rules.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

describe("hard-rules Gate A labels", () => {
  it("lists no-active-plan Write plan and add to backlog with start-project.md", () => {
    const startProject = readFileSync(
      resolve(repoRoot, ".cursor/commands/start-project.md"),
      "utf8",
    );
    expect(startProject).toContain("Write plan and add to backlog");
    expect(HARD_RULES).toContain("Write plan and add to backlog");
    expect(HARD_RULES).toMatch(/write\s*\/\s*write\+backlog/);
    expect(HARD_RULES).not.toMatch(/without:\s*write\s*\/\s*modify\s*\/\s*cancel/);
  });
});
