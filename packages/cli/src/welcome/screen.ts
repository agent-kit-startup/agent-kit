/**
 * Bare `agent-kit` welcome chrome (ASCII helmet + utility hints).
 * Separate from run-plan persona banners under plan-loop/.
 */

import {
  blue,
  cyan,
  gray,
  options as koloristOptions,
  lightCyan,
  trueColor,
  white,
} from "kolorist";
import { KIT_VERSION } from "../lifecycle/version.js";
import {
  HELMET_ACCENT,
  HELMET_FILL,
  HELMET_OUTLINE,
  LABEL_MUTED,
  SPACE_MARKS,
  type WelcomeRenderOptions,
  shouldUseVisualMotion,
  shouldUseWelcomeColor,
  tipAt,
} from "./visual-kit.js";

export {
  HELMET_ACCENT,
  HELMET_FILL,
  HELMET_OUTLINE,
  LABEL_MUTED,
  shouldUseWelcomeColor,
  type WelcomeRenderOptions,
};

/** kolorist SupportLevel.TrueColor — needed so trueColor() emits when TTY probes say none (CI). */
const KOLORIST_TRUECOLOR = 3;

const HELMET_ASCII = [
  "       ____",
  "    .-'    '-.",
  "   /  .--.    \\",
  "  |  /    \\    |",
  "  | |  ()  |   |",
  "  |  \\    /    |",
  "   \\  '--'    /",
  "    '-.____.-'",
  "   /_/      \\_\\",
];

/** Parse `#rrggbb` for trueColor helmet outline (contract pin for HELMET_OUTLINE). */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  const hexBody = m?.[1];
  if (!hexBody) throw new Error(`invalid hex color: ${hex}`);
  const n = Number.parseInt(hexBody, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function outlineAnsi(line: string): string {
  const [r, g, b] = hexToRgb(HELMET_OUTLINE);
  return trueColor(r, g, b)(line);
}

/** Run `fn` with kolorist forced on at trueColor support (restores prior options). */
function withKoloristColor<T>(fn: () => T): T {
  const prevEnabled = koloristOptions.enabled;
  const prevLevel = koloristOptions.supportLevel;
  koloristOptions.enabled = true;
  koloristOptions.supportLevel = KOLORIST_TRUECOLOR;
  try {
    return fn();
  } finally {
    koloristOptions.enabled = prevEnabled;
    koloristOptions.supportLevel = prevLevel;
  }
}

/** True when argv names a citty subcommand (non-flag token), so skip root welcome. */
export function hasCliSubcommand(rawArgs: string[] | undefined): boolean {
  return Boolean(rawArgs?.some((arg) => !arg.startsWith("-")));
}

export function renderHelmetAscii(color: boolean): string {
  if (!color) return HELMET_ASCII.join("\n");
  return withKoloristColor(() =>
    HELMET_ASCII.map((line, i) => {
      // Outline (top/bottom / cheek straps) uses HELMET_OUTLINE via trueColor.
      if (i <= 1 || i >= HELMET_ASCII.length - 1) return outlineAnsi(line);
      if (i === 4) return lightCyan(line);
      return blue(line);
    }).join("\n"),
  );
}

/** Print-and-exit utility hints (not an interactive menu). */
export const WELCOME_UTILITY_HINTS = [
  { cmd: "agent-kit --help", hint: "grouped commands" },
  { cmd: "agent-kit doctor", hint: "repository readiness" },
  { cmd: "agent-kit status", hint: "installed kit version" },
  { cmd: "agent-kit dashboard", hint: "Mission Control panel" },
  { cmd: "agent-kit init", hint: "guided install entry" },
] as const;

export function renderWelcomeScreen(opts: WelcomeRenderOptions = {}): string {
  const version = opts.version ?? KIT_VERSION;
  const color = shouldUseWelcomeColor(opts);
  const title = color ? white("Mission Kit") : "Mission Kit";
  const product = color ? cyan("agent-kit") : "agent-kit";
  const muted = (s: string) => (color ? gray(s) : s);
  const lines = [
    renderHelmetAscii(color),
    "",
    `${title}  ·  ${product} v${version}`,
    muted("HITL framework for AI-assisted IDEs  ·  @dadado/agent-kit-cli"),
    "",
    muted("Try:"),
    ...(() => {
      const width = Math.max(...WELCOME_UTILITY_HINTS.map(({ cmd }) => cmd.length));
      return WELCOME_UTILITY_HINTS.map(({ cmd, hint }) => {
        const pad = " ".repeat(width - cmd.length + 2);
        const left = color ? cyan(`  ${cmd}`) : `  ${cmd}`;
        return `${left}${pad}${muted(hint)}`;
      });
    })(),
    "",
    muted(
      "Chat HITL (start-project, git-staging/prod, run-plan-all) stays in Cursor slash commands.",
    ),
    muted(
      `${shouldUseVisualMotion(opts) ? SPACE_MARKS.star : SPACE_MARKS.tick} ${tipAt(
        [...version].reduce((n, c) => n + c.charCodeAt(0), 0),
      )}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export function printWelcomeScreen(opts: WelcomeRenderOptions = {}): void {
  process.stdout.write(renderWelcomeScreen(opts));
}
