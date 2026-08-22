import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CURSOR_AWARENESS_NUDGE } from "./hard-rules.js";
import { buildPreCompactUserMessage } from "./pre-compact.js";
import {
  type AuditSessionCommandRunner,
  type CursorAwarenessSpawn,
  buildSessionStartAdditionalContext,
  cursorAwarenessSection,
  detachedAuditSessionsSection,
  formatSessionAge,
  parseScreenDetachedAuditSessions,
  parseTmuxDetachedAuditSessions,
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

  it("accepts consumer ## Unprocessed Files and stops at ## Processed", () => {
    const text =
      "# Dogfood Inbox\n\n## Unprocessed Files\n- `note.md` — pending\n\n## Processed Files\n- `done.md`\n";
    expect(parseUnprocessedDogfoodItems(text)).toEqual(["`note.md` — pending"]);
  });

  it("stops ### Unprocessed at a higher ## Processed heading", () => {
    const text = "### Unprocessed Files\n- `a.md`\n\n## Processed Files\n- `b.md`\n";
    expect(parseUnprocessedDogfoodItems(text)).toEqual(["`a.md`"]);
  });

  it("stops ## Unprocessed at a deeper ### Processed heading (no leak)", () => {
    const text = "## Unprocessed Files\n- `a.md`\n\n### Processed Files\n- `done.md`\n";
    expect(parseUnprocessedDogfoodItems(text)).toEqual(["`a.md`"]);
  });

  it("collects markdown table rows (first cell)", () => {
    const text = [
      "## Unprocessed Files",
      "",
      "| Note | Status |",
      "|------|--------|",
      "| `issue-37.md` | pending |",
      "| `other.md` | pending |",
      "",
      "## Processed Files",
      "| `done.md` | done |",
      "",
    ].join("\n");
    expect(parseUnprocessedDogfoodItems(text)).toEqual(["`issue-37.md`", "`other.md`"]);
  });

  it("collects numbered list items", () => {
    const text =
      "### Unprocessed Files\n1. `first.md`\n2) `second.md`\n\n### Processed Files\n3. `done.md`\n";
    expect(parseUnprocessedDogfoodItems(text)).toEqual(["`first.md`", "`second.md`"]);
  });

  it("skips the table header row before a separator (not a word allowlist)", () => {
    const text = [
      "## Unprocessed Files",
      "",
      "| Nota | Status |",
      "| --- | --- |",
      "| `issue-37.md` | pending |",
      "",
      "## Processed Files",
      "| `done.md` | done |",
      "",
    ].join("\n");
    expect(parseUnprocessedDogfoodItems(text)).toEqual(["`issue-37.md`"]);
  });

  it("stops Unprocessed at ### Processed without the word Files (no leak)", () => {
    const text = [
      "## Unprocessed Files",
      "- `a.md`",
      "",
      "### Processed",
      "- `done.md`",
      "| `later.md` | done |",
      "",
    ].join("\n");
    expect(parseUnprocessedDogfoodItems(text)).toEqual(["`a.md`"]);
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

describe("detached audit-session visibility (phase3)", () => {
  const NOW_EPOCH = 1_760_000_000;
  const NOW_MS = NOW_EPOCH * 1000;

  it("tmux parser: detached namespace-wide only (scoped, legacy, foreign tokens)", () => {
    const out = [
      // Detached workspace-scoped: counted.
      `agent-kit-audit-deadbeef-101 0 ${NOW_EPOCH - 300}`,
      // Detached legacy unscoped: counted.
      `agent-kit-audit-1234 0 ${NOW_EPOCH - 7200}`,
      // Detached foreign token: counted (host-wide namespace).
      `agent-kit-audit-cafebabe-77 0 ${NOW_EPOCH - 60}`,
      // Attached audit session: operator work in progress, never counted.
      `agent-kit-audit-deadbeef-202 1 ${NOW_EPOCH - 9999}`,
      // Non-audit session: excluded.
      `main 0 ${NOW_EPOCH - 50}`,
      "",
    ].join("\n");
    const sessions = parseTmuxDetachedAuditSessions(out, NOW_EPOCH);
    expect(sessions.map((s) => s.name)).toEqual([
      "agent-kit-audit-deadbeef-101",
      "agent-kit-audit-1234",
      "agent-kit-audit-cafebabe-77",
    ]);
    expect(sessions.map((s) => s.ageSeconds)).toEqual([300, 7200, 60]);
  });

  it("screen parser: Detached counted, Attached excluded, socket path resolved", () => {
    const listing = [
      "There are screens on:",
      "\t4242.agent-kit-audit-deadbeef-99\t(Detached)",
      "\t4243.agent-kit-audit-77\t(Attached)",
      "\t4244.other-session\t(Detached)",
      "3 Sockets in /tmp/screens/S-user.",
      "",
    ].join("\n");
    const entries = parseScreenDetachedAuditSessions(listing);
    // "(Detached)" must not match the [Aa]ttached exclusion (single t before "ached").
    expect(entries).toEqual([
      {
        name: "agent-kit-audit-deadbeef-99",
        socketPath: "/tmp/screens/S-user/4242.agent-kit-audit-deadbeef-99",
      },
    ]);
  });

  it("formatSessionAge humanizes seconds", () => {
    expect(formatSessionAge(42)).toBe("42s");
    expect(formatSessionAge(90)).toBe("1m");
    expect(formatSessionAge(7200)).toBe("2h");
    expect(formatSessionAge(180_000)).toBe("2d");
  });

  it("emits count and oldest age when detached sessions exist", async () => {
    const runCommand: AuditSessionCommandRunner = async (cmd) =>
      cmd === "tmux"
        ? [
            `agent-kit-audit-deadbeef-101 0 ${NOW_EPOCH - 300}`,
            `agent-kit-audit-1234 0 ${NOW_EPOCH - 7200}`,
          ].join("\n")
        : null;
    const section = await detachedAuditSessionsSection({ runCommand, now: () => NOW_MS });
    expect(section).toContain("## Detached audit sessions (host)");
    expect(section).toContain("2 detached `agent-kit-audit-*` PTY sessions");
    expect(section).toContain("oldest ~2h");
  });

  it("reports oldest age unknown when no age is determinable", async () => {
    const listing = [
      "There is a screen on:",
      "\t4242.agent-kit-audit-deadbeef-99\t(Detached)",
      "1 Socket in /nonexistent-sockdir-for-test.",
      "",
    ].join("\n");
    const runCommand: AuditSessionCommandRunner = async (cmd) =>
      cmd === "screen" ? listing : null;
    const section = await detachedAuditSessionsSection({ runCommand, now: () => NOW_MS });
    expect(section).toContain("1 detached `agent-kit-audit-*` PTY session on");
    expect(section).toContain("(oldest age unknown)");
  });

  it("is silent when no audit sessions exist", async () => {
    const runCommand: AuditSessionCommandRunner = async (cmd) =>
      cmd === "tmux" ? `main 0 ${NOW_EPOCH - 50}\n` : "No Sockets found in /tmp/screens/S-user.\n";
    expect(await detachedAuditSessionsSection({ runCommand, now: () => NOW_MS })).toBeNull();
  });

  it("is silent when both tools are missing (runner yields null)", async () => {
    const runCommand: AuditSessionCommandRunner = async () => null;
    expect(await detachedAuditSessionsSection({ runCommand, now: () => NOW_MS })).toBeNull();
  });

  it("fails open (null) when the runner throws", async () => {
    const runCommand: AuditSessionCommandRunner = async () => {
      throw new Error("boom");
    };
    expect(await detachedAuditSessionsSection({ runCommand, now: () => NOW_MS })).toBeNull();
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
