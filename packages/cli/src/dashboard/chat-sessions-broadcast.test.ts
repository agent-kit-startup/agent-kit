// Chat titles are private: a broadcast Mission Control (non-loopback bind, token-gated) must never
// serve them. Two layers: dashboard-data.mjs withholds when it sees the broadcast bind env, and
// serve.mjs strips `chats` from every payload it caches when it runs in broadcast mode.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const servePath = resolve(repoRoot, "dashboard/serve.mjs");
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const SENTINEL = "lan-leak-sentinel-title-4b8e";
const TOKEN = "c".repeat(24);

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolvePort(p));
    });
    s.on("error", reject);
  });
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolveRes, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { Host: `127.0.0.1:${port}` },
        timeout: 60_000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += String(c);
        });
        res.on("end", () => resolveRes({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** Scratch git repo + fake HOME holding one saved chat titled SENTINEL for it. */
function scratchWorkspace(): { repo: string; home: string } {
  const repo = mkdtempSync(join(tmpdir(), "ak-chats-bc-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const home = mkdtempSync(join(tmpdir(), "ak-chats-bc-home-"));
  const dir = join(home, ".claude", "projects", repo.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${SESSION_ID}.jsonl`),
    `${JSON.stringify({ type: "custom-title", customTitle: SENTINEL })}\n`,
  );
  return { repo, home };
}

async function startServe(
  env: Record<string, string>,
): Promise<{ port: number; child: ChildProcess }> {
  const port = await freePort();
  const child = spawn(process.execPath, [servePath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MISSION_CONTROL_NO_OPEN: "1",
      AGENT_KIT_DASHBOARD_DATA_BUDGET_MS: "5000",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (c) => {
    stderr += String(c);
  });
  let exited: number | null = null;
  child.on("exit", (code) => {
    exited = code ?? -1;
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && exited === null) {
    try {
      const res = await get(port, "/open.html");
      if (res.status === 200) return { port, child };
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`serve.mjs never answered on :${port} (exit=${exited}) ${stderr}`);
}

async function stop(child: ChildProcess) {
  child.kill("SIGTERM");
  await once(child, "exit").catch(() => undefined);
}

describe("Mission Control broadcast never serves chat titles", () => {
  it("loopback serve lists the chat (control)", async () => {
    const { repo, home } = scratchWorkspace();
    const { port, child } = await startServe({
      HOST: "127.0.0.1",
      MISSION_CONTROL_TOKEN: "",
      HOME: home,
      MISSION_CONTROL_REPO_ROOT: repo,
    });
    try {
      const res = await get(port, "/api/data");
      expect(res.status).toBe(200);
      expect(res.body).toContain(SENTINEL);
      const snap = JSON.parse(res.body);
      expect(snap.chats.withheld).toBe(false);
      expect(snap.chats.vendors[0].sessions[0]).toMatchObject({ id: SESSION_ID, title: SENTINEL });
    } finally {
      await stop(child);
    }
  }, 90_000);

  it("broadcast serve answers /api/data and /dashboard-data.json without any session", async () => {
    const { repo, home } = scratchWorkspace();
    const { port, child } = await startServe({
      HOST: "0.0.0.0",
      MISSION_CONTROL_TOKEN: TOKEN,
      HOME: home,
      MISSION_CONTROL_REPO_ROOT: repo,
    });
    try {
      for (const path of [`/api/data?token=${TOKEN}`, `/dashboard-data.json?token=${TOKEN}`]) {
        const res = await get(port, path);
        expect(res.status, path).toBe(200);
        expect(res.body, path).not.toContain(SENTINEL);
        expect(res.body, path).not.toContain(SESSION_ID);
        expect(JSON.parse(res.body).chats, path).toEqual({ withheld: true, vendors: [] });
      }
    } finally {
      await stop(child);
    }
  }, 90_000);

  it("serve.mjs strips chats from every cached payload when bound for broadcast", () => {
    const serve = readFileSync(servePath, "utf8");
    // The one place every route (/api/data, SSE connect, SSE push) reads from.
    expect(serve).toMatch(
      /resolve\(authResolved\.broadcast \? withholdChatsFromPayload\(stdout\) : stdout\);/,
    );
    // The error payload never carries sessions either.
    expect(serve).toMatch(/chats: \{ withheld: authResolved\.broadcast, vendors: \[\] \}/);
  });

  it("the share-link module carries only the LAN URL, never snapshot data", () => {
    const share = readFileSync(resolve(repoRoot, "dashboard/lib/broadcast-share.mjs"), "utf8");
    expect(share).not.toMatch(/chats|sessions|dashboard-data/);
  });
});
