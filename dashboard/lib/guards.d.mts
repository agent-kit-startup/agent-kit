/** Ambient types for dashboard/lib/guards.mjs (consumed by CLI TypeScript). */

type ProcessEnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;
type HeaderMap = Record<string, string | string[] | undefined>;
type GuardRequest = { headers?: HeaderMap };
type PortOpts = { base?: number; range?: number };
type GitStatusFile = {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  oldPath?: string;
  renamed?: boolean;
};

export const DEFAULT_HOST: "127.0.0.1";
export const BROADCAST_TOKEN_ENV: "MISSION_CONTROL_TOKEN";
export const REPO_ROOT_ENV: "MISSION_CONTROL_REPO_ROOT";
export const KIT_ROOT_ENV_KEYS: readonly ["MISSION_CONTROL_KIT_ROOT", "AGENT_KIT_HOME"];
export const BROADCAST_TOKEN_MIN_LEN: 16;
export const BROADCAST_TOKEN_COOKIE: "mc_token";
export const DEFAULT_PORT_BASE: 3333;
export const DEFAULT_PORT_RANGE: 256;
export const MAX_STRING: {
  branch: number;
  lastCommit: number;
  terminalCwd: number;
  terminalCommand: number;
  processCommand: number;
};
export const MAX_GIT_FILES: 50;
export const MAX_GIT_PATH: 240;
export const CONTEXT_CONFIG_REL: ".cursor/context/config.json";
export const CONFIG_PERSONA_IDS: readonly ["autopilot", "night-shift", "ghost-runner"];
export const CONFIG_PERSONA_MODES: readonly ["continue-plan", "run-plan", "cli-run-plan"];
export const CONFIG_REVIEW_BACKENDS: readonly ["auto", "claude", "cursor"];
export const CONFIG_REVIEW_MODES: readonly ["paste", "autonomous"];
export const CONFIG_REVIEW_PREFLIGHT: readonly ["off", "warn", "block"];

export function escapePerlDoubleQuoted(value: string): string;
export function resolveSnapshotRepoRoot(env: ProcessEnvLike | undefined, kitRoot: string): string;
export function normalizeRepoRootKey(repoRoot: string): string;
export function hashRepoRoot(repoRoot: string): number;
export function repoRootLogId(repoRoot: string): string;
export function preferredPortForRepoRoot(repoRoot: string, opts?: PortOpts): number;
export function portCandidatesForRepoRoot(repoRoot: string, opts?: PortOpts): number[];
export function sameRepoRoot(a: string | null | undefined, b: string | null | undefined): boolean;
export function resolveMissionControlPort(args: {
  repoRoot: string;
  envPort?: string | number | null;
  probe: (port: number) => { listening: boolean; repoRoot: string | null };
  opts?: PortOpts;
}): { port: number; reuse: boolean; explicit: boolean };
type BroadcastProbe = {
  listening: boolean;
  repoRoot?: string | null;
  acceptsToken?: boolean;
  tokenGated?: boolean;
  lanReachable?: boolean | null;
};
type BroadcastListenerKind =
  | "free"
  | "self-broadcast"
  | "self-other-mode"
  | "foreign"
  | "token-gated"
  | "unknown";
export function classifyBroadcastListener(
  info: BroadcastProbe,
  repoRoot: string,
): BroadcastListenerKind;
export function describeBroadcastListener(
  kind: string,
  info?: { port?: number | null; repoRoot?: string | null },
): string;
export function resolveBroadcastPort(args: {
  repoRoot: string;
  envPort?: string | number | null;
  probe: (port: number) => BroadcastProbe;
  opts?: PortOpts;
}): {
  port: number;
  reuse: boolean;
  explicit: boolean;
  skipped: Array<{ port: number; kind: string; repoRoot: string | null }>;
};
export function isSafeRepoRelativePath(relPath: unknown): boolean;
export function resolveBindHost(envHost?: string | null): string;
export function isLoopbackBindHost(host: string | undefined | null): boolean;
export function normalizeAuthToken(raw: unknown): string;
export function isValidBroadcastToken(token: unknown): boolean;
export function generateBroadcastToken(): string;
export function tokensMatch(a: unknown, b: unknown): boolean;
export function resolveBroadcastAuth(
  env?: ProcessEnvLike,
):
  | { ok: true; host: string; tokenRequired: boolean; token: string | null; broadcast: boolean }
  | { ok: false; error: string };
export function extractRequestToken(req: GuardRequest, url: URL): string;
export function authorizeMissionControlRequest(
  req: GuardRequest,
  url: URL,
  opts: { tokenRequired: boolean; expectedToken: string | null },
): { ok: true; viaQuery: boolean } | { ok: false; status: number; error: string };
export function broadcastAuthCookieHeader(token: string): string;
export function listLanIPv4Addresses(): string[];
export function truncateStr(value: unknown, maxLen: number): unknown;
export function parseGitStatusShort(output: unknown): {
  files: GitStatusFile[];
  total: number;
  truncated: boolean;
};
export function isLoopbackAddress(addr: string | undefined | null): boolean;
export function resolveContextConfigPath(
  repoRoot: string,
  fsHooks?: {
    existsSync?: (path: string) => boolean;
    realpathSync?: (path: string) => string;
    mkdirSync?: (path: string, opts?: { recursive?: boolean }) => void;
  },
): { ok: true; path: string } | { ok: false; error: string };
export function validateConfigWriteBody(
  body: unknown,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string };
export function mergeConfigAllowlist(
  existing: Record<string, unknown> | object,
  patch: Record<string, unknown> | object,
): Record<string, unknown>;
export function allowlistConfig(raw: unknown): Record<string, unknown>;
export function isAllowedOrigin(origin: unknown, port: unknown): boolean;
export function applyCorsHeaders(
  req: GuardRequest,
  res: { setHeader: (name: string, value: string) => unknown },
  port: unknown,
): boolean;
export function isUnderDashboard(resolvedPath: string, dashboardReal: string): boolean;
export function resolveDashboardStatic(
  pathname: string,
  hooks: {
    dashboardDir: string;
    dashboardReal: string;
    existsSync: (path: string) => boolean;
    realpathSync: (path: string) => string;
  },
): string | null;
