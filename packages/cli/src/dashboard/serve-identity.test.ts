import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const servePath = resolve(repoRoot, "dashboard/serve.mjs");

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

/** GET on loopback with an explicit Host header (fetch forbids overriding it). */
function get(
  port: number,
  path: string,
  host = `127.0.0.1:${port}`,
): Promise<{ status: number; body: string }> {
  return new Promise((resolveRes, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: "GET", headers: { Host: host }, timeout: 5_000 },
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
      MISSION_CONTROL_REPO_ROOT: repoRoot,
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

describe("serve.mjs GET /api/identity", () => {
  it("answers {repoRoot, tokenGated:false} on loopback and refuses foreign Host", async () => {
    const { port, child } = await startServe({ HOST: "127.0.0.1", MISSION_CONTROL_TOKEN: "" });
    try {
      const ok = await get(port, "/api/identity");
      expect(ok.status).toBe(200);
      expect(JSON.parse(ok.body)).toEqual({ repoRoot, tokenGated: false });
      const rebind = await get(port, "/api/identity", `attacker.example:${port}`);
      expect(rebind.status).toBe(421);
    } finally {
      await stop(child);
    }
  }, 60_000);

  it("stays behind the broadcast token gate", async () => {
    const token = "b".repeat(16);
    const { port, child } = await startServe({ HOST: "0.0.0.0", MISSION_CONTROL_TOKEN: token });
    try {
      const anon = await get(port, "/api/identity");
      expect(anon.status).toBe(401);
      const ok = await get(port, `/api/identity?token=${token}`);
      expect(ok.status).toBe(200);
      expect(JSON.parse(ok.body)).toEqual({ repoRoot, tokenGated: true });
      const rebind = await get(port, `/api/identity?token=${token}`, `attacker.example:${port}`);
      expect(rebind.status).toBe(421);
    } finally {
      await stop(child);
    }
  }, 60_000);

  it("is what the start scripts probe, with a short timeout", () => {
    for (const rel of ["dashboard/start.mjs", "dashboard/start-broadcast.mjs"]) {
      const src = readFileSync(resolve(repoRoot, rel), "utf8");
      expect(src, rel).toContain("probeListenerRoot(");
      expect(src, rel).not.toContain("/dashboard-data.json?token=");
      expect(src, rel).not.toMatch(/timeout: 8000/);
    }
    // The shared probe asks /api/identity first with a 2 s timeout; the snapshot
    // probe is only the fallback for an older server (see identity-probe.test.ts).
    const probe = readFileSync(resolve(repoRoot, "dashboard/lib/identity-probe.mjs"), "utf8");
    expect(probe.indexOf("/api/identity")).toBeLessThan(probe.indexOf("/dashboard-data.json"));
    expect(probe).toMatch(/timeout: 2000/);
  });
});
