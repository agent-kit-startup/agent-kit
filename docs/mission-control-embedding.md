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

`dashboard/dashboard-data.mjs` prints one JSON snapshot per refresh. Its shape is versioned by `dashboardDataVersion` (currently **1.5.0**) and published as `docs/contracts/mission-control-snapshot.schema.json` (JSON Schema 2020-12): every top-level field is required with its type, and the `runLogs` rows are fixed; nested collector shapes stay open so collectors can grow. An added field is a minor bump, a removed or retyped top-level field a major bump. A test runs the real script against a scratch repo and checks the output against the schema of its version.

**Run feed without `~/.cursor`.** `runLogs` (1.5.0) lists the newest headless logs the kit writes itself (`.cursor/loop-logs/tick-*.log` from `agent-kit run-plan`, `run-*.log` from `agent-kit run`): `format` (`stream-json`, `codex` or `acp`), `sessionId`, capped `lastText`, `result`, the `LOOP_TICK_RESULT` line, HITL gate ids and reply stamps. The logs are redacted when written and again when read. The runner keeps these logs (and `loop.stop`) under `AGENT_KIT_STATE_ROOT`: `.cursor` by default, or `.agent-kit` for a host that keeps runner output out of `.cursor/` (the directory then ignores itself in git). Plans, HANDOFF and the other agent contract files stay under `.cursor/`. A host that drives the CLI in driver mode (`docs/driver-events-protocol.md`) gets the same information live; `runLogs` is the at-rest view.

## Content security policy readiness

Measured with `node scripts/dashboard-csp.mjs` (`--json` for the full report) on 2026-10-08:

| Item | Count |
|------|-------|
| Inline `<script>` blocks | 2 (hashable) |
| Inline `<style>` blocks | 1 (hashable) |
| Static inline event-handler attributes | 24 (hashable with `'unsafe-hashes'`) |
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
