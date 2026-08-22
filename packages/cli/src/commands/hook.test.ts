import { describe, expect, it } from "vitest";
import { SESSION_START_DEGRADED_MESSAGE } from "../hooks/format-session-start.js";
import { runSessionStartHook } from "./hook.js";

describe("runSessionStartHook (flag matrix: cursor default, claude opt-in, fail-open both)", () => {
  const buildContext = async () => ({ additional_context: "## Hi\n\ncontext body" });
  const readStdin = async () => ({});

  it("default (no --format) matches today's cursor JSON shape byte-for-byte", async () => {
    const out = await runSessionStartHook(process.cwd(), undefined, {
      readStdin,
      buildContext,
    });
    expect(out).toBe(JSON.stringify({ additional_context: "## Hi\n\ncontext body" }));
  });

  it("--format cursor is identical to the default", async () => {
    const out = await runSessionStartHook(process.cwd(), "cursor", { readStdin, buildContext });
    expect(out).toBe(JSON.stringify({ additional_context: "## Hi\n\ncontext body" }));
  });

  it("--format claude emits plain stdout text, no JSON wrapper, no node -e unwrapper needed", async () => {
    const out = await runSessionStartHook(process.cwd(), "claude", { readStdin, buildContext });
    expect(out).toBe("## Hi\n\ncontext body");
    expect(() => JSON.parse(out)).toThrow();
  });

  it("unknown --format value falls back to cursor default", async () => {
    const out = await runSessionStartHook(process.cwd(), "bogus", { readStdin, buildContext });
    expect(out).toBe(JSON.stringify({ additional_context: "## Hi\n\ncontext body" }));
  });

  it("fail-open: stdin read failure degrades to the diagnostic instead of throwing (cursor format)", async () => {
    const out = await runSessionStartHook(process.cwd(), "cursor", {
      readStdin: async () => {
        throw new Error("stdin exploded");
      },
      buildContext,
    });
    expect(JSON.parse(out).additional_context).toBe(SESSION_START_DEGRADED_MESSAGE);
  });

  it("fail-open: context builder failure degrades to the diagnostic instead of throwing (claude format)", async () => {
    const out = await runSessionStartHook(process.cwd(), "claude", {
      readStdin,
      buildContext: async () => {
        throw new Error("build exploded");
      },
    });
    expect(out).toBe(SESSION_START_DEGRADED_MESSAGE);
  });
});
