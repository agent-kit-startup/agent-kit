import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateNoticeSection } from "../hooks/session-start.js";
import type { InstallEntry, InstallKind } from "../installs/index.js";
import type { NpmFetch } from "./check-updates.js";
import {
  cachedCliNpmLatest,
  computeUpdateNotice,
  readUpdateNoticeCache,
  resolveUpdateNoticeFile,
  summarizeUpdateNotice,
  UPDATE_NOTICE_TTL_MS,
} from "./update-notice.js";

const NOW = new Date("2026-11-26T12:00:00.000Z");

/** Stub npm: `@dadado/agent-kit-cli` answers `version`, `@missionkit/cli` 404s. */
function npmStub(version: string | null): NpmFetch & ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (version && url.includes("@dadado%2Fagent-kit-cli")) {
      return { ok: true, json: async () => ({ version }) };
    }
    return { ok: false, json: async () => ({}) };
  }) as unknown as NpmFetch & ReturnType<typeof vi.fn>;
}

const offline = vi.fn(async () => {
  throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
}) as unknown as NpmFetch;

function entry(p: string, kitVersion: string | null, kind: InstallKind = "repo"): InstallEntry {
  return {
    path: p,
    remote: null,
    kitVersion,
    cliVersion: "6.0.0",
    lastSeen: NOW.toISOString(),
    kind,
  };
}

let scratch: string;
let home: string;
let cwd: string;
let installsFile: string;
let noticeFile: string;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "ak-update-notice-"));
  home = path.join(scratch, "home");
  cwd = path.join(scratch, "repo");
  await mkdir(path.join(cwd, ".cursor", "context"), { recursive: true });
  installsFile = path.join(scratch, "config", "agent-kit", "installs.json");
  noticeFile = path.join(scratch, "config", "agent-kit", "update-notice.json");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function writeInstalls(installs: InstallEntry[]): Promise<void> {
  await mkdir(path.dirname(installsFile), { recursive: true });
  await writeFile(installsFile, JSON.stringify({ schemaVersion: 1, installs }), "utf8");
}

function opts(fetchImpl: NpmFetch, extra: Record<string, unknown> = {}) {
  return {
    env: {},
    homeDir: home,
    now: NOW,
    cliVersion: "6.22.0",
    fetchImpl,
    file: noticeFile,
    installsFile,
    cliPath: null,
    platform: "linux" as NodeJS.Platform,
    ...extra,
  };
}

describe("resolveUpdateNoticeFile", () => {
  it("sits beside installs.json (env override, XDG, home)", () => {
    expect(resolveUpdateNoticeFile({ AGENT_KIT_INSTALLS_FILE: "/s/x/installs.json" }, "/h")).toBe(
      "/s/x/update-notice.json",
    );
    expect(resolveUpdateNoticeFile({ XDG_CONFIG_HOME: "/xdg" }, "/h")).toBe(
      "/xdg/agent-kit/update-notice.json",
    );
    expect(resolveUpdateNoticeFile({}, "/h")).toBe("/h/.config/agent-kit/update-notice.json");
  });
});

describe("cachedCliNpmLatest (daily cache)", () => {
  it("fetches once, then serves the fresh cache without network", async () => {
    const fetchImpl = npmStub("6.22.0");
    const first = await cachedCliNpmLatest({ file: noticeFile, now: NOW, fetchImpl });
    expect(first).toEqual({ packageName: "@dadado/agent-kit-cli", version: "6.22.0" });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // both package names, in parallel
    const later = new Date(NOW.getTime() + UPDATE_NOTICE_TTL_MS - 1000);
    const second = await cachedCliNpmLatest({ file: noticeFile, now: later, fetchImpl });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refreshes a stale cache (over a day old)", async () => {
    await cachedCliNpmLatest({ file: noticeFile, now: NOW, fetchImpl: npmStub("6.21.0") });
    const fetchImpl = npmStub("6.22.0");
    const stale = new Date(NOW.getTime() + UPDATE_NOTICE_TTL_MS + 1000);
    const result = await cachedCliNpmLatest({ file: noticeFile, now: stale, fetchImpl });
    expect(result?.version).toBe("6.22.0");
    expect(fetchImpl).toHaveBeenCalled();
    expect((await readUpdateNoticeCache(noticeFile))?.checkedAt).toBe(stale.toISOString());
  });

  it("fails open offline and stamps the attempt so the next session does not retry", async () => {
    const result = await cachedCliNpmLatest({ file: noticeFile, now: NOW, fetchImpl: offline });
    expect(result).toBeNull();
    const cache = await readUpdateNoticeCache(noticeFile);
    expect(cache).toMatchObject({ checkedAt: NOW.toISOString(), npm: null });
    const fetchImpl = npmStub("6.22.0");
    await cachedCliNpmLatest({ file: noticeFile, now: NOW, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats an unreadable cache as missing", async () => {
    await mkdir(path.dirname(noticeFile), { recursive: true });
    await writeFile(noticeFile, "{not json", "utf8");
    const fetchImpl = npmStub("6.22.0");
    expect((await cachedCliNpmLatest({ file: noticeFile, now: NOW, fetchImpl }))?.version).toBe(
      "6.22.0",
    );
  });
});

describe("summarizeUpdateNotice", () => {
  const npm = { packageName: "@dadado/agent-kit-cli" as const, version: "6.22.0" };

  it("names both commands when the CLI and installs are behind", () => {
    const summary = summarizeUpdateNotice({
      cliVersion: "6.19.1",
      npmLatest: npm,
      installs: [
        entry("/h/a", "6.0.0"),
        entry("/h/x", "3.0.0"),
        entry("/h/home", "5.0.0", "home"),
        entry("/h/wt", "1.0.0", "worktree"),
        entry("/h/fx", "1.0.0", "fixture"),
        entry("/h/kit", "1.0.0", "factory"),
        entry("/h/cur", "6.19.1"),
        entry("/h/none", null),
      ],
      homeDir: "/h",
      now: NOW,
    });
    expect(summary).toMatchObject({
      cliBehind: true,
      installsBehind: 3,
      oldest: { path: "~/x", kitVersion: "3.0.0" },
      cliCommand: "npm i -g @dadado/agent-kit-cli@latest",
    });
    expect(summary.line).toBe(
      "Agent Kit: CLI 6.19.1 < npm 6.22.0 (`npm i -g @dadado/agent-kit-cli@latest`); 3 installs behind, oldest v3.0.0 at ~/x (`agent-kit update --all`).",
    );
  });

  it("is silent when everything is current (and when the CLI is ahead of npm)", () => {
    for (const cliVersion of ["6.22.0", "6.23.0"]) {
      const summary = summarizeUpdateNotice({
        cliVersion,
        npmLatest: npm,
        installs: [entry("/h/a", cliVersion), entry("/h/wt", "3.0.0", "worktree")],
        homeDir: "/h",
        now: NOW,
      });
      expect(summary.line).toBeNull();
      expect(summary.installsBehind).toBe(0);
    }
  });

  it("names only update --all when the CLI is current", () => {
    const summary = summarizeUpdateNotice({
      cliVersion: "6.22.0",
      npmLatest: npm,
      installs: [entry("/h/a", "6.21.0")],
      homeDir: "/h",
      now: NOW,
    });
    expect(summary.line).toBe(
      "Agent Kit: 1 install behind CLI 6.22.0, oldest v6.21.0 at ~/a (`agent-kit update --all`).",
    );
  });

  it("points a CLI in a per-version node dir at doctor (the mise-safe install)", () => {
    const summary = summarizeUpdateNotice({
      cliVersion: "6.19.1",
      npmLatest: npm,
      installs: [],
      homeDir: "/h",
      now: NOW,
      cliInNodeManager: true,
    });
    expect(summary.cliCommand).toBe("agent-kit doctor");
    expect(summary.line).toContain("`agent-kit doctor`");
    expect(summary.line).not.toContain("npm i -g");
  });

  it("ignores non-semver kit versions instead of throwing", () => {
    const summary = summarizeUpdateNotice({
      cliVersion: "6.22.0",
      npmLatest: null,
      installs: [entry("/h/a", "weird")],
      homeDir: "/h",
      now: NOW,
    });
    expect(summary.line).toBeNull();
  });
});

describe("computeUpdateNotice", () => {
  it("returns the line, persists it for Mission Control, and clears it when current", async () => {
    await writeInstalls([entry(path.join(home, "x"), "3.0.0")]);
    const summary = await computeUpdateNotice(cwd, opts(npmStub("6.22.0")));
    expect(summary?.line).toBe(
      "Agent Kit: 1 install behind CLI 6.22.0, oldest v3.0.0 at ~/x (`agent-kit update --all`).",
    );
    expect((await readUpdateNoticeCache(noticeFile))?.notice).toMatchObject({
      installsBehind: 1,
      oldest: { path: "~/x", kitVersion: "3.0.0" },
    });

    await writeInstalls([entry(path.join(home, "x"), "6.22.0")]);
    const current = await computeUpdateNotice(cwd, opts(npmStub("6.22.0")));
    expect(current?.line).toBeNull();
    expect((await readUpdateNoticeCache(noticeFile))?.notice).toBeNull();
  });

  it("is off under CI, the env opt-outs and updateCheck.enabled false (no fetch, no file)", async () => {
    await writeInstalls([entry(path.join(home, "x"), "3.0.0")]);
    for (const env of [
      { CI: "1" },
      { AGENT_KIT_NO_UPDATE_CHECK: "1" },
      { NO_UPDATE_NOTIFIER: "true" },
    ]) {
      const fetchImpl = npmStub("9.0.0");
      expect(await computeUpdateNotice(cwd, opts(fetchImpl, { env }))).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    await writeFile(
      path.join(cwd, ".cursor", "context", "config.json"),
      JSON.stringify({ updateCheck: { enabled: false } }),
      "utf8",
    );
    const fetchImpl = npmStub("9.0.0");
    expect(await computeUpdateNotice(cwd, opts(fetchImpl))).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(readFile(noticeFile, "utf8")).rejects.toThrow();
  });

  it("offline: still reports installs behind the CLI, never the npm half", async () => {
    await writeInstalls([entry(path.join(home, "x"), "6.0.0")]);
    const summary = await computeUpdateNotice(cwd, opts(offline, { cliVersion: "6.19.1" }));
    expect(summary?.cliBehind).toBe(false);
    expect(summary?.line).toBe(
      "Agent Kit: 1 install behind CLI 6.19.1, oldest v6.0.0 at ~/x (`agent-kit update --all`).",
    );
  });

  it("offline with nothing behind is silent; a broken installs.json is silent too", async () => {
    expect((await computeUpdateNotice(cwd, opts(offline)))?.line).toBeNull();
    await mkdir(path.dirname(installsFile), { recursive: true });
    await writeFile(installsFile, "{oops", "utf8");
    expect((await computeUpdateNotice(cwd, opts(offline)))?.line).toBeNull();
  });
});

describe("updateNoticeSection (sessionStart)", () => {
  it("prints the one line when something is behind", async () => {
    await writeInstalls([entry(path.join(home, "x"), "3.0.0")]);
    const line = await updateNoticeSection(cwd, opts(npmStub("6.22.0"), { cliVersion: "6.19.1" }));
    expect(line).toBe(
      "Agent Kit: CLI 6.19.1 < npm 6.22.0 (`npm i -g @dadado/agent-kit-cli@latest`); 1 install behind, oldest v3.0.0 at ~/x (`agent-kit update --all`).",
    );
  });

  it("is null when current, when opted out and when the lookup hangs past the deadline", async () => {
    expect(await updateNoticeSection(cwd, opts(npmStub("6.22.0")))).toBeNull();
    expect(
      await updateNoticeSection(cwd, opts(npmStub("9.0.0"), { env: { CI: "true" } })),
    ).toBeNull();
    const hang = vi.fn(() => new Promise(() => {})) as unknown as NpmFetch;
    const started = Date.now();
    expect(await updateNoticeSection(cwd, opts(hang, { deadlineMs: 50 }))).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
