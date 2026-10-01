import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addDogfoodNote,
  appendUnprocessedEntry,
  detectDogfoodLane,
  dogfoodFilename,
  fileDogfoodIssue,
  hygieneStrip,
  normalizeTopic,
} from "./dogfood-file.js";
import type { ForgeRunner } from "./remote-issues.js";

const NOW = () => new Date("2026-09-28T12:00:00.000Z");
const remotes = (map: Record<string, string>) => async (_cwd: string, name: string) =>
  map[name] ?? null;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "dogfood-file-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function recorder(output = "https://example.test/issues/1\n") {
  const calls: Array<{ bin: string; args: string[] }> = [];
  const runCli: ForgeRunner = async (bin, args) => {
    calls.push({ bin, args });
    return output;
  };
  return { calls, runCli };
}

describe("lane detection", () => {
  it("factory by origin, factory by dogfood/README.md, consumer by agent-kit.json, else null", async () => {
    expect(
      await detectDogfoodLane(root, {
        getRemoteUrl: remotes({ origin: "git@h:agent-kit-startup/agent-kit-dev.git" }),
      }),
    ).toBe("factory");
    expect(await detectDogfoodLane(root, { getRemoteUrl: remotes({}) })).toBeNull();
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(path.join(root, ".cursor", "agent-kit.json"), "{}");
    expect(await detectDogfoodLane(root, { getRemoteUrl: remotes({ origin: "x/y" }) })).toBe(
      "consumer",
    );
    await mkdir(path.join(root, "dogfood"), { recursive: true });
    await writeFile(path.join(root, "dogfood", "README.md"), "# x\n");
    expect(await detectDogfoodLane(root, { getRemoteUrl: remotes({}) })).toBe("factory");
  });
});

describe("template + index", () => {
  it("normalizes topic and filename", () => {
    expect(normalizeTopic("Plan-Handoff: context lost! 2026-09-28")).toBe(
      "plan_handoff_context_lost",
    );
    expect(dogfoodFilename("a b", NOW())).toBe("cursor_a_b_2026_09_28.md");
  });

  it("appends under ## or ### Unprocessed and keeps Processed intact", () => {
    const readme = "# I\n\n### Unprocessed Files\n\n- old\n\n### Processed Files\n\n- done\n";
    const out = appendUnprocessedEntry(readme, "- new");
    expect(out).toBe(
      "# I\n\n### Unprocessed Files\n\n- old\n- new\n\n### Processed Files\n\n- done\n",
    );
    const h2 = appendUnprocessedEntry("## Unprocessed Files\n\n## Processed Files\n", "- n");
    expect(h2).toBe("## Unprocessed Files\n\n- n\n\n## Processed Files\n");
    expect(appendUnprocessedEntry("# x\n", "- n")).toContain("### Unprocessed Files\n\n- n");
  });

  it("factory add writes dogfood/ file and index entry", async () => {
    await mkdir(path.join(root, "dogfood"), { recursive: true });
    await writeFile(
      path.join(root, "dogfood", "README.md"),
      "### Unprocessed Files\n\n### Processed Files\n",
    );
    const res = await addDogfoodNote(
      root,
      { topic: "Intake gap", summary: "Intake misses X", tags: ["Intake", "gap"] },
      { getRemoteUrl: remotes({}), now: NOW },
    );
    expect(res.status).toBe("filed");
    if (res.status !== "filed") return;
    expect(res.relativeFile).toBe("dogfood/cursor_intake_gap_2026_09_28.md");
    const note = await readFile(res.file, "utf8");
    expect(note).toContain("# Dogfood: Intake gap");
    expect(note).toContain("- **Lane:** factory");
    expect(note).toContain("Intake misses X");
    expect(note).toContain("- **Tags:** intake, gap");
    const index = await readFile(res.indexFile, "utf8");
    expect(index).toMatch(
      /### Unprocessed Files\n\n- `cursor_intake_gap_2026_09_28\.md` - Intake misses X/,
    );
    expect(index.indexOf("cursor_intake_gap")).toBeLessThan(index.indexOf("### Processed Files"));
  });

  it("consumer add creates .cursor/dogfood with a pinned ### index; second add is refused", async () => {
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(path.join(root, ".cursor", "agent-kit.json"), "{}");
    const deps = { getRemoteUrl: remotes({}), now: NOW };
    const res = await addDogfoodNote(root, { topic: "hook gap" }, deps);
    expect(res.status).toBe("filed");
    const index = await readFile(path.join(root, ".cursor", "dogfood", "README.md"), "utf8");
    expect(index).toContain("### Unprocessed Files");
    expect(index).toContain("cursor_hook_gap_2026_09_28.md");
    expect((await addDogfoodNote(root, { topic: "hook gap" }, deps)).status).toBe("exists");
  });

  it("unknown lane writes nothing", async () => {
    const res = await addDogfoodNote(root, { topic: "x" }, { getRemoteUrl: remotes({}), now: NOW });
    expect(res.status).toBe("unknown-lane");
  });
});

describe("hygiene strip", () => {
  it("redacts secrets, emails, home paths and chat-transient phrases", () => {
    const out = hygieneStrip(
      "as I mentioned, token=abc123 ghp_abcdefghijklmnopqrstuvwx mail me@corp.com at /Users/joe/proj/a.ts",
    );
    expect(out.text).not.toMatch(/abc123|ghp_|me@corp|joe|as I mentioned/i);
    expect(out.redacted).toEqual(expect.arrayContaining(["secret", "email", "path", "transient"]));
    expect(out.needsAnonymization).toBe(true);
  });

  it("clean text passes untouched; add flags needs-anonymization", async () => {
    expect(hygieneStrip("plain kit friction")).toEqual({
      text: "plain kit friction",
      redacted: [],
      needsAnonymization: false,
    });
    await mkdir(path.join(root, "dogfood"), { recursive: true });
    await writeFile(path.join(root, "dogfood", "README.md"), "### Unprocessed Files\n");
    const res = await addDogfoodNote(
      root,
      { topic: "leak", summary: "key at me@corp.com" },
      { getRemoteUrl: remotes({}), now: NOW },
    );
    expect(res.status === "filed" && res.needsAnonymization).toBe(true);
    if (res.status !== "filed") return;
    expect(await readFile(res.file, "utf8")).toContain("needs-anonymization");
  });
});

describe("file-issue", () => {
  const factory = { origin: "git@github-x:agent-kit-startup/agent-kit-dev.git" };

  it("private GitHub: gh issue create in origin with [Dogfood] marker", async () => {
    const { calls, runCli } = recorder();
    const res = await fileDogfoodIssue(
      root,
      { visibility: "private", title: "intake gap", body: "details" },
      { getRemoteUrl: remotes(factory), runCli },
    );
    expect(res.status).toBe("filed");
    expect(res.url).toBe("https://example.test/issues/1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.bin).toBe("gh");
    expect(calls[0]?.args).toEqual([
      "issue",
      "create",
      "--repo",
      "agent-kit-startup/agent-kit-dev",
      "--title",
      "[Dogfood] intake gap",
      "--body",
      "details",
    ]);
  });

  it("private GitLab (self-host): glab api POST with confidential=true and hostname", async () => {
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(path.join(root, ".cursor", "agent-kit.json"), "{}");
    const { calls, runCli } = recorder('{"web_url":"https://git.example.dev/g/p/-/issues/9"}');
    const res = await fileDogfoodIssue(
      root,
      { visibility: "private", title: "[Dogfood] hook", body: "b" },
      { getRemoteUrl: remotes({ origin: "git@git.example.dev:g/p.git" }), runCli },
    );
    expect(res).toMatchObject({
      status: "filed",
      provider: "gitlab",
      confidential: true,
      url: "https://git.example.dev/g/p/-/issues/9",
      title: "[Dogfood] hook",
    });
    expect(calls[0]?.bin).toBe("glab");
    expect(calls[0]?.args).toEqual([
      "api",
      "--method",
      "POST",
      "--hostname",
      "git.example.dev",
      "projects/g%2Fp/issues",
      "-f",
      "title=[Dogfood] hook",
      "-f",
      "description=b",
      "-f",
      "confidential=true",
    ]);
  });

  it("public: refused without approval, refused for consumer, refused on dirty hygiene, filed when clean", async () => {
    const { calls, runCli } = recorder();
    const deps = { getRemoteUrl: remotes(factory), runCli };
    const base = { visibility: "public" as const, title: "gap", body: "clean text" };
    expect((await fileDogfoodIssue(root, base, deps)).status).toBe("refused-not-approved");
    expect(
      (
        await fileDogfoodIssue(
          root,
          { ...base, approvedPublic: true, body: "mail me@corp.com" },
          deps,
        )
      ).status,
    ).toBe("refused-hygiene");
    expect(calls).toHaveLength(0);

    const ok = await fileDogfoodIssue(root, { ...base, approvedPublic: true }, deps);
    expect(ok.status).toBe("filed");
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining(["--repo", "agent-kit-startup/agent-kit", "[Dogfood] gap"]),
    );

    const consumerRoot = await mkdtemp(path.join(os.tmpdir(), "dogfood-consumer-"));
    try {
      await mkdir(path.join(consumerRoot, ".cursor"), { recursive: true });
      await writeFile(path.join(consumerRoot, ".cursor", "agent-kit.json"), "{}");
      const res = await fileDogfoodIssue(
        consumerRoot,
        { ...base, approvedPublic: true },
        {
          getRemoteUrl: remotes({ origin: "git@github.com:o/r.git" }),
          runCli,
        },
      );
      expect(res.status).toBe("refused-consumer-public");
      expect(calls).toHaveLength(1);
    } finally {
      await rm(consumerRoot, { recursive: true, force: true });
    }
  });

  it("degrades without throwing: CLI missing, auth, no remote, unknown lane", async () => {
    const missing: ForgeRunner = async () => {
      throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    };
    const auth: ForgeRunner = async () => {
      throw new Error("gh auth login required");
    };
    const input = { visibility: "private" as const, title: "t", body: "b" };
    expect(
      (await fileDogfoodIssue(root, input, { getRemoteUrl: remotes(factory), runCli: missing }))
        .status,
    ).toBe("skipped-cli-missing");
    expect(
      (await fileDogfoodIssue(root, input, { getRemoteUrl: remotes(factory), runCli: auth }))
        .status,
    ).toBe("skipped-auth");
    await mkdir(path.join(root, "dogfood"), { recursive: true });
    await writeFile(path.join(root, "dogfood", "README.md"), "x");
    expect((await fileDogfoodIssue(root, input, { getRemoteUrl: remotes({}) })).status).toBe(
      "skipped-no-remote",
    );
    const empty = await mkdtemp(path.join(os.tmpdir(), "dogfood-empty-"));
    try {
      expect((await fileDogfoodIssue(empty, input, { getRemoteUrl: remotes({}) })).status).toBe(
        "refused-unknown-lane",
      );
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
