/**
 * HANDOFF growth contract (Phase 4, `contract-read-budget-lazy-layers-2026-09-19`
 * plan; ADR `decisions/2026-09-20_contract-read-budget-and-laziness.md`).
 *
 * `.cursor/HANDOFF.md` grows without bound because every `/run-plan` tick
 * appends a dated narrative bullet and nothing ever removes one. This module
 * implements the prune: split the file into a "narrative region" (dated tick
 * entries, free-form) and a "fixed-section region" (`## Work Status` onward,
 * always preserved verbatim), then inside the narrative region keep the N
 * most recent non-machine-field chunks and archive the rest.
 *
 * Machine fields (the exact set Mission Control's `dashboard/lib/semantic-model.mjs`
 * parses) are never archived, wherever they appear, and their nested
 * continuation lines (e.g. a `- \`plan.md\`` row under `- **Backlog plans:**`)
 * travel with them.
 */

/** Field labels Mission Control parses as `- **Label:** value` (or a nested block). */
export const HANDOFF_MACHINE_FIELD_LABELS: readonly string[] = [
  "Plan",
  "Last updated",
  "Mode",
  "Phase completed",
  "Next phase",
  "Completed to-dos",
  "Next to-dos",
  "Parked plans",
  "Backlog plans",
  "Run queue",
  "Queue cursor",
  "Queue status",
  "Queue outcomes",
  "Gaps",
  "Instruction for the next agent",
];

/**
 * Headings that start the always-preserved trailing region. Matched by
 * prefix (case-sensitive) so "## Files Touched (this session, cumulative)"
 * still matches "## Files Touched".
 */
export const HANDOFF_FIXED_SECTION_HEADING_PREFIXES: readonly string[] = [
  "## Work Status",
  "## Session Context",
  "## Files Touched",
  "## Decisions Made",
  "## Issues Found",
  "## Run queue (multi-plan only)",
];

/** Growth-contract limits (bytes/lines/longest-line only; no token units). */
export const HANDOFF_MAX_LINES = 200;
export const HANDOFF_MAX_LINE_LENGTH = 2000;

interface Chunk {
  lines: string[];
  /** True when the first line is a machine-field bullet (never pruned). */
  isMachineField: boolean;
}

const MACHINE_FIELD_RE = new RegExp(
  `^- \\*\\*(${HANDOFF_MACHINE_FIELD_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}):\\*\\*`,
);

function isChunkStart(line: string): boolean {
  return /^- \*\*/.test(line) || /^## /.test(line);
}

function isFixedSectionHeading(line: string): boolean {
  return HANDOFF_FIXED_SECTION_HEADING_PREFIXES.some((p) => line.startsWith(p));
}

/**
 * Splits `lines` into a leading `preamble` (blank/prose lines before the
 * first bullet or heading -- never a prunable unit, always kept in place)
 * and the `chunks` that follow, each starting at a `- **`/`## ` line.
 */
function splitIntoChunks(lines: string[]): { preamble: string[]; chunks: Chunk[] } {
  const firstStart = lines.findIndex(isChunkStart);
  if (firstStart === -1) return { preamble: lines, chunks: [] };
  const preamble = lines.slice(0, firstStart);
  const chunks: Chunk[] = [];
  let current: string[] = [lines[firstStart] as string];
  for (const line of lines.slice(firstStart + 1)) {
    if (isChunkStart(line)) {
      chunks.push({ lines: current, isMachineField: MACHINE_FIELD_RE.test(current[0] ?? "") });
      current = [line];
    } else {
      current.push(line);
    }
  }
  chunks.push({ lines: current, isMachineField: MACHINE_FIELD_RE.test(current[0] ?? "") });
  return { preamble, chunks };
}

export interface PruneResult {
  ok: boolean;
  /** Present only when ok is false. */
  reason?: string;
  /** New HANDOFF.md content (only when ok is true). */
  text?: string;
  /** Narrative chunks moved to the archive, in original order (only when ok is true). */
  archived?: string[];
  /** Count of narrative chunks kept in place. */
  keptCount?: number;
}

/**
 * Prune `text` (a HANDOFF.md body), keeping the `keep` most recent
 * narrative chunks and archiving the rest. Machine-field chunks and the
 * fixed-section trailing region are always preserved byte-identical.
 * Never mutates when the file does not look like a real HANDOFF (no
 * machine fields found, or no recognized fixed-section heading) --
 * malformed input must not become a silently truncated file.
 */
export function pruneHandoffText(text: string, keep: number): PruneResult {
  if (!text.trim()) {
    return { ok: false, reason: "empty file" };
  }
  const lines = text.split("\n");
  const titleIdx = lines.findIndex((l) => /^# /.test(l));
  if (titleIdx === -1) {
    return { ok: false, reason: "no H1 title line found" };
  }

  let fixedStartIdx = lines.findIndex((l) => isFixedSectionHeading(l));
  if (fixedStartIdx === -1) fixedStartIdx = lines.length;

  const head = lines.slice(0, titleIdx + 1);
  const narrativeLines = lines.slice(titleIdx + 1, fixedStartIdx);
  const trailingLines = lines.slice(fixedStartIdx);

  const { preamble, chunks } = splitIntoChunks(narrativeLines);
  const machineFieldCount = chunks.filter((c) => c.isMachineField).length;
  if (machineFieldCount === 0) {
    return { ok: false, reason: "no machine-field bullets found; refusing to prune" };
  }
  if (fixedStartIdx === lines.length) {
    return { ok: false, reason: "no recognized fixed-section heading found; refusing to prune" };
  }

  const narrativeChunks = chunks.filter((c) => !c.isMachineField);
  if (narrativeChunks.length <= keep) {
    // Nothing to prune.
    return { ok: true, text, archived: [], keptCount: narrativeChunks.length };
  }

  const keptNarrativeIdx = new Set<number>();
  let seen = 0;
  const chunkIsNarrative = chunks.map((c) => !c.isMachineField);
  for (let i = 0; i < chunks.length; i++) {
    if (chunkIsNarrative[i]) {
      if (seen < keep) keptNarrativeIdx.add(i);
      seen++;
    }
  }

  const keptChunks: Chunk[] = [];
  const archivedChunks: Chunk[] = [];
  chunks.forEach((c, i) => {
    if (c.isMachineField || keptNarrativeIdx.has(i)) keptChunks.push(c);
    else archivedChunks.push(c);
  });

  const newNarrativeLines = [...preamble, ...keptChunks.flatMap((c) => c.lines)];
  const newLines = [...head, ...newNarrativeLines, ...trailingLines];

  return {
    ok: true,
    text: newLines.join("\n"),
    archived: archivedChunks.map((c) => c.lines.join("\n")),
    keptCount: keptNarrativeIdx.size,
  };
}

export interface HandoffSizeWarning {
  code: "file-over-limit" | "line-over-limit";
  message: string;
}

/**
 * Growth-contract advisory checks (bytes/lines/longest-line; no token
 * units), separate from `validateHandoffText`'s machine-field checks.
 */
export function checkHandoffGrowth(text: string): HandoffSizeWarning[] {
  if (!text.trim()) return [];
  const lines = text.split("\n");
  const warnings: HandoffSizeWarning[] = [];
  if (lines.length > HANDOFF_MAX_LINES) {
    warnings.push({
      code: "file-over-limit",
      message: `HANDOFF.md is ${lines.length} lines, over the ${HANDOFF_MAX_LINES}-line growth-contract limit. Run \`agent-kit handoff --prune\` to archive older narrative entries.`,
    });
  }
  let firstOffendingLine = -1;
  let overCount = 0;
  lines.forEach((l, i) => {
    if (l.length > HANDOFF_MAX_LINE_LENGTH) {
      overCount++;
      if (firstOffendingLine === -1) firstOffendingLine = i + 1;
    }
  });
  if (overCount > 0) {
    warnings.push({
      code: "line-over-limit",
      message: `HANDOFF.md has ${overCount} line(s) over the ${HANDOFF_MAX_LINE_LENGTH}-char growth-contract limit (first at line ${firstOffendingLine}). Wrap long paragraphs; do not widen the limit.`,
    });
  }
  return warnings;
}
