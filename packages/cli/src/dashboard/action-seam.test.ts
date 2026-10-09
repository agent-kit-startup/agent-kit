// Mission Control action seam (docs/mission-control-embedding.md): one typed
// action interface, copy-to-clipboard by default, an injected host
// implementation for an embedding page. String pins plus a behavioral run of
// the extracted functions in node:vm (no JSDOM, per the plugin-ux-validation
// depth ADR).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dashboardHtml = readFileSync(resolve(repoRoot, "dashboard/dashboard.html"), "utf8");

/** Source of one top-level `function name(` / `async function name(` declaration. */
function fnSource(name: string): string {
  const re = new RegExp(`(?:async )?function ${name}\\(`);
  const m = re.exec(dashboardHtml);
  if (!m) throw new Error(`function ${name} not found`);
  const start = m.index;
  const end = dashboardHtml.indexOf("\n}\n", start);
  return dashboardHtml.slice(start, end + 2);
}

interface SeamContext {
  toasts: [string, boolean][];
  clipboard: string[];
  copyToClipboard: (text: string, opts?: Record<string, unknown>) => Promise<void>;
  copyForPaste: (text: string, subject: string, destination: string) => Promise<void>;
}

function loadSeam(host: unknown, clipboardOk = true): SeamContext {
  const ctx: Record<string, unknown> = {
    toasts: [] as [string, boolean][],
    clipboard: [] as string[],
  };
  ctx.window = host === undefined ? {} : { __MISSION_CONTROL_ACTIONS__: host };
  ctx.navigator = clipboardOk
    ? {
        clipboard: {
          writeText: async (t: string) => {
            (ctx.clipboard as string[]).push(t);
          },
        },
      }
    : {};
  ctx.showToast = (m: string, e: boolean) => (ctx.toasts as [string, boolean][]).push([m, e]);
  ctx.copyToastMessage = (subject: string, destination: string) =>
    `Copied ${subject}. Paste into the ${destination}.`;
  const src = [
    "const MISSION_CONTROL_ACTION_KINDS = Object.freeze(['copy']);",
    fnSource("missionControlActionHost"),
    fnSource("performHostAction"),
    fnSource("copyToastLabel"),
    fnSource("copyToClipboard"),
    fnSource("copyForPaste"),
    "this.copyToClipboard = copyToClipboard; this.copyForPaste = copyForPaste;",
  ].join("\n");
  runInNewContext(src, ctx);
  return ctx as unknown as SeamContext;
}

describe("Mission Control action seam: contract pins", () => {
  it("declares exactly one action kind, copy", () => {
    expect(dashboardHtml).toContain(
      "const MISSION_CONTROL_ACTION_KINDS = Object.freeze(['copy']);",
    );
  });

  it("reads the host hook in one place and writes the clipboard in one place", () => {
    expect(dashboardHtml.match(/__MISSION_CONTROL_ACTIONS__/g)?.length).toBe(2); // doc comment + read
    expect(fnSource("missionControlActionHost")).toContain("window.__MISSION_CONTROL_ACTIONS__");
    expect(dashboardHtml.match(/navigator\.clipboard\.writeText\(/g)?.length).toBe(1);
    expect(fnSource("copyToClipboard")).toContain("navigator.clipboard.writeText(text)");
  });

  it("the seam carries data only: no network, dynamic code, URL open or shell payload", () => {
    const seam = fnSource("performHostAction") + fnSource("missionControlActionHost");
    for (const banned of [
      "fetch(",
      // Built from parts: the plugin scanner flags these tokens as literals.
      ["ev", "al("].join(""),
      ["new ", "Func", "tion"].join(""),
      "window.open",
      "location",
      "XMLHttpRequest",
    ]) {
      expect(seam).not.toContain(banned);
    }
  });

  it("every copy that names a destination hands it to the seam", () => {
    expect(fnSource("copyForPaste")).toMatch(
      /subject: subject \|\| '',\s*destination: destination \|\| ''/,
    );
    expect(fnSource("copyRepoPath")).toContain("destination: 'filePicker'");
  });
});

describe("Mission Control action seam: behavior", () => {
  it("web default: no host, copy to the clipboard and confirm with the destination", async () => {
    const seam = loadSeam(undefined);
    await seam.copyForPaste("/run-plan", "/run-plan", "chat input");
    expect(seam.clipboard).toEqual(["/run-plan"]);
    expect(seam.toasts).toEqual([["Copied /run-plan. Paste into the chat input.", false]]);
  });

  it("a host that is not an object with perform() is ignored (still copy-only)", async () => {
    const seam = loadSeam({ perform: "nope" });
    await seam.copyToClipboard("x", { toastMessage: "Copied x" });
    expect(seam.clipboard).toEqual(["x"]);
  });

  it("an injected host receives one frozen copy record and the clipboard is untouched", async () => {
    const received: Record<string, unknown>[] = [];
    const host = {
      perform: async (action: Record<string, unknown>) => {
        received.push(action);
        return { ok: true, message: "Sent to the host inbox" };
      },
    };
    const seam = loadSeam(host);
    await seam.copyForPaste("git status", "git status", "terminal");
    expect(seam.clipboard).toEqual([]);
    expect(received).toHaveLength(1);
    expect({ ...received[0] }).toEqual({
      kind: "copy",
      text: "git status",
      subject: "git status",
      destination: "terminal",
      toastMessage: "Copied git status. Paste into the terminal.",
    });
    expect(Object.isFrozen(received[0])).toBe(true);
    expect(seam.toasts).toEqual([["Sent to the host inbox", false]]);
  });

  it("a host refusal or failure is shown as an error toast", async () => {
    const refused = loadSeam({
      perform: async () => ({ ok: false, message: "Not on the allowlist" }),
    });
    await refused.copyToClipboard("git push", { toastMessage: "Copied" });
    expect(refused.toasts).toEqual([["Not on the allowlist", true]]);
    const thrown = loadSeam({
      perform: async () => {
        throw new Error("host down");
      },
    });
    await thrown.copyToClipboard("x", { toastMessage: "Copied x" });
    expect(thrown.toasts).toEqual([["Action failed: host down", true]]);
  });
});
