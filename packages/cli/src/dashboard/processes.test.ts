import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_STRING, truncateStr } from "../../../../dashboard/lib/guards.mjs";
import { selectWorkspaceProcesses } from "../../../../dashboard/lib/processes.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dataSource = readFileSync(resolve(repoRoot, "dashboard/dashboard-data.mjs"), "utf8");

// Mirrors the token rule in dashboard-data.mjs SECRET_OUTPUT_PATTERNS.
function redact(text: string): string {
  return text.replace(/(?:token|secret|password)\s*[:=]\s*\S+/gi, (m) => {
    const sep = m.includes("=") ? "=" : ":";
    return `${m.split(sep)[0]}${sep}***`;
  });
}

const ROOT = "/work/acme-app";
const SERVE = "/opt/kit/dashboard/serve.mjs";
const opts = {
  root: ROOT,
  servePath: SERVE,
  redact,
  truncate: truncateStr,
  maxCommandChars: MAX_STRING.processCommand,
  maxProcesses: 25,
};

describe("selectWorkspaceProcesses", () => {
  it("drops foreign processes and keeps workspace + serve.mjs rows", () => {
    const ps = [
      "101 0.1 0.2 01:00 node /home/other/secret-app/server.js",
      "102 0.0 0.1 02:00 git -C /elsewhere fetch",
      `103 1.0 0.3 03:00 node ${SERVE}`,
      `104 0.5 0.1 00:10 git -C ${ROOT} status`,
      `105 0.0 0.0 00:01 node ${ROOT}/dashboard/dashboard-data.mjs`,
    ].join("\n");
    const rows = selectWorkspaceProcesses(ps, opts);
    expect(rows.map((r) => r.pid)).toEqual(["103", "104"]);
    expect(rows[0].label).toBe("dashboard-server");
    expect(rows[1].label).toBe("git");
  });

  it("drops a sibling repo whose path only starts with the workspace root", () => {
    const ps = [
      "301 0.0 0.1 00:05 node /work/acme-app-other/server.js --key=x",
      `302 0.0 0.1 00:05 node ${ROOT}/worker.mjs`,
      `303 0.0 0.1 00:05 git -C ${ROOT} status`,
      `304 0.0 0.1 00:05 node "${ROOT}"`,
    ].join("\n");
    expect(selectWorkspaceProcesses(ps, opts).map((r) => r.pid)).toEqual(["302", "303", "304"]);
  });

  it("redacts a --token=<value> arg before truncation", () => {
    const value = ["tok", "runtime", String(Date.now())].join("-");
    const ps = `201 0.0 0.1 00:05 node ${ROOT}/worker.mjs --token=${value} --verbose`;
    const [row] = selectWorkspaceProcesses(ps, opts);
    expect(row.command).not.toContain(value);
    expect(row.fullCommand).not.toContain(value);
    expect(row.fullCommand).toContain("--token=***");
  });

  it("does not leak a secret prefix that truncation would otherwise cut mid-value", () => {
    const value = ["abcdef", "0123456789"].join("");
    // "node <ROOT>/" (20) + pad + " --token=" (9) ends 4 chars before the cap.
    const pad = "x".repeat(MAX_STRING.processCommand - 33);
    const ps = `301 0 0 00:01 node ${ROOT}/${pad} --token=${value}`;
    const [row] = selectWorkspaceProcesses(ps, opts);
    expect(row.command).not.toContain(value.slice(0, 2));
    expect(row.command).toContain("--token=");
  });

  it("returns nothing without scope needles", () => {
    expect(
      selectWorkspaceProcesses("1 0 0 00:01 node x", { ...opts, root: "", servePath: "" }),
    ).toEqual([]);
  });

  it("is wired into dashboard-data.mjs with the terminal redactor", () => {
    expect(dataSource).toMatch(/from ['"]\.\/lib\/processes\.mjs['"]/);
    expect(dataSource).toMatch(
      /selectWorkspaceProcesses\(psOutput, \{[\s\S]*?redact: redactTerminalOutput,/,
    );
  });
});
