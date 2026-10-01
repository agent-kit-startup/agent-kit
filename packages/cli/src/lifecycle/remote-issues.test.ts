import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ForgeRunner,
  matchesProvenance,
  parseRemoteUrl,
  readRemoteIssues,
} from "./remote-issues.js";

const NOW = () => new Date("2026-09-28T12:00:00.000Z");

const ghRows = JSON.stringify([
  {
    number: 7,
    title: "[Dogfood] gap in intake",
    url: "https://github.com/o/r/issues/7",
    labels: [],
    updatedAt: "2026-09-27T00:00:00Z",
  },
  {
    number: 8,
    title: "unrelated bug",
    url: "https://github.com/o/r/issues/8",
    labels: [{ name: "bug" }],
  },
  {
    number: 9,
    title: "review finding",
    url: "https://github.com/o/r/issues/9",
    labels: [{ name: "dogfood" }],
  },
]);
const glRows = JSON.stringify([
  {
    iid: 3,
    title: "[Dogfood] hook missing",
    web_url: "https://git.example.dev/g/p/-/issues/3",
    labels: ["x"],
    updated_at: "2026-09-27T00:00:00Z",
  },
  {
    iid: 4,
    title: "chore",
    web_url: "https://git.example.dev/g/p/-/issues/4",
    labels: ["dogfood"],
  },
  { iid: 5, title: "plain", web_url: "https://git.example.dev/g/p/-/issues/5", labels: [] },
]);

function remotes(map: Record<string, string>) {
  return async (_cwd: string, name: string) => map[name] ?? null;
}

describe("remote-issues helpers", () => {
  it("parses ssh alias, https and gitlab self-host remotes", () => {
    expect(parseRemoteUrl("git@github-agent-kit:agent-kit-startup/agent-kit-dev.git")).toEqual({
      provider: "github",
      host: "github-agent-kit",
      repo: "agent-kit-startup/agent-kit-dev",
    });
    expect(parseRemoteUrl("https://github.com/o/r.git")?.provider).toBe("github");
    expect(parseRemoteUrl("git@git.example.dev:g/sub/p.git")).toEqual({
      provider: "gitlab",
      host: "git.example.dev",
      repo: "g/sub/p",
    });
    expect(parseRemoteUrl("https://gitlab.com/g/p")?.provider).toBe("gitlab");
    expect(parseRemoteUrl("not a url")).toBeNull();
  });

  it("matches the provenance marker by label or title prefix", () => {
    expect(matchesProvenance("[dogfood] x", [])).toBe(true);
    expect(matchesProvenance("x", ["Dogfood"], {})).toBe(true);
    expect(matchesProvenance("x", ["bug"], {})).toBe(false);
    expect(matchesProvenance("x", ["custom"], { AGENT_KIT_REMOTE_ISSUE_LABELS: "a, Custom" })).toBe(
      true,
    );
  });
});

describe("readRemoteIssues", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "remote-issues-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("factory lane reads origin + public via gh, filtered by provenance", async () => {
    const calls: string[][] = [];
    const runCli: ForgeRunner = async (bin, args) => {
      calls.push([bin, ...args]);
      return ghRows;
    };
    const result = await readRemoteIssues(dir, {
      runCli,
      isFactory: async () => true,
      now: NOW,
      getRemoteUrl: remotes({
        origin: "git@github-agent-kit:agent-kit-startup/agent-kit-dev.git",
        public: "git@github-agent-kit:agent-kit-startup/agent-kit.git",
      }),
    });
    expect(result.lane).toBe("factory");
    expect(result.mutateRecommended).toBe(false);
    expect(result.targets.map((t) => [t.role, t.repo, t.status])).toEqual([
      ["origin", "agent-kit-startup/agent-kit-dev", "ok"],
      ["public", "agent-kit-startup/agent-kit", "ok"],
    ]);
    expect(result.items.map((i) => i.cite)).toEqual([
      "agent-kit-startup/agent-kit-dev#7",
      "agent-kit-startup/agent-kit-dev#9",
      "agent-kit-startup/agent-kit#7",
      "agent-kit-startup/agent-kit#9",
    ]);
    expect(result.notes).toEqual([]);
    expect(calls.every((c) => c[0] === "gh" && c[1] === "issue" && c[2] === "list")).toBe(true);
    // read-only: no mutating verbs
    expect(calls.flat().some((a) => /^(create|edit|close|comment)$/.test(a))).toBe(false);
  });

  it("consumer GitHub lane reads own origin only, never upstream", async () => {
    const calls: string[][] = [];
    const result = await readRemoteIssues(dir, {
      runCli: async (bin, args) => {
        calls.push([bin, ...args]);
        return ghRows;
      },
      isFactory: async () => false,
      now: NOW,
      getRemoteUrl: remotes({
        origin: "https://github.com/acme/app.git",
        public: "https://github.com/agent-kit-startup/agent-kit.git",
      }),
    });
    expect(result.lane).toBe("consumer");
    expect(result.targets).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("acme/app");
    expect(result.items).toHaveLength(2);
  });

  it("consumer GitLab lane uses glab api with hostname and encoded project", async () => {
    const calls: string[][] = [];
    const result = await readRemoteIssues(dir, {
      runCli: async (bin, args) => {
        calls.push([bin, ...args]);
        return glRows;
      },
      isFactory: async () => false,
      now: NOW,
      getRemoteUrl: remotes({ origin: "git@git.example.dev:g/sub/p.git" }),
    });
    expect(calls).toEqual([
      [
        "glab",
        "api",
        "--hostname",
        "git.example.dev",
        "projects/g%2Fsub%2Fp/issues?state=opened&per_page=100",
      ],
    ]);
    expect(result.items.map((i) => [i.provider, i.number, i.url])).toEqual([
      ["gitlab", 3, "https://git.example.dev/g/p/-/issues/3"],
      ["gitlab", 4, "https://git.example.dev/g/p/-/issues/4"],
    ]);
  });

  it("gitlab.com omits --hostname", async () => {
    const calls: string[][] = [];
    await readRemoteIssues(dir, {
      runCli: async (bin, args) => {
        calls.push([bin, ...args]);
        return "[]";
      },
      isFactory: async () => false,
      getRemoteUrl: remotes({ origin: "https://gitlab.com/g/p.git" }),
    });
    expect(calls[0]).toEqual(["glab", "api", "projects/g%2Fp/issues?state=opened&per_page=100"]);
  });

  it.each([
    [
      "gh",
      "git@github.com:o/r.git",
      Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }),
      "skipped-cli-missing",
      "gh not installed",
    ],
    [
      "glab",
      "git@git.example.dev:g/p.git",
      new Error("glab: 401 Unauthorized, run glab auth login"),
      "skipped-auth",
      "glab not authenticated",
    ],
    [
      "gh",
      "git@github.com:o/r.git",
      new Error("getaddrinfo ENOTFOUND api.github.com"),
      "skipped-offline",
      "offline",
    ],
    ["gh", "git@github.com:o/r.git", new Error("boom"), "skipped-error", "remote read failed"],
  ])("%s failure degrades to a note, never throws (%s)", async (_bin, url, error, status, text) => {
    const result = await readRemoteIssues(dir, {
      runCli: async () => {
        throw error;
      },
      isFactory: async () => false,
      getRemoteUrl: remotes({ origin: url }),
    });
    expect(result.targets[0]?.status).toBe(status);
    expect(result.items).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.label).toBe("note");
    expect(result.notes[0]?.message).toContain(text);
  });

  it("malformed JSON degrades; missing origin is a note", async () => {
    const bad = await readRemoteIssues(dir, {
      runCli: async () => "{not json",
      isFactory: async () => false,
      getRemoteUrl: remotes({ origin: "git@github.com:o/r.git" }),
    });
    expect(bad.targets[0]?.status).toBe("skipped-error");
    const none = await readRemoteIssues(dir, {
      runCli: async () => "[]",
      isFactory: async () => false,
      getRemoteUrl: remotes({}),
    });
    expect(none.targets[0]?.status).toBe("skipped-no-remote");
    expect(none.notes[0]?.message).toContain("no remote configured");
  });

  it("factory: one target failing keeps the other's items", async () => {
    const result = await readRemoteIssues(dir, {
      runCli: async (_bin, args) => {
        if (args.includes("o/private")) throw new Error("401 auth");
        return ghRows;
      },
      isFactory: async () => true,
      getRemoteUrl: remotes({
        origin: "git@github.com:o/private.git",
        public: "git@github.com:o/public.git",
      }),
    });
    expect(result.items).toHaveLength(2);
    expect(result.notes).toHaveLength(1);
  });

  it("unreadable cwd does not throw", async () => {
    const result = await readRemoteIssues(path.join(dir, "missing"), { runCli: async () => "[]" });
    expect(result.notes).toHaveLength(1);
  });
});
