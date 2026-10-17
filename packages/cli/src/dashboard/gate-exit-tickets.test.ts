// Parity between the Mission Control ticket reader (dashboard/lib/gate-exit-tickets.mjs)
// and `agent-kit ground-control status` (groundControlStatus): same marker, same
// gate-exit branches, same merged test, same hidden history. The dashboard copy
// never fetches; the fixtures use a local bare origin, so the CLI's fetch is a no-op.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectGateExitTickets,
  GATE_EXIT_BRANCH_PREFIX,
  GATE_EXIT_DEFAULT_BASE,
  GATE_EXIT_MARKER_RELPATH,
  GATE_EXIT_NOTE_DIR,
  GATE_EXIT_STAMP_RE,
  type GitRunner,
  makeGitRunner,
} from "../../../../dashboard/lib/gate-exit-tickets.mjs";
import { buildFlightLogTickets } from "../../../../dashboard/lib/semantic-model.mjs";
import { groundControlStatus } from "../commands/ground-control.js";
import * as gateExit from "../plan-loop/gate-exit.js";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Ticket Parity Test",
  GIT_AUTHOR_EMAIL: "ticket-parity-test@example.com",
  GIT_COMMITTER_NAME: "Ticket Parity Test",
  GIT_COMMITTER_EMAIL: "ticket-parity-test@example.com",
};

const STAMP = "20261014T093005Z";
const BRANCH = `gate-exit/${STAMP}`;
const NOTE = `.cursor/gate-exit/${STAMP}.md`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

async function repo(opts: { origin?: boolean } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-ticket-parity-"));
  const root = path.join(dir, "root");
  const bare = path.join(dir, "origin.git");
  await mkdir(root);
  git(root, "init", "-q", "-b", "staging");
  await writeFile(
    path.join(root, ".gitignore"),
    ".cursor/context/gate-exit.json\n.cursor/loop-logs/\n",
  );
  await writeFile(path.join(root, "README.md"), "fixture\n");
  git(root, "add", ".gitignore", "README.md");
  git(root, "commit", "-q", "-m", "seed");
  if (opts.origin !== false) {
    git(dir, "init", "-q", "--bare", "-b", "staging", bare);
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "origin", "staging");
  }
  const logPath = path.join(root, ".cursor", "loop-logs", "tick-1.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, "HITL_GATE: backlog-write | Write plan to backlog | Cancel\n");
  return { dir, root, bare, logPath };
}

async function landed(opts: { origin?: boolean } = {}) {
  const fx = await repo(opts);
  const result = await gateExit.landGateExit({
    root: fx.root,
    outcome: {
      trigger: "gate",
      exitCode: 4,
      reason: "stopped: unanswered gate (--no-hitl)",
      askId: "backlog-write",
      command: "run backlog-add",
      backend: "claude",
      logPath: fx.logPath,
    },
    env: GIT_ENV,
    now: new Date("2026-10-14T09:30:05Z"),
    which: async () => null,
  });
  expect(result.committed).toBe(true);
  const marker = await gateExit.readGateExitMarker(fx.root);
  if (marker.kind !== "ok") throw new Error("marker not written");
  await gateExit.writeGateExitMarker(fx.root, {
    ...marker.marker,
    skipped: ["skipped 20261015T030000Z"],
  });
  return fx;
}

async function squashOnOrigin(dir: string, bare: string) {
  const clone = path.join(dir, "squash");
  git(dir, "clone", "-q", "-b", "staging", bare, clone);
  git(clone, "checkout", "-q", `origin/${BRANCH}`, "--", NOTE);
  git(clone, "commit", "-q", "-m", "squash gate exit");
  git(clone, "push", "-q", "origin", "staging");
}

/** Both readers on one root; the CLI fetches first, so the dashboard reads the same refs. */
async function both(root: string) {
  const cli = await groundControlStatus({ cwd: root, env: GIT_ENV });
  if (typeof cli === "string") throw new Error(cli);
  const dash = collectGateExitTickets(root);
  return { cli, dash };
}

function comparable(rows: Record<string, unknown>[]) {
  return rows.map((t) => ({
    stamp: t.stamp,
    headline: t.headline,
    askId: t.askId,
    labels: t.labels,
    trigger: t.trigger,
    openedAt: t.openedAt,
    url: t.url,
    branch: t.branch,
    branchState: t.branchState,
    inMarker: t.inMarker,
  }));
}

describe("gate-exit-tickets.mjs mirrors the CLI contract", () => {
  it("shares the constants of plan-loop/gate-exit.ts", () => {
    expect(GATE_EXIT_BRANCH_PREFIX).toBe(gateExit.GATE_EXIT_BRANCH_PREFIX);
    expect(GATE_EXIT_MARKER_RELPATH).toBe(gateExit.GATE_EXIT_MARKER_RELPATH);
    expect(GATE_EXIT_NOTE_DIR).toBe(gateExit.GATE_EXIT_NOTE_DIR);
    expect(GATE_EXIT_DEFAULT_BASE).toBe(gateExit.GATE_EXIT_DEFAULT_BASE);
    expect(GATE_EXIT_STAMP_RE.source).toBe(gateExit.GATE_EXIT_STAMP_RE.source);
  });

  it("no marker and no gate-exit branch: empty, one git call, never a fetch", async () => {
    const fx = await repo();
    try {
      const calls: string[][] = [];
      const real = makeGitRunner(fx.root);
      const spy: GitRunner = (args) => {
        calls.push(args);
        return real(args);
      };
      const out = collectGateExitTickets(fx.root, { git: spy });
      expect(out).toEqual({
        marker: "absent",
        base: "staging",
        tickets: [],
        skipped: [],
        truncated: false,
      });
      expect(calls.map((c) => c[0])).toEqual(["for-each-ref"]);
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });

  it("pending ticket on an unmerged pushed branch: same rows as ground-control status", async () => {
    const fx = await landed();
    try {
      const { cli, dash } = await both(fx.root);
      expect(dash.marker).toBe(cli.marker);
      expect(dash.base).toBe(cli.base);
      expect(dash.skipped).toEqual(cli.skipped);
      expect(comparable(dash.tickets as never)).toEqual(comparable(cli.tickets as never));
      expect(dash.tickets[0]).toMatchObject({
        stamp: STAMP,
        askId: "backlog-write",
        branch: `origin/${BRANCH}`,
        branchState: "unmerged",
        inMarker: true,
      });
      expect(dash.tickets[0]?.headline).toMatch(/^# Gate exit 20261014T093005Z/);
      const calls: string[][] = [];
      const real = makeGitRunner(fx.root);
      collectGateExitTickets(fx.root, {
        git: (args) => {
          calls.push(args);
          return real(args);
        },
      });
      expect(calls.some((c) => c[0] === "fetch" || c[0] === "push")).toBe(false);
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });

  it("squash-merged note on the base: merged, still a ticket while the marker holds it", async () => {
    const fx = await landed();
    try {
      await squashOnOrigin(fx.dir, fx.bare);
      const { cli, dash } = await both(fx.root);
      expect(comparable(dash.tickets as never)).toEqual(comparable(cli.tickets as never));
      expect(dash.tickets[0]?.branchState).toBe("merged");
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });

  it("branch without a marker entry: listed while unmerged, hidden once merged", async () => {
    const fx = await landed();
    try {
      await rm(path.join(fx.root, GATE_EXIT_MARKER_RELPATH));
      let { cli, dash } = await both(fx.root);
      expect(comparable(dash.tickets as never)).toEqual(comparable(cli.tickets as never));
      expect(dash.tickets[0]).toMatchObject({ inMarker: false, branchState: "unmerged" });
      await squashOnOrigin(fx.dir, fx.bare);
      ({ cli, dash } = await both(fx.root));
      expect(cli.tickets).toEqual([]);
      expect(dash.tickets).toEqual([]);
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });

  it("no origin: the local gate-exit branch carries the ticket", async () => {
    const fx = await landed({ origin: false });
    try {
      const { cli, dash } = await both(fx.root);
      expect(comparable(dash.tickets as never)).toEqual(comparable(cli.tickets as never));
      expect(dash.tickets[0]?.branch).toBe(BRANCH);
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });

  it("an unreadable marker is reported, never thrown", async () => {
    const fx = await repo();
    try {
      await mkdir(path.join(fx.root, ".cursor", "context"), { recursive: true });
      await writeFile(path.join(fx.root, GATE_EXIT_MARKER_RELPATH), "{not json");
      expect(collectGateExitTickets(fx.root).marker).toBe("invalid");
      expect(collectGateExitTickets(path.join(fx.dir, "missing")).tickets).toEqual([]);
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });

  it("redacts the headline and labels and drops a non-http review url", async () => {
    const fx = await landed();
    try {
      const marker = await gateExit.readGateExitMarker(fx.root);
      if (marker.kind !== "ok") throw new Error("marker");
      const entry = marker.marker.pending[0];
      if (!entry) throw new Error("entry");
      await gateExit.writeGateExitMarker(fx.root, {
        ...marker.marker,
        pending: [{ ...entry, url: "javascript:alert(1)", labels: ["TOKEN=abc123"] }],
      });
      const out = collectGateExitTickets(fx.root, {
        redact: (s) => s.replace(/TOKEN=\S+/g, "TOKEN=***"),
      });
      expect(out.tickets[0]?.url).toBeNull();
      expect(out.tickets[0]?.labels).toEqual(["TOKEN=***"]);
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });
});

describe("buildFlightLogTickets (Flight Log tickets lane)", () => {
  it("shapes rows read-only with the triage command and drops invalid stamps", () => {
    const rows = buildFlightLogTickets([
      {
        stamp: STAMP,
        headline: `# Gate exit ${STAMP}: unanswered gate backlog-write`,
        askId: "backlog-write",
        branch: `origin/${BRANCH}`,
        branchState: "unmerged",
        url: "https://example.com/pr/1",
        inMarker: true,
      },
      { stamp: "not-a-stamp", headline: "x" },
      { stamp: "20261015T010203Z", headline: null, branchState: "merged", inMarker: false },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: `flight-log-ticket:${STAMP}`,
      text: `Gate exit ${STAMP}: unanswered gate backlog-write`,
      branchState: "unmerged",
      triage: `agent-kit ground-control accept|discard ${STAMP}`,
      sourcePath: GATE_EXIT_MARKER_RELPATH,
    });
    expect(rows[1]).toMatchObject({
      text: "Gate exit 20261015T010203Z (note not readable)",
      triage: "agent-kit ground-control accept 20261015T010203Z",
    });
    expect(Object.keys(rows[0] ?? {})).not.toContain("action");
  });

  it("caps the lane", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      stamp: `2026101${i}T000000Z`,
      headline: `# n${i}`,
    }));
    expect(buildFlightLogTickets(many)).toHaveLength(5);
    expect(buildFlightLogTickets(many, { cap: 2 })).toHaveLength(2);
  });
});
