import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CURSOR_AWARENESS_NUDGE } from "./hard-rules.js";
import { buildPreCompactUserMessage } from "./pre-compact.js";
import {
  type CursorAwarenessSpawn,
  buildSessionStartAdditionalContext,
  cursorAwarenessSection,
  parseUnprocessedDogfoodItems,
  shouldEmitCursorAwarenessNudge,
} from "./session-start.js";

describe("parseUnprocessedDogfoodItems", () => {
  it("skips None placeholders", () => {
    const text = "### Unprocessed Files\n\n*None*\n\n### Processed Files\n";
    expect(parseUnprocessedDogfoodItems(text)).toEqual([]);
  });

  it("collects file bullets", () => {
    const text = "### Unprocessed Files\n\n- `a.md`\n- `b.md`\n\n### Processed Files\n";
    expect(parseUnprocessedDogfoodItems(text)).toEqual(["`a.md`", "`b.md`"]);
  });
});

describe("buildPreCompactUserMessage", () => {
  it("includes usage percent when provided", () => {
    const out = buildPreCompactUserMessage({ context_usage_percent: 85, trigger: "auto" });
    expect(out.user_message).toContain("~85%");
    expect(out.user_message).toContain("/continue-plan");
  });
});

describe("buildSessionStartAdditionalContext", () => {
  async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "ak-session-"));
    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(path.join(root, ".cursor", "agent-kit.json"), '{"schemaVersion":1}\n', "utf8");
    return root;
  }

  it("assembles a HANDOFF excerpt when the file exists", async () => {
    const root = await fixtureRoot();
    await writeFile(
      path.join(root, ".cursor", "HANDOFF.md"),
      [
        "# Handoff - sample",
        "",
        "- **Plan:** `sample.plan.md`",
        "- **Gaps:** none",
        "- **Instruction for the next agent:** Resume Phase 1.",
        "",
      ].join("\n"),
      "utf8",
    );
    const { additional_context } = await buildSessionStartAdditionalContext(root);
    expect(additional_context).toContain("## Current HANDOFF.md (excerpt)");
    expect(additional_context).toContain("`sample.plan.md`");
    expect(additional_context).toContain("Resume Phase 1.");
    expect(additional_context).not.toContain("No handoff file yet");
    // Hard rules preamble is always first.
    expect(additional_context.indexOf("## Current HANDOFF.md")).toBeGreaterThan(0);
  });

  it("notes missing HANDOFF when absent", async () => {
    const root = await fixtureRoot();
    const { additional_context } = await buildSessionStartAdditionalContext(root);
    expect(additional_context).toContain("## HANDOFF.md");
    expect(additional_context).toContain("No handoff file yet");
  });

  it("surfaces unresolved essential readiness before optional items", async () => {
    const root = await fixtureRoot();
    await writeFile(
      path.join(root, ".cursor", "context", "readiness.json"),
      JSON.stringify({
        pillars: [
          {
            id: "git",
            checks: [
              {
                id: "git.remote",
                essential: true,
                status: "pending",
                title: "Configure git remote",
                actions: [
                  {
                    id: "set-remote",
                    recommendation: "Add origin remote URL",
                  },
                ],
              },
              {
                id: "optional.skin",
                essential: false,
                status: "pending",
                title: "Pick a skin",
              },
            ],
          },
        ],
      }),
      "utf8",
    );
    const { additional_context } = await buildSessionStartAdditionalContext(root);
    expect(additional_context).toContain("## Repository readiness");
    expect(additional_context).toContain("Unresolved essential check: `set-remote`");
    expect(additional_context).toContain("Add origin remote URL");
    expect(additional_context).toContain("`/agent-kit-onboard`");
    expect(additional_context).not.toContain("Optional readiness item: `optional.skin`");
  });

  it("surfaces optional readiness when no essential remains", async () => {
    const root = await fixtureRoot();
    await writeFile(
      path.join(root, ".cursor", "context", "readiness.json"),
      JSON.stringify({
        pillars: [
          {
            id: "ux",
            checks: [
              {
                id: "persona",
                essential: false,
                status: "pending",
                title: "Confirm persona",
                actions: [{ id: "pick-persona", recommendation: "Choose a default persona" }],
              },
            ],
          },
        ],
      }),
      "utf8",
    );
    const { additional_context } = await buildSessionStartAdditionalContext(root);
    expect(additional_context).toContain("Optional readiness item: `pick-persona`");
    expect(additional_context).toContain("does not block");
  });

  it("surfaces dogfood inbox hint for factory dogfood/README.md", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "dogfood"), { recursive: true });
    await writeFile(
      path.join(root, "dogfood", "README.md"),
      "### Unprocessed Files\n\n- `cursor_example_2026_07_31.md` - example\n\n### Processed Files\n",
      "utf8",
    );
    const { additional_context } = await buildSessionStartAdditionalContext(root);
    expect(additional_context).toContain("## Dogfood inbox");
    expect(additional_context).toContain("/dogfood");
  });

  it("surfaces dogfood inbox hint for consumer .cursor/dogfood/README.md", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, ".cursor", "dogfood"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "dogfood", "README.md"),
      "### Unprocessed Files\n\n- `cursor_example_2026_07_31.md` - example\n\n### Processed Files\n",
      "utf8",
    );
    const { additional_context } = await buildSessionStartAdditionalContext(root);
    expect(additional_context).toContain("## Dogfood inbox");
    expect(additional_context).toContain("/dogfood");
  });

  it("does not surface dogfood inbox hint when no unprocessed items exist", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "dogfood"), { recursive: true });
    await writeFile(
      path.join(root, "dogfood", "README.md"),
      "### Unprocessed Files\n\n*None*\n\n### Processed Files\n",
      "utf8",
    );
    const { additional_context } = await buildSessionStartAdditionalContext(root);
    expect(additional_context).not.toContain("## Dogfood inbox");
  });
});

describe("cursor awareness sessionStart gate (T4)", () => {
  it("shouldEmitCursorAwarenessNudge requires changelog-ahead", () => {
    expect(
      shouldEmitCursorAwarenessNudge({
        status: "gaps-found",
        gaps: [{ id: "open-action-A4" }],
      }),
    ).toBe(false);
    expect(
      shouldEmitCursorAwarenessNudge({
        status: "gaps-found",
        gaps: [{ id: "changelog-ahead" }],
      }),
    ).toBe(true);
    expect(shouldEmitCursorAwarenessNudge({ status: "current", gaps: [] })).toBe(false);
  });

  it("omits nudge when gaps lack changelog-ahead", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-cursor-nudge-"));
    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "context", "config.json"),
      JSON.stringify({ cursorUpdateCheck: { enabled: true } }),
      "utf8",
    );

    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
    };
    child.stdout = new EventEmitter();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              status: "gaps-found",
              gaps: [{ id: "open-action-A4" }],
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as unknown as CursorAwarenessSpawn;

    const section = await cursorAwarenessSection(root, { spawnFn });
    expect(section).toBeNull();
  });

  it("emits nudge only when changelog-ahead is present", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-cursor-nudge-"));
    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "context", "config.json"),
      JSON.stringify({ cursorUpdateCheck: { enabled: true } }),
      "utf8",
    );

    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
    };
    child.stdout = new EventEmitter();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              status: "gaps-found",
              gaps: [{ id: "changelog-ahead" }],
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as unknown as CursorAwarenessSpawn;

    const section = await cursorAwarenessSection(root, { spawnFn });
    expect(section).toBe(CURSOR_AWARENESS_NUDGE);
  });

  it("ENOENT on primary starts exactly one fallback spawn", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-cursor-nudge-"));
    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "context", "config.json"),
      JSON.stringify({ cursorUpdateCheck: { enabled: true } }),
      "utf8",
    );

    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
    };
    child.stdout = new EventEmitter();
    const spawnMock = vi.fn(() => {
      queueMicrotask(() => {
        // Real ENOENT spawn emits error then close; both must hit the
        // settled/fallbackStarted guard so runFallback runs exactly once.
        child.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));
        child.emit("close", 1);
      });
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    });
    const spawnFn = spawnMock as unknown as CursorAwarenessSpawn;
    const runFallback = vi.fn(async () => ({
      status: "gaps-found",
      gaps: [{ id: "changelog-ahead" }],
    }));

    const section = await cursorAwarenessSection(root, { spawnFn, runFallback });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(runFallback).toHaveBeenCalledTimes(1);
    expect(section).toBe(CURSOR_AWARENESS_NUDGE);
  });
});
