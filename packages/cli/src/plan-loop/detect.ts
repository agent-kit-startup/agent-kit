import type { BackendId } from "./backends.js";
import { whichBinary } from "./backends.js";

export type RequestedBackend = "auto" | BackendId;
export type WhichFn = (bin: string) => Promise<string | null>;

/** First match wins for `--backend auto`. Do not invent undocumented binaries. */
export const DETECT_ORDER: readonly BackendId[] = ["cursor-agent", "claude"];

export const INSTALL_HINTS: Record<BackendId, string> = {
  "cursor-agent":
    "Install the Cursor Agent CLI and ensure `cursor-agent` is on PATH (https://cursor.com/docs/cli).",
  claude:
    "Install Claude Code and ensure `claude` is on PATH (https://code.claude.com/docs/en/quickstart).",
};

export function isBackendId(id: string): id is BackendId {
  return id === "cursor-agent" || id === "claude";
}

export function isRequestedBackend(id: string): id is RequestedBackend {
  return id === "auto" || isBackendId(id);
}

export type DetectOk = { ok: true; id: BackendId; bin: string };
export type DetectFail = { ok: false; message: string };
export type DetectResult = DetectOk | DetectFail;

export function listDetectBackendIds(): string[] {
  return ["auto", ...DETECT_ORDER];
}

/**
 * Resolve an installed agent CLI. `auto` picks the first binary in DETECT_ORDER.
 * GLM and other undocumented ids fail; this function never returns a stub path.
 */
export async function detectAgentBackend(
  requested: string,
  whichFn: WhichFn = whichBinary,
): Promise<DetectResult> {
  const id = requested.trim().toLowerCase();
  if (id === "glm" || id.startsWith("glm-") || id === "glm4") {
    return {
      ok: false,
      message:
        "No documented GLM CLI binary is registered. Refusing a stub that would claim to work. Use --backend auto, cursor-agent, or claude.",
    };
  }
  if (!isRequestedBackend(id)) {
    return {
      ok: false,
      message: `Unknown backend '${requested}'. Supported: ${listDetectBackendIds().join(", ")}.`,
    };
  }
  if (id === "auto") {
    for (const candidate of DETECT_ORDER) {
      const bin = await whichFn(candidate);
      if (bin) return { ok: true, id: candidate, bin };
    }
    return {
      ok: false,
      message: [
        "No agent CLI found on PATH (tried: cursor-agent, claude).",
        INSTALL_HINTS["cursor-agent"],
        INSTALL_HINTS.claude,
      ].join(" "),
    };
  }
  const bin = await whichFn(id);
  if (!bin) {
    return { ok: false, message: `${id} not found on PATH. ${INSTALL_HINTS[id]}` };
  }
  return { ok: true, id, bin };
}
