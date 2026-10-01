import { describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain .mjs dashboard module without type declarations
import { probeListenerRoot } from "../../../../dashboard/lib/identity-probe.mjs";

const httpError = () => Object.assign(new Error("curl: (22) 404"), { status: 22 });
const timeout = () => Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT", status: null });

describe("probeListenerRoot", () => {
  it("reads repoRoot from /api/identity without touching the snapshot", () => {
    const run = vi.fn(() => JSON.stringify({ repoRoot: "/work/app", tokenGated: false }));
    expect(probeListenerRoot("http://127.0.0.1:4242", "", { run })).toBe("/work/app");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toEqual(["-sf", "http://127.0.0.1:4242/api/identity"]);
  });

  it("falls back to the legacy snapshot probe on an older server's 404", () => {
    const run = vi.fn((_cmd: string, args: string[]) => {
      if (args[1].includes("/api/identity")) throw httpError();
      return JSON.stringify({ system: { repoRoot: "/work/app" } });
    });
    expect(probeListenerRoot("http://127.0.0.1:4242", "?token=t", { run })).toBe("/work/app");
    expect(run.mock.calls[1][1]).toEqual([
      "-sf",
      "http://127.0.0.1:4242/dashboard-data.json?token=t",
    ]);
  });

  it("falls back when the identity route answers with a non-JSON page", () => {
    const run = vi.fn((_cmd: string, args: string[]) =>
      args[1].includes("/api/identity")
        ? "<html>app</html>"
        : JSON.stringify({ system: { repoRoot: "/w" } }),
    );
    expect(probeListenerRoot("http://h:1", "", { run })).toBe("/w");
  });

  it("does not fall back to the slow probe on a timeout", () => {
    const run = vi.fn(() => {
      throw timeout();
    });
    expect(probeListenerRoot("http://h:1", "", { run })).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
