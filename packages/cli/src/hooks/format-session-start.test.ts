import { describe, expect, it } from "vitest";
import {
  SESSION_START_DEGRADED_MESSAGE,
  formatSessionStartOutput,
  resolveSessionStartFormat,
} from "./format-session-start.js";

describe("resolveSessionStartFormat", () => {
  it("resolves 'claude' explicitly", () => {
    expect(resolveSessionStartFormat("claude")).toBe("claude");
  });

  it("defaults to 'cursor' for 'cursor', undefined, unknown strings, and non-strings", () => {
    expect(resolveSessionStartFormat("cursor")).toBe("cursor");
    expect(resolveSessionStartFormat(undefined)).toBe("cursor");
    expect(resolveSessionStartFormat("bogus")).toBe("cursor");
    expect(resolveSessionStartFormat(42)).toBe("cursor");
    expect(resolveSessionStartFormat(null)).toBe("cursor");
  });
});

describe("formatSessionStartOutput", () => {
  it('cursor format wraps in {"additional_context": ...} JSON (Cursor adapter contract unchanged)', () => {
    expect(formatSessionStartOutput("hello world", "cursor")).toBe(
      JSON.stringify({ additional_context: "hello world" }),
    );
  });

  it("claude format is plain text passthrough, no JSON wrapper", () => {
    expect(formatSessionStartOutput("hello world", "claude")).toBe("hello world");
  });

  it("claude format needs no consumer-side unwrapping: the string is exactly the context", () => {
    const context = '## Section\n\nSome *markdown* content with "quotes" and a\nnewline.';
    const out = formatSessionStartOutput(context, "claude");
    expect(out).toBe(context);
    expect(() => JSON.parse(out)).toThrow();
  });

  it("degraded message is non-empty and renders in both formats", () => {
    expect(SESSION_START_DEGRADED_MESSAGE.length).toBeGreaterThan(0);
    expect(formatSessionStartOutput(SESSION_START_DEGRADED_MESSAGE, "claude")).toBe(
      SESSION_START_DEGRADED_MESSAGE,
    );
    expect(
      JSON.parse(formatSessionStartOutput(SESSION_START_DEGRADED_MESSAGE, "cursor"))
        .additional_context,
    ).toBe(SESSION_START_DEGRADED_MESSAGE);
  });
});
