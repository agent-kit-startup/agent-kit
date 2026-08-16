# Cursor update awareness

Opt-in advisory for Cursor product updates (releases, changelog entries, new MCP/hooks/skills/commands/SDK surfaces). Agent Kit reports gaps against the native-audit inventory and routes confirmed work through existing HITL conveyors.

## Contract

| Rule | Behavior |
|------|----------|
| Check ≠ apply | `agent-kit cursor-awareness --check` never rewrites `.cursor/` or IDE state |
| Opt-in | `cursorUpdateCheck.enabled` defaults to `false` in `.cursor/context/config.json` |
| No Field Reports | `fieldReportRecommended` is always `false` |
| Conveyor | Confirmed gaps → Ask → `/backlog-add` or `/dogfood` (lane-aware) |
| Separate from kit update | Kit self-release uses `updateCheck` / `/update` (ADR `2026-07-27_consumer-autoupdate-check-opt-in.md`) |
| Native-audit prose | Native-audit plugin version tracks `.cursor-plugin/plugin.json` (**5.3.0** as of 2026-08-15). Live Marketplace submission stays on `submit-cursor-marketplace` (publisher HITL) |

## Detection source

ADR: `.cursor/memory/decisions/2026-08-01_cursor-update-detection-source.md`

1. **Primary:** fetch Cursor changelog (`https://cursor.com/changelog`, overridable via `cursorUpdateCheck.changelogUrl`)
2. **Delivery:** sessionStart nudge when opt-in is enabled (same pattern as kit `updateCheck`)
3. **Inventory:** diff open Action items and refresh staleness in `docs/cursor-native-audit.md`; validate `docs/cursor-3-features.md` presence
4. **Readiness:** may store last-seen Cursor product version later; not the probe today (`ide: cursor` only)

## CLI

```bash
agent-kit cursor-awareness --check [--cwd <path>] [--json] [--respect-prefs] [--stamp] [--offline]
```

### Inventory path / cwd

The check resolves `docs/cursor-native-audit.md` by walking up from `--cwd` (default: `process.cwd()`) until the file exists. Nested directories in the same git repository (for example `packages/cli`) therefore reuse the kit-root inventory. Walk-up stops at the first ancestor that contains `.git` (file or directory) when that directory has no inventory, so a nested checkout does not inherit a parent kit inventory. `--json` includes `inventoryRoot`: the absolute resolved directory that contains `docs/`, or `null` when walk-up fails (missing inventory, error, or nested `.git` boundary). Relative `inventoryPath` and `featuresPath` stay `docs/cursor-native-audit.md` and `docs/cursor-3-features.md`. Prefs and `--stamp` follow `inventoryRoot`: they read and write `.cursor/context/config.json` under that resolved directory, not the caller `--cwd`. When `inventoryRoot` is `null`, `--stamp` does not write and does not create a `.cursor/` tree under the caller cwd.

If no inventory is found before that git boundary (typical consumer checkout without the factory docs tree), the result is `status: error` with an actionable hint to pass `--cwd` at the kit/repo root that contains the inventory. There is no silent success without an inventory file.

Secondary map `docs/cursor-3-features.md` is read from the same resolved inventory root.

## Slash command

`/cursor-update-awareness` runs the check, summarizes gaps, then Ask-routes to `/backlog-add` or `/dogfood`.

## Prefs (`cursorUpdateCheck`)

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `false` | Opt-in for sessionStart + `--respect-prefs`. Changelog extract + stamp plausibility landed (R1/R2). **Advise/stamp semantics (T3): one-shot** — sessionStart passes `--stamp`, so a `changelog-ahead` nudge advances `lastSeenCursorVersion` on that run; ignoring the nudge means it will not reappear for the same version (interval + baseline). Operators who want repeat nudges should leave `enabled=false` and run `agent-kit cursor-awareness --check` manually (or use `/cursor-update-awareness`) without relying on sessionStart. Default stays `false`; enabling accepts one-shot delivery. |
| `intervalDays` | `7` | Minimum days between respected checks |
| `lastCheckedAt` | `null` | Stamped by CLI/hooks (`--stamp`) |
| `lastSeenCursorVersion` | `null` | Baseline for changelog-ahead detection |
| `changelogUrl` | `https://cursor.com/changelog` | HTTPS only |

See `.cursor/context/config.example.json`.

## Advise / stamp (one-shot sessionStart)

sessionStart always invokes the check with `--stamp` when `cursorUpdateCheck.enabled` is true. That intentionally **baselines** `lastSeenCursorVersion` on the same run that can emit a `changelog-ahead` nudge. Combined with `intervalDays`, the nudge is **one-shot per version**: an ignored nudge does not keep firing until the human acts. This is accepted kit behavior (T3); ack-before-stamp is not implemented. Manual `/cursor-update-awareness` or CLI `--check` without sessionStart remains available for operators who prefer explicit checks.

## Closeout expectation (network-dependent)

When shipping or closing work that depends on the live changelog fetch, run one real end-to-end check (`agent-kit cursor-awareness --check` against the configured HTTPS source, or a recorded HTML fixture that includes CSS noise plus a release label) before claiming `Gaps: none` in HANDOFF. Unit tests with injected `changelogBody` alone are not sufficient for that claim.

## Related

- [Cursor-native audit](cursor-native-audit.md)
- [Cursor 3 features map](cursor-3-features.md)
- [Bootstrap](bootstrap.md) (check ≠ apply for kit updates)
