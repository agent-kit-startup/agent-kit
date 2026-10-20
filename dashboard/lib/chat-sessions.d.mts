export const CHAT_SESSIONS_CAP: number;
export const CHAT_TITLE_MAX: number;
export const CHAT_NAMED_TITLE_MAX: number;
export const CHAT_FULL_SCAN_MAX_BYTES: number;
export const CHAT_HEAD_BYTES: number;
export const CHAT_TAIL_BYTES: number;
export const CHAT_SCAN_BUDGET_BYTES: number;
export const CHAT_VENDORS: readonly ["claude", "codex", "cursor"];

export type ChatVendor = "claude" | "codex" | "cursor";
export type ChatTitleSource = "custom" | "ai" | "first-prompt" | "none";

export interface ChatSession {
  id: string;
  title: string | null;
  titleSource: ChatTitleSource;
  /** Last write, unix milliseconds. */
  modified: number;
  sizeBytes: number;
}

export interface ChatSessionsEnvelope {
  vendor: ChatVendor;
  status: "ok" | "unsupported" | "none";
  projectDir: string | null;
  sessions: ChatSession[];
  total: number;
}

export interface ChatsSnapshot {
  withheld: boolean;
  vendors: ChatSessionsEnvelope[];
}

export interface ChatTitle {
  title: string | null;
  titleSource: ChatTitleSource;
}

export interface ListChatSessionsOptions {
  cwd: string;
  home?: string | null;
  cap?: number;
  /** Bytes read in full before older transcripts fall back to a small head + tail window. */
  scanBudgetBytes?: number;
  cache?: Map<string, ChatTitle>;
}

export function claudeProjectSlug(cwd: string): string;
export function claudeProjectDir(cwd: string, opts?: { home?: string | null }): string | null;
export function cleanChatTitle(value: unknown, max?: number): string;
export function readChatTitle(
  filePath: string,
  window?: { fullScanMaxBytes?: number; headBytes?: number; tailBytes?: number },
): ChatTitle;
export function listClaudeSessions(opts: ListChatSessionsOptions): ChatSessionsEnvelope;
export function listChatSessions(opts: ListChatSessionsOptions): ChatSessionsEnvelope[];
export function collectChats(opts: ListChatSessionsOptions & { withhold?: boolean }): ChatsSnapshot;
export function withholdChats<T extends Record<string, unknown>>(snapshot: T): T;
export function withholdChatsFromPayload(payload: string): string;
export function shellQuote(value: string): string;
export function claudeResumeCommand(workspace: string, id: string): string;
export function formatChatAge(modifiedMs: number, nowMs?: number): string;
