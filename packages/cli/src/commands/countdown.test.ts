import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GATE_EXIT_MARKER_RELPATH,
  type GateExitMarker,
  type LandGateExitOptions,
  type LandGateExitResult,
  readGateExitMarker,
  writeGateExitMarker,
} from "../plan-loop/gate-exit.js";
import {
  COUNTDOWN_EXIT,
  countdownChildArgs,
  countdownExitCode,
  executeCountdown,
  type JobHandle,
  type SpawnJob,
  superviseJob,
} from "./countdown.js";

/** Git isolated from the host's global/system config (hooks, signing). */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Countdown Test",
  GIT_AUTHOR_EMAIL: "countdown-test@example.com",
  GIT_COMMITTER_NAME: "Countdown Test",
  GIT_COMMITTER_EMAIL: "countdown-test@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

/**
 * A repository on `staging` with the kit's ignore rules; optionally a bare
 * `origin`. `loopLogsIgnored: false` is a consumer install whose `.gitignore`
 * predates the `.cursor/loop-logs/` pattern.
 */
async function repo(opts: { origin?: boolean; loopLogsIgnored?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-countdown-test-"));
  const root = path.join(dir, "root");
  await mkdir(root);
  git(root, "init", "-q", "-b", "staging");
  await writeFile(
    path.join(root, ".gitignore"),
    opts.loopLogsIgnored === false
      ? ".cursor/context/gate-exit.json\n"
      : ".cursor/context/gate-exit.json\n.cursor/loop-logs/\n",
  );
  await writeFile(path.join(root, "README.md"), "fixture\n");
  git(root, "add", ".gitignore", "README.md");
  git(root, "commit", "-q", "-m", "seed");
  if (opts.origin) {
    const bare = path.join(dir, "origin.git");
    git(dir, "init", "-q", "--bare", "-b", "staging", bare);
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "origin", "staging");
  }
  return root;
}

const whichClaude = async (bin: string) => (bin === "claude" ? "/usr/local/bin/claude" : null);

/** A fake child: scripted output, records signals, exits when told (or on a signal when `dieOn`). */
function fakeChild(opts: { dieOn?: NodeJS.Signals } = {}) {
  const listeners: Array<(t: string) => void> = [];
  const signals: NodeJS.Signals[] = [];
  let finish: (v: { code: number | null; signal: NodeJS.Signals | null }) => void = () => {};
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => {
    finish = r;
  });
  const handle: JobHandle = {
    onData: (l) => listeners.push(l),
    kill: (signal) => {
      signals.push(signal);
      if (signal === opts.dieOn || signal === "SIGKILL") finish({ code: null, signal });
    },
    exited,
  };
  return {
    handle,
    signals,
    emit: (text: string) => {
      for (const l of listeners) l(text);
    },
    exit: (code: number) => finish({ code, signal: null }),
  };
}

function spawnReturning(child: ReturnType<typeof fakeChild>) {
  const calls: Array<readonly string[]> = [];
  const spawnJob: SpawnJob = (args) => {
    calls.push(args);
    return child.handle;
  };
  return { spawnJob, calls };
}

function recordingLand() {
  const calls: LandGateExitOptions[] = [];
  const land = async (opts: LandGateExitOptions): Promise<LandGateExitResult> => {
    calls.push(opts);
    return {
      stamp: "20261015T000000Z",
      branch: null,
      committed: false,
      pushed: false,
      url: null,
      markerWritten: false,
      note: "",
    };
  };
  return { land, calls };
}

const base = {
  backend: "auto",
  job: "tick",
  maxTicks: "1",
  windowMin: "120",
  stallMin: "20",
  env: GIT_ENV,
  whichFn: whichClaude,
  write: () => {},
  now: new Date("2026-10-15T03:00:00Z"),
};

afterEach(() => {
  vi.useRealTimers();
});

describe("countdownExitCode", () => {
  it("maps the child's end to 0 / 2 / 3 and never returns 4", () => {
    expect(countdownExitCode({ code: 0, circuitsDead: null, pendingGrew: false })).toBe(0);
    expect(countdownExitCode({ code: 0, circuitsDead: null, pendingGrew: true })).toBe(2);
    expect(countdownExitCode({ code: 4, circuitsDead: null, pendingGrew: true })).toBe(2);
    expect(countdownExitCode({ code: 1, circuitsDead: null, pendingGrew: false })).toBe(3);
    expect(countdownExitCode({ code: null, circuitsDead: null, pendingGrew: false })).toBe(3);
    expect(countdownExitCode({ code: 0, circuitsDead: "window", pendingGrew: false })).toBe(3);
    expect(countdownExitCode({ code: 4, circuitsDead: "stall", pendingGrew: false })).toBe(3);
  });
});

describe("countdownChildArgs", () => {
  it("runs one run-plan tick with --no-hitl and --land-on-gate by default", () => {
    expect(countdownChildArgs({ job: "tick", backend: "claude", maxTicks: 1 })).toEqual([
      "run-plan",
      "--backend",
      "claude",
      "--max-ticks",
      "1",
      "--no-hitl",
      "--land-on-gate",
      "--plain",
    ]);
  });

  it("dispatches agent-kit run <slash> with the same gate flags", () => {
    expect(
      countdownChildArgs({
        job: "dispatch",
        slash: "/backlog-add",
        backend: "cursor-agent",
        maxTicks: 2,
        model: "m",
      }),
    ).toEqual([
      "run",
      "backlog-add",
      "--backend",
      "cursor-agent",
      "--max-ticks",
      "2",
      "--no-hitl",
      "--land-on-gate",
      "--plain",
      "--model",
      "m",
    ]);
  });
});

describe("countdownChildArgs: review", () => {
  it("runs agent-kit run review-pack with the pack ceiling and the gate flags", () => {
    expect(
      countdownChildArgs({ job: "review", backend: "claude", maxTicks: 1, maxPackBytes: 4096 }),
    ).toEqual([
      "run",
      "review-pack",
      "--backend",
      "claude",
      "--max-pack-bytes",
      "4096",
      "--no-hitl",
      "--land-on-gate",
      "--plain",
    ]);
  });

  it("forwards --include-reviewed to the review job only", () => {
    const args = countdownChildArgs({
      job: "review",
      backend: "claude",
      maxTicks: 1,
      maxPackBytes: 4096,
      includeReviewed: true,
    });
    expect(args).toContain("--include-reviewed");
    expect(args.indexOf("--include-reviewed")).toBeLessThan(args.indexOf("--no-hitl"));
    expect(
      countdownChildArgs({ job: "review", backend: "claude", maxTicks: 1, maxPackBytes: 4096 }),
    ).not.toContain("--include-reviewed");
    expect(
      countdownChildArgs({ job: "tick", backend: "claude", maxTicks: 1, includeReviewed: true }),
    ).not.toContain("--include-reviewed");
  });
});

describe("executeCountdown --job review", () => {
  const whichOnly = (name: string) => async (bin: string) =>
    bin === name ? `/usr/local/bin/${name}` : null;

  it("refuses backends without a review-only contract and ceilings past the backend limit", async () => {
    const cwd = "/nonexistent";
    const codex = await executeCountdown({
      ...base,
      cwd,
      job: "review",
      backend: "codex",
      whichFn: whichOnly("codex"),
    });
    expect(codex.exitCode).toBe(COUNTDOWN_EXIT.usage);
    expect(codex.error).toMatch(/claude or cursor-agent only/);
    const big = await executeCountdown({
      ...base,
      cwd,
      job: "review",
      backend: "cursor-agent",
      whichFn: whichOnly("cursor-agent"),
      maxPackBytes: String(200 * 1024),
    });
    expect(big.error).toMatch(/above the cursor-agent limit/);
    expect(
      (await executeCountdown({ ...base, cwd, job: "review", maxPackBytes: "12x" })).error,
    ).toMatch(/--max-pack-bytes must be a positive integer/);
  });

  it("spawns run review-pack and exits 2 once the findings landed (a new ticket is pending)", async () => {
    const root = await repo();
    const child = fakeChild();
    const { spawnJob, calls } = spawnReturning(child);
    const { land, calls: landed } = recordingLand();
    const run = executeCountdown({ ...base, cwd: root, job: "review", spawnJob, land });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]?.slice(0, 2)).toEqual(["run", "review-pack"]);
    expect(calls[0]).toContain("--max-pack-bytes");
    // The child lands its findings: a new marker entry appears.
    await writeGateExitMarker(root, {
      schema: 1,
      pending: [
        {
          stamp: "20261015T030500Z",
          openedAt: "2026-10-15T03:05:00.000Z",
          trigger: "review",
          askId: null,
          labels: [],
          base: "staging",
          branch: null,
          pushed: false,
          url: null,
        },
      ],
      skipped: [],
    });
    child.exit(0);
    const r = await run;
    expect(r.exitCode).toBe(COUNTDOWN_EXIT.pending);
    expect(landed).toEqual([]);
    const log = await readFile(r.logPath ?? "", "utf8");
    expect(log).toContain("pack ceiling 98304 bytes");
    expect(log).toContain("review findings landed; gate exit pending");
  });
});

describe("superviseJob", () => {
  it("window overrun: SIGTERM, then SIGKILL after the grace, as Circuit's Dead", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const causes: string[] = [];
    const done = superviseJob(child.handle, {
      windowMs: 10_000,
      stallMs: 4_000,
      killGraceMs: 1_000,
      onCircuitsDead: (c) => causes.push(c),
    });
    // Output every 3 s keeps the stall timer from firing.
    for (let t = 0; t < 3; t++) {
      await vi.advanceTimersByTimeAsync(3_000);
      child.emit("event\n");
    }
    expect(child.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.signals).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    const end = await done;
    expect(end).toEqual({ code: null, signal: "SIGKILL", circuitsDead: "window" });
    expect(causes).toEqual(["window"]);
  });

  it("stall: no stream event for the stall window stops the job", async () => {
    vi.useFakeTimers();
    const child = fakeChild({ dieOn: "SIGTERM" });
    const done = superviseJob(child.handle, {
      windowMs: 60_000,
      stallMs: 5_000,
      killGraceMs: 1_000,
    });
    child.emit("first event\n");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(child.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const end = await done;
    expect(child.signals).toEqual(["SIGTERM"]);
    expect(end.circuitsDead).toBe("stall");
  });

  it("a child that exits in time is not signalled", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const done = superviseJob(child.handle, {
      windowMs: 60_000,
      stallMs: 5_000,
      killGraceMs: 1_000,
    });
    child.exit(0);
    expect(await done).toEqual({ code: 0, signal: null, circuitsDead: null });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(child.signals).toEqual([]);
  });
});

describe("executeCountdown refusals", () => {
  it("refuses git-prod and kit-prod before touching the repository", async () => {
    const child = fakeChild();
    const { spawnJob, calls } = spawnReturning(child);
    for (const slash of ["git-prod", "/kit-prod"]) {
      const r = await executeCountdown({
        ...base,
        cwd: "/nonexistent",
        job: "dispatch",
        slash,
        spawnJob,
      });
      expect(r.exitCode).toBe(COUNTDOWN_EXIT.usage);
      expect(r.error).toMatch(/operator-gated|never|refused/i);
    }
    const asJob = await executeCountdown({
      ...base,
      cwd: "/nonexistent",
      job: "git-prod",
      spawnJob,
    });
    expect(asJob.exitCode).toBe(1);
    expect(calls).toEqual([]);
  });

  it("validates --job, --slash and the caps", async () => {
    const cwd = "/nonexistent";
    expect((await executeCountdown({ ...base, cwd, job: "nightly" })).error).toMatch(/--job/);
    expect(
      (await executeCountdown({ ...base, cwd, job: "tick", maxPackBytes: "1000" })).error,
    ).toMatch(/--max-pack-bytes only applies to --job review/);
    for (const extra of [{ job: "tick" }, { job: "dispatch", slash: "backlog-add" }]) {
      expect(
        (await executeCountdown({ ...base, cwd, ...extra, includeReviewed: true })).error,
      ).toMatch(/--include-reviewed only applies to --job review/);
    }
    expect((await executeCountdown({ ...base, cwd, job: "dispatch" })).error).toMatch(/--slash/);
    expect((await executeCountdown({ ...base, cwd, slash: "backlog-add" })).error).toMatch(
      /only applies/,
    );
    expect((await executeCountdown({ ...base, cwd, windowMin: "0" })).error).toMatch(
      /--window-min/,
    );
    expect((await executeCountdown({ ...base, cwd, maxTicks: "1.5" })).error).toMatch(
      /--max-ticks/,
    );
  });

  it("refuses while a gate exit is pending, records the skipped run and exits 2", async () => {
    const root = await repo();
    const marker: GateExitMarker = {
      schema: 1,
      pending: [
        {
          stamp: "20261014T010000Z",
          openedAt: "2026-10-14T01:00:00.000Z",
          trigger: "gate",
          askId: "risk",
          labels: [],
          base: "staging",
          branch: null,
          pushed: false,
          url: null,
        },
      ],
      skipped: [],
    };
    await writeGateExitMarker(root, marker);
    const child = fakeChild();
    const { spawnJob, calls } = spawnReturning(child);
    const r = await executeCountdown({ ...base, cwd: root, spawnJob });
    expect(r.exitCode).toBe(COUNTDOWN_EXIT.pending);
    expect(calls).toEqual([]);
    const after = await readGateExitMarker(root);
    expect(after.kind === "ok" && after.marker.skipped).toEqual(["skipped 20261015T030000Z"]);
    expect(after.kind === "ok" && after.marker.pending.length).toBe(1);
    expect(await readFile(r.logPath ?? "", "utf8")).toContain(
      "gate exit pending (20261014T010000Z)",
    );
  });

  it("refuses an unreadable marker (exit 2)", async () => {
    const root = await repo();
    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(path.join(root, GATE_EXIT_MARKER_RELPATH), "{not json");
    const { spawnJob, calls } = spawnReturning(fakeChild());
    const r = await executeCountdown({ ...base, cwd: root, spawnJob });
    expect(r.exitCode).toBe(COUNTDOWN_EXIT.pending);
    expect(calls).toEqual([]);
  });

  it("refuses a dirty root tree as Circuit's Dead (exit 3), recorded in the log", async () => {
    const root = await repo();
    await writeFile(path.join(root, "README.md"), "edited\n");
    const { spawnJob, calls } = spawnReturning(fakeChild());
    const r = await executeCountdown({ ...base, cwd: root, spawnJob });
    expect(r.exitCode).toBe(COUNTDOWN_EXIT.circuitsDead);
    expect(calls).toEqual([]);
    const log = await readFile(r.logPath ?? "", "utf8");
    expect(log).toContain("Circuit's Dead: the working tree is dirty (1 path(s))");
    // The root tree is reported, not cleaned.
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("edited\n");
  });

  it("refuses an unmerged gate-exit branch with no marker entry (exit 2)", async () => {
    const root = await repo({ origin: true });
    git(root, "switch", "-q", "-c", "gate-exit/20261013T000000Z");
    await writeFile(path.join(root, "note.md"), "note\n");
    git(root, "add", "note.md");
    git(root, "commit", "-q", "-m", "note");
    git(root, "push", "-q", "origin", "gate-exit/20261013T000000Z");
    git(root, "switch", "-q", "staging");
    git(root, "branch", "-q", "-D", "gate-exit/20261013T000000Z");
    const { spawnJob, calls } = spawnReturning(fakeChild());
    const r = await executeCountdown({ ...base, cwd: root, spawnJob });
    expect(r.exitCode).toBe(COUNTDOWN_EXIT.pending);
    expect(calls).toEqual([]);
    expect(await readFile(r.logPath ?? "", "utf8")).toContain(
      "unmerged gate-exit branch(es) with no marker entry: origin/gate-exit/20261013T000000Z",
    );
  });

  it("a merged gate-exit branch does not block the fire", async () => {
    const root = await repo({ origin: true });
    git(root, "push", "-q", "origin", "staging:refs/heads/gate-exit/20261012T000000Z");
    const child = fakeChild();
    const { spawnJob, calls } = spawnReturning(child);
    const run = executeCountdown({ ...base, cwd: root, spawnJob });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    child.exit(0);
    expect((await run).exitCode).toBe(0);
  });
});

describe("executeCountdown runs", () => {
  it("runs one tick with --no-hitl --land-on-gate and exits 0 on completion", async () => {
    const root = await repo();
    const child = fakeChild();
    const { spawnJob, calls } = spawnReturning(child);
    const { land, calls: landed } = recordingLand();
    const run = executeCountdown({ ...base, cwd: root, spawnJob, land });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    child.emit("tick done\n");
    child.exit(0);
    const r = await run;
    expect(r.exitCode).toBe(0);
    expect(calls[0]).toEqual([
      "run-plan",
      "--backend",
      "claude",
      "--max-ticks",
      "1",
      "--no-hitl",
      "--land-on-gate",
      "--plain",
    ]);
    expect(landed).toEqual([]);
    const log = await readFile(r.logPath ?? "", "utf8");
    expect(log).toContain("tick done");
    expect(log).toContain("exit 0 (completed)");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("a consumer repo without the loop-logs ignore line: the second fire does not refuse its own logs", async () => {
    const root = await repo({ loopLogsIgnored: false });
    // Left untracked by a fire from before the loop-logs dir ignored itself.
    await mkdir(path.join(root, ".cursor", "loop-logs"), { recursive: true });
    await writeFile(path.join(root, ".cursor", "loop-logs", "tick-old.log"), "old\n");
    const fire = async (now: Date) => {
      const child = fakeChild();
      const { spawnJob, calls } = spawnReturning(child);
      const { land, calls: landed } = recordingLand();
      const run = executeCountdown({ ...base, now, cwd: root, spawnJob, land });
      await vi.waitFor(() => expect(calls.length).toBe(1));
      // The child's own run log, as `run-plan` writes it.
      await writeFile(path.join(root, ".cursor", "loop-logs", `tick-${now.getTime()}.log`), "x\n");
      child.emit("tick done\n");
      child.exit(0);
      const r = await run;
      expect(landed).toEqual([]);
      return r;
    };
    expect((await fire(new Date("2026-10-15T03:00:00Z"))).exitCode).toBe(0);
    expect(git(root, "status", "--porcelain")).toBe("");
    const second = await fire(new Date("2026-10-15T04:00:00Z"));
    expect(second.exitCode).toBe(0);
    expect(await readFile(second.logPath ?? "", "utf8")).not.toContain("working tree is dirty");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("redacts a token split across two output chunks in the echo and the log", async () => {
    const root = await repo();
    const token = ["seeded", "gh", "token", "v+7/x="].join("-");
    const echoed: string[] = [];
    const child = fakeChild();
    const { spawnJob, calls } = spawnReturning(child);
    const { land } = recordingLand();
    const run = executeCountdown({
      ...base,
      env: { ...GIT_ENV, GH_TOKEN: token },
      write: (text: string) => echoed.push(text),
      cwd: root,
      spawnJob,
      land,
    });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    child.emit(`auth ${token.slice(0, 9)}`);
    child.emit(`${token.slice(9)} ok\nlast line without newline`);
    child.exit(0);
    const r = await run;
    const log = await readFile(r.logPath ?? "", "utf8");
    for (const text of [log, echoed.join("")]) {
      expect(text).not.toContain(token);
      expect(text).toContain("auth [GH_TOKEN] ok\n");
      expect(text).toContain("last line without newline");
    }
  });

  it("maps the inner --no-hitl exit 4 to 2 and leaves the landing to the child", async () => {
    const root = await repo();
    const child = fakeChild();
    const { spawnJob, calls } = spawnReturning(child);
    const { land, calls: landed } = recordingLand();
    const run = executeCountdown({ ...base, cwd: root, spawnJob, land });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    child.exit(4);
    expect((await run).exitCode).toBe(COUNTDOWN_EXIT.pending);
    expect(landed).toEqual([]);
  });

  it("window overrun ends as Circuit's Dead (exit 3) and lands the cause", async () => {
    const root = await repo();
    const child = fakeChild({ dieOn: "SIGTERM" });
    const { spawnJob, calls } = spawnReturning(child);
    const { land, calls: landed } = recordingLand();
    const r = await executeCountdown({
      ...base,
      cwd: root,
      windowMin: "0.0005", // 30 ms
      stallMin: "1",
      killGraceMs: 10,
      spawnJob,
      land,
    });
    expect(calls.length).toBe(1);
    expect(r.exitCode).toBe(COUNTDOWN_EXIT.circuitsDead);
    expect(child.signals[0]).toBe("SIGTERM");
    expect(landed).toHaveLength(1);
    expect(landed[0]?.outcome.trigger).toBe("failure");
    expect(landed[0]?.outcome.reason).toMatch(/^Circuit's Dead: window of 0.0005 min exceeded/);
    expect(landed[0]?.outcome.logPath).toBe(r.logPath);
    expect(await readFile(r.logPath ?? "", "utf8")).toContain(
      "Circuit's Dead: the 0.0005 min window is over",
    );
  });

  it("a child failure that left no gate-exit entry is landed by Countdown (exit 3)", async () => {
    const root = await repo();
    const child = fakeChild();
    const { spawnJob, calls } = spawnReturning(child);
    const { land, calls: landed } = recordingLand();
    const run = executeCountdown({ ...base, cwd: root, spawnJob, land });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    child.exit(1);
    expect((await run).exitCode).toBe(COUNTDOWN_EXIT.circuitsDead);
    expect(landed[0]?.outcome.reason).toBe("Circuit's Dead: job exited with code 1");
  });

  it("a child failure that already landed is not landed twice", async () => {
    const root = await repo();
    const child = fakeChild();
    const { spawnJob, calls } = spawnReturning(child);
    const { land, calls: landed } = recordingLand();
    const run = executeCountdown({ ...base, cwd: root, spawnJob, land });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    await writeGateExitMarker(root, {
      schema: 1,
      pending: [
        {
          stamp: "20261015T030500Z",
          openedAt: "2026-10-15T03:05:00.000Z",
          trigger: "failure",
          askId: null,
          labels: [],
          base: "staging",
          branch: null,
          pushed: false,
          url: null,
        },
      ],
      skipped: [],
    });
    child.exit(1);
    expect((await run).exitCode).toBe(COUNTDOWN_EXIT.circuitsDead);
    expect(landed).toEqual([]);
  });
});
