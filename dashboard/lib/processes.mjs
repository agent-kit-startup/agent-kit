/**
 * Process-list scoping for Mission Control snapshots.
 *
 * The snapshot ships command lines to every viewer (LAN in broadcast mode), so
 * the list is scoped to this workspace: only commands that mention the
 * snapshot root or the serve.mjs path survive, and each surviving command runs
 * through the caller's secret redactor before truncation.
 */

/**
 * True when `cmd` names `needle` as a whole path: the next character must end the
 * path (`/`, whitespace, quote, `:` or end), so `/x/app` does not match `/x/app-other`.
 */
function mentionsPath(cmd, needle) {
  let from = 0;
  for (;;) {
    const at = cmd.indexOf(needle, from);
    if (at === -1) return false;
    const next = cmd[at + needle.length];
    if (next === undefined || /[\/\s"':]/.test(next)) return true;
    from = at + 1;
  }
}

/**
 * Parse `ps -axo pid=,pcpu=,pmem=,etime=,command=` output into scoped rows.
 * Pure: no process spawning, no fs. `command` is redacted then truncated; the
 * returned `fullCommand` is redacted but untruncated (for local narration only).
 *
 * @param {string} psOutput
 * @param {{
 *   root: string,
 *   servePath: string,
 *   redact: (text: string) => string,
 *   truncate: (text: string, max: number) => string,
 *   maxCommandChars: number,
 *   maxProcesses: number,
 * }} opts
 * @returns {Array<{ pid: string, cpu: string, mem: string, etime: string, command: string, fullCommand: string, label: string }>}
 */
export function selectWorkspaceProcesses(psOutput, opts) {
  const { root, servePath, redact, truncate, maxCommandChars, maxProcesses } = opts;
  const needles = [root, servePath].filter((s) => typeof s === "string" && s.length > 1);
  const rows = [];
  if (needles.length === 0) return rows;
  for (const line of String(psOutput ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const rawCmd = parts.slice(4).join(" ");
    if (!rawCmd) continue;
    if (!needles.some((n) => mentionsPath(rawCmd, n))) continue;
    if (/grep|dashboard-data/.test(rawCmd)) continue;
    const cmd = redact(rawCmd);
    let label = "other";
    if (cmd.includes("serve.mjs") || cmd.includes("node dashboard")) label = "dashboard-server";
    else if (/\bgit\b/.test(cmd)) label = "git";
    else if (cmd.includes("node")) label = "node";
    rows.push({
      pid: parts[0],
      cpu: parts[1],
      mem: parts[2],
      etime: parts[3],
      command: truncate(cmd, maxCommandChars),
      fullCommand: cmd,
      label,
    });
    if (rows.length >= maxProcesses) break;
  }
  return rows;
}
