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
| Native-audit prose | Marketplace / version-prose refresh stays on parked `submit-cursor-marketplace` |

## Detection source

ADR: `.cursor/memory/decisions/2026-08-01_cursor-update-detection-source.md`

1. **Primary:** fetch Cursor changelog (`https://cursor.com/changelog`, overridable via `cursorUpdateCheck.changelogUrl`)
2. **Delivery:** sessionStart nudge when opt-in is enabled (same pattern as kit `updateCheck`)
3. **Inventory:** diff open Action items and refresh staleness in `docs/cursor-native-audit.md`; validate `docs/cursor-3-features.md` presence
4. **Readiness:** may store last-seen Cursor product version later; not the probe today (`ide: cursor` only)

## CLI

```bash
agent-kit cursor-awareness --check [--json] [--respect-prefs] [--stamp] [--offline]
```

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
