# Command: /update

## Goal

Update the Agent Kit layer (L0 + packs + skills) from the public registry, treating this repo as a **consumer** — not the dev factory. Checks the latest released version, compares with what's installed, and applies the update respecting protected L3 paths.

**Check ≠ apply.** Opt-in `updateCheck` and `agent-kit update --check` only notify. Apply always goes through this command's Ask confirm (or an explicit CLI `agent-kit update` invoke by an operator). `updateApply.auto` defaults to `false` and must never silent-write L0.

## When to Use

- When you want to check if a newer Agent Kit release is available
- To pull the latest rules, commands, skills, and pack updates from the public repo
- After a new `agent-kit-startup/agent-kit` release (check [releases](https://github.com/agent-kit-startup/agent-kit/releases))
- After a sessionStart nudge (when `updateCheck.enabled` is true) that reports an update available

## Hard stops

1. **Never confuse with the dev sync.** This command updates `.cursor/` content only — it does not push code to the public repo or trigger the public sync pipeline.
2. **Do not change `origin` or `public` remote URLs.** This is a manifest-level update only.
3. **Respect protected paths** (`.cursor/agent-kit.json` `protected` array). No overwrite, no warning override.
4. **Ask before applying.** Show what will change and let the user decide. Never silent apply; never honor `updateApply.auto` from a background/session path.
5. **Do not run on `main` checkout.** The repo should be on `staging` or a working branch.
6. **Factory/dev registry.** If the manifest points at `agent-kit-dev` or a pre-prod ref (`staging` / `develop` / …), warn and do not treat the install as a public consumer unless the operator explicitly switches to the public URL/ref.

## Check-only (no apply)

```bash
agent-kit update --check [--json] [--respect-prefs] [--stamp]
```

- Compares installed manifest `version` to the latest public semver tag (HTTPS `git ls-remote`; same RCE-safe URL/ref guards as install).
- `--respect-prefs`: honor `updateCheck.enabled` + `intervalDays` (sessionStart / hooks).
- `--stamp`: write `updateCheck.lastCheckedAt` after a network check.
- Exit code `2` only on hard check errors; status is always in the JSON/`status` field. `applyRecommended` is always `false`.

## What to Do (apply path)

1. **Load the current manifest:**
   - Read `.cursor/agent-kit.json`
   - Extract `version` (installed), `packs`, `skills`, `protected`, `overrides`

2. **Check the latest public release:**
   - Prefer `agent-kit update --check --json` (or equivalent tag list)
   - Fallback: `git ls-remote --tags` on the public HTTPS URL; parse `vX.Y.Z`; pick highest
   - Alternative: `gh release list --repo agent-kit-startup/agent-kit` if available

3. **Compare versions:**
   - Parse current and latest as semver (major.minor.patch)
   - If latest > current → update available
   - If same → nothing to do (report and stop)
   - If latest < current → warn about dev version and stop

4. **Show what will update (diff):**
   - Run `npx @dadado/agent-kit-cli diff --url https://github.com/agent-kit-startup/agent-kit --ref main` (or the latest tag ref)
   - Show the summary: drift, missing-local, missing-registry, protected counts

5. **Confirm via Ask questions:**
   ```
   Agent Kit update: v{CURRENT} → v{LATEST}
   Drift: N files | Missing: N files | Protected: N files
   Apply this update?
   ```
   Options: `Apply update` / `Skip this version` / `Show detailed diff first`

6. **On confirmation, run the update:**
   ```bash
   npx @dadado/agent-kit-cli update --url https://github.com/agent-kit-startup/agent-kit --ref main
   ```
   - This will sync from the public repo's `main` branch
   - Protected paths are automatically respected by the CLI
   - The manifest's `registry.ref` will be updated to `main`
   - Bare CLI `update` without Ask is an **explicit operator** terminal invoke, not a hook or cron path

7. **Report results:**
   - Show what was added/updated/removed
   - Show what was protected (skipped)
   - Update `.cursor/HANDOFF.md` with the update event if the repo has an active plan
   - **Memory loop check:** if the update resolves a known error or changes a documented decision, write a memory entry

## Consumer vs Factory

| Aspect | `/update` (this command) | Sync pipeline |
|--------|--------------------------|---------------|
| Direction | Public → local | Local → public |
| What it touches | `.cursor/` + `autogit/` only | Full source tree via allowlist |
| Registry URL | `agent-kit-startup/agent-kit` | `agent-kit-startup/agent-kit-dev` |
| Protected paths | Respected | N/A (full tree copy) |
| Version source | GitHub releases / tags | Local `package.json` |

## Typical flow

```
User: /update
Agent: Reading .cursor/agent-kit.json... Current: v4.7.0
Agent: Checking public repo... Latest: v4.7.2
Agent: v4.7.2 has 12 files changed vs current. Apply?
User: yes
Agent: Running agent-kit update... Done! 8 updated, 2 added, 1 protected.
       HANDOFF updated.
```

## Troubleshooting

- **"Cannot find public remote"**: The `public` remote may not exist. Add it:
  ```bash
  git remote add public git@github-agent-kit:agent-kit-startup/agent-kit.git
  ```
  Or use the URL directly via `--url`.

- **"npx resolution failed"**: Ensure Node.js ≥18 is available. Try `pnpm exec agent-kit update` as fallback.

- **"Registry URL differs from installed"**: The current manifest may point to the dev repo. The update will switch it to the public repo — that's correct for consumer mode.
