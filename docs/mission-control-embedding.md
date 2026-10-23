# Embedding Mission Control

How a host application (a desktop app, an editor extension, or any page that loads `dashboard/dashboard.html`) plugs into Mission Control without forking it.

## Action seam

Every action the panel offers is one typed record:

```js
{ kind: "copy", text, subject, destination, toastMessage }
```

- `kind` is always `"copy"`. The panel never names a command for a host to run and has no other action kind.
- `text` is what a human would paste; `destination` is where (`chat input`, `terminal`, `file picker`, `past-chat picker`, or a config path); `subject` and `toastMessage` are the copy vocabulary the panel already shows.

**Default (the open web dashboard):** the record is copied to the clipboard and the toast names the paste destination. This is the copy-only, local-only behavior of the web dashboard, and it does not change.

**Host implementation:** define the hook before the panel's script runs.

```html
<script>
  window.__MISSION_CONTROL_ACTIONS__ = {
    async perform(action) {
      // Validate host-side: allowlisted kind, typed fields, untrusted strings.
      // Return { ok, message } for the toast; throw to show an error.
      return { ok: true, message: "Sent to the inbox" };
    },
  };
</script>
```

The panel then hands the frozen record to `perform()` instead of writing the clipboard, shows `message` (or the copy label) in the toast, and shows a refusal (`ok: false`) or a thrown error as an error toast. Treat every string in the record as untrusted repo or agent text. Anything past staging still needs a typed explicit yes in the host, and `/git-prod` is never offered.

## Snapshot contract

`dashboard/dashboard-data.mjs` prints one JSON snapshot per refresh. Its shape is versioned by `dashboardDataVersion` (currently **1.7.0**) and published as `docs/contracts/mission-control-snapshot.schema.json` (JSON Schema 2020-12): every top-level field is required with its type, and the `runLogs` rows, `gateExit` tickets and `chats` envelopes are fixed; nested collector shapes stay open so collectors can grow. An added field is a minor bump, a removed or retyped top-level field a major bump. A test runs the real script against a scratch repo and checks the output against the schema of its version.

**Run feed without `~/.cursor`.** `runLogs` (1.5.0) lists the newest headless logs the kit writes itself (`.cursor/loop-logs/tick-*.log` from `agent-kit run-plan`, `run-*.log` from `agent-kit run`): `format` (`stream-json`, `codex` or `acp`), `sessionId`, capped `lastText`, `result`, the `LOOP_TICK_RESULT` line, HITL gate ids and reply stamps. The logs are redacted when written and again when read. The runner keeps these logs (and `loop.stop`) under `AGENT_KIT_STATE_ROOT`: `.cursor` by default, or `.agent-kit` for a host that keeps runner output out of `.cursor/` (the `loop-logs/` directory ignores itself in git either way). Plans, HANDOFF and the other agent contract files stay under `.cursor/`. A host that drives the CLI in driver mode (`docs/driver-events-protocol.md`) gets the same information live; `runLogs` is the at-rest view.

**Pending operator tickets.** `gateExit` (1.6.0) is the read half of `agent-kit ground-control status`: `marker` (`absent`, `ok` or `invalid` for `.cursor/context/gate-exit.json`), `base`, `tickets[]` (`stamp`, note `headline`, `askId`, `labels`, `trigger`, `openedAt`, `url`, `branch`, `branchState` `unmerged` / `merged` / `none`, `inMarker`), the latest `skipped` launcher records and `truncated`. Same contract as the CLI (marker entries plus unmerged `gate-exit/<stamp>` branches; a merged branch with no entry is history), but it never fetches: it shows the refs as last fetched. `missionControl.flightLog.tickets` is the panel projection (read-only, no action; the card shows the `agent-kit ground-control` command).

**Saved chats.** `chats` (1.7.0) is the workspace's saved agent sessions, the same object `agent-kit sessions --json` prints: `{withheld, vendors[]}` with one envelope per vendor `{vendor, status, projectDir, sessions, total}`. Claude Code is read from `~/.claude/projects/<slug>/<uuid>.jsonl`, where `<slug>` is the workspace path with every character that is not an ASCII letter or digit replaced by `-`; subagent transcripts are not sessions. Each session is `{id, title, titleSource, modified, sizeBytes}`: `titleSource` is `custom` (the name the operator set), `ai` (the generated title), `first-prompt` (the first typed prompt, cut to 80 characters) or `none`; `modified` is unix milliseconds. Sessions are newest first and capped at 200, `total` counts them all. `status` is `ok`, `none` (no saved session for this folder) or `unsupported` (Codex and Cursor for now). Chat titles are private: in broadcast mode the snapshot carries `{withheld: true, vendors: []}`. The Chats card copies `cd <workspace> && claude --resume <id>`; a web page cannot open a terminal.

## Commands catalog

`agent-kit commands --json --cwd <workspace>` prints the workspace's slash commands for a host that wants a command palette or a browsable command list. Its shape is versioned by `catalogVersion` (currently **1.0.0**) and published as `docs/contracts/commands-catalog.schema.json`: `{catalogVersion, kitVersion, commands[]}`, one row `{name, description, layer, headless}` per `.cursor/commands/<name>.md` that has a description, sorted by name. An added optional field is a minor bump, a removed or retyped field a major bump. A host reads the catalog from the installed kit and keeps no list of its own.

- `name` is the slash without the `/`, matching `^[a-z0-9][a-z0-9-]{0,63}$`; files whose name fails the pattern are left out.
- `description` is the file's frontmatter line. It is repo text: render it as text, never through `innerHTML`.
- `layer` is `kit` (the kit ships it), `factory` (kit-maintainer only; never installed in a consumer workspace, so a consumer catalog has no such rows) or `project` (a command the workspace added itself).
- `headless` means the kit can dispatch the slash with `agent-kit run`. It is a hint for display, not permission: the host decides what runs from its own allowlist, and the catalog can never widen it.

**Run or copy.** A row the host's allowlist accepts may run through the host's own action path; every other row is a copy record for the agent chat input, as in the [action seam](#action-seam). `/git-prod` and `/kit-prod` are never runnable from a host. An engine that predates `agent-kit commands` exits non-zero on the unknown subcommand, and a host that sees that, output that is not JSON, or a `catalogVersion` major it does not support should ask the user to update the engine rather than fall back to a list of its own.

## Content security policy readiness

Measured with `node scripts/dashboard-csp.mjs` (`--json` for the full report) on 2026-10-19:

| Item | Count |
|------|-------|
| Inline `<script>` blocks | 2 (hashable) |
| Inline `<style>` blocks | 1 (hashable) |
| Static inline event-handler attributes | 25 (hashable with `'unsafe-hashes'`) |
| Static inline style attributes | 12 (hashable with `'unsafe-hashes'`) |
| Event-handler attributes written at runtime by `innerHTML` templates | 62 (not hashable) |
| Style attributes written at runtime by `innerHTML` templates | 37 (not hashable) |
| `innerHTML` / `insertAdjacentHTML` sinks | 10 |

The report prints the strictest policy the static page could run under (script and style hashes, `default-src 'none'`, `connect-src 'self'`, `img-src 'self' data:`). It is **not enforceable yet**: the 62 runtime handler attributes must move to delegated listeners and the 37 runtime style attributes to classes or CSSOM first. Until then a host should apply it as `Content-Security-Policy-Report-Only`. The web dashboard does not send a CSP header.

## innerHTML sinks

| # | Sink | Content | Verdict |
|---|------|---------|---------|
| 1 | Section "Home" back button (`insertAdjacentHTML`) | `spaceIconSvg('overview')`: constant SVG from a fixed map | safe |
| 2 | Top-nav anchors (`insertAdjacentHTML`) | `spaceIconSvg(kind)`, `kind` from static `data-icon`; unknown kinds return `''` | safe |
| 3 | More button (`innerHTML`) | constant SVG | safe |
| 4 | Header home button (`innerHTML`) | constant SVG | safe |
| 5 | More-menu items (`insertAdjacentHTML`) | `spaceIconSvg(kind)`, `kind` from static `data-section` | safe |
| 6 | Skins label (`insertAdjacentHTML`) | constant SVG | safe |
| 7 | Toast (`innerHTML`) | constant glyph + `escapeHtml(message)` | safe |
| 8 | Render-failure panel (`innerHTML`) | `escapeHtml(err.message)`, `escapeHtml(err.stack)`, constant handlers | safe |
| 9 | Main render (`contentEl.innerHTML = parts.join('')`) | every section renderer; repo and agent strings pass `escapeHtml` (114 sites), `escapeAttr` (135 sites) or `copyForPasteHandler` / `copyRepoPathHandler` (`escapeJsString` inside `escapeAttr`) | no unescaped repo or agent string found in the reviewed paths; a full per-interpolation review is owed before any host action ships |
| 10 | Loading panel (`innerHTML`) | `renderEmptyStateCta` with constant arguments | safe |

The counts are pinned by `scripts/dashboard-csp.test.mjs`, so a new sink, handler or inline style is noticed in review.
