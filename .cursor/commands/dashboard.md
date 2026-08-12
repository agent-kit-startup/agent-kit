---
name: dashboard
description: Start or reuse Mission Control for this workspace and open the printed URL.
---

# Command: /dashboard

## Goal

Start (or reuse) Mission Control for **this workspace only**, then open the printed URL in **one** browser target: the IDE browser MCP (required path below). Do not open Chrome, Safari, Firefox, or other external browsers in addition. Preferred OS browser applies only when the operator runs `agent-kit dashboard` / `npm run dashboard` without `--no-open`.

Local-dev only. Read-only. No HITL gate unless `missionControl.preferredBrowser` is unset/`ask` and the operator wants to persist a preference (optional Ask; see step 4).

**Terminal / IDE-agnostic invoke:** `agent-kit dashboard` or `npx @dadado/agent-kit-cli dashboard` from the workspace cwd. The installed package includes `dashboard/start.mjs` from 4.8.2 onward. Fallbacks: env `MISSION_CONTROL_KIT_ROOT` / `AGENT_KIT_HOME`, sibling `../agent-kit`, or `node "$KIT_ROOT/dashboard/start.mjs"` with `MISSION_CONTROL_REPO_ROOT` set to this git root. On 4.8.0 or an older pin the panel assets are absent.

## When to Use

- Inspect plans / HANDOFF / git / memory for **the open workspace**
- Reload the panel after plan or HANDOFF changes (run this command again; starter reuses the same port when already up)
- Several workspaces open: each keeps its **own** instance and port. Never expect one shared `:3333` for every project.

## What to Do (required order)

### 1. Resolve roots

```bash
# Prefer nearest Agent Kit install over git toplevel (nested monorepo packages).
SNAPSHOT_ROOT="$(pwd)"
d="$(pwd)"
while [ "$d" != "/" ]; do
  if [ -f "$d/.cursor/agent-kit.json" ]; then
    SNAPSHOT_ROOT="$d"
    break
  fi
  d="$(dirname "$d")"
done
if [ ! -f "$SNAPSHOT_ROOT/.cursor/agent-kit.json" ]; then
  SNAPSHOT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
```

Find `KIT_ROOT` (directory that contains `dashboard/start.mjs`):

1. `$SNAPSHOT_ROOT` if `dashboard/start.mjs` exists there
2. Else `$MISSION_CONTROL_KIT_ROOT` or `$AGENT_KIT_HOME` (absolute)
3. Else sibling `$(dirname "$SNAPSHOT_ROOT")/agent-kit` when that tree has `dashboard/start.mjs`
4. Else prefer running `agent-kit dashboard` (CLI resolves a Path C bundled `dashboard/start.mjs` from the installed package when present)

If none exist: stop and tell the operator to reinstall a Path C CLI, set `MISSION_CONTROL_KIT_ROOT`, or keep a sibling `agent-kit` checkout. Do **not** start a random other project's panel.

### 2. Start or reuse (always use the kit starter)

Do **not** hand-roll `serve.mjs` + `kill` on 3333. The starter picks a stable port for this `SNAPSHOT_ROOT` (range `3333–3588`), reuses when `system.repoRoot` already matches, and **never kills** another workspace.

```bash
export MISSION_CONTROL_REPO_ROOT="$SNAPSHOT_ROOT"
export HOST=127.0.0.1
unset MISSION_CONTROL_TOKEN
unset PORT
cd "$KIT_ROOT"
MISSION_CONTROL_NO_OPEN=1 node dashboard/start.mjs
```

Capture the printed URL (example: `http://127.0.0.1:3511/`). That URL is authoritative; it is often **not** `:3333`.

Running this again in the same repo is the **reload** path: same URL, same instance, fresh snapshots via SSE/poll.

### 3. Confirm this workspace owns the URL

In a **separate** shell call:

```bash
curl -sf "${MC_URL}dashboard-data.json" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d); console.log(j.system?.repoRoot, j.system?.port)})'
```

`system.repoRoot` must equal `SNAPSHOT_ROOT`. If it does not, do not open that URL; re-run step 2 and use the new printed URL.

### 4. Open the panel (single path)

**Invariant:** open **at most one** browser surface. Never launch multiple external browsers.

1. Optional Ask (only when `.cursor/context/config.json` → `missionControl.preferredBrowser` is missing, null, or `"ask"`, and the operator may want a saved OS preference for CLI opens): labels `Keep IDE browser only` / `Remember preferred browser for CLI` / `Skip open`. If they pick remember, set `missionControl.preferredBrowser` to an app name (e.g. `Google Chrome`) or leave null for OS default on future CLI opens. Slash `/dashboard` itself still uses the IDE MCP path below (not a second OS open).
2. `cursor-ide-browser` → `browser_navigate` with `newTab: true` and the **printed** `MC_URL` (**only** this navigate; do not also run `open` / `xdg-open` / MCP + OS).
3. If result is `chrome-error://chromewebdata/`: connection refused; fix step 2/3, then navigate **once** more (still a single surface).
4. Copy the URL for the operator (`pbcopy` on macOS). Mention Simple Browser as a **manual** fallback for the human, not as a second agent-driven open.

### 5. Verify

Wait for the `Live` badge (~3–5s) or curl the JSON again. Header should show this workspace's basename. Confirm plan/HANDOFF counts look like **this** repo, not the kit monorepo.

## Hard rules

| Do | Do not |
|----|--------|
| Set `MISSION_CONTROL_REPO_ROOT` to the nearest Agent Kit install (or git toplevel when none) | Assume `http://localhost:3333` |
| Use `node "$KIT_ROOT/dashboard/start.mjs"` | `kill` a listener to "free" 3333 for another project |
| Open the **printed** URL once (IDE MCP) | Reuse HTTP 200 on any port without checking `system.repoRoot`; open every installed browser |
| Leave other workspaces' Mission Control running | Start `serve.mjs` from a kit tree without `MISSION_CONTROL_REPO_ROOT` |

## Notes

- Preferred browser for CLI/OS opens: `missionControl.preferredBrowser` in `.cursor/context/config.json`, env `MISSION_CONTROL_PREFERRED_BROWSER`, or `agent-kit dashboard --browser "App Name"`. ADR `2026-08-11_mission-control-preferred-browser.md`.
- Snapshot (plans, HANDOFF, git, memory) = `MISSION_CONTROL_REPO_ROOT`. Static UI = kit tree that hosts `dashboard/`.
- Explicit `PORT` overrides hashing; if that port belongs to another root, start refuses (no kill).
- Loopback only by default. LAN: `/dashboard-broadcast` (token-gated).
- Stop **this** panel only: kill the PID on **this** `system.port` whose `repoRoot` matches. Never kill another project's instance.
- File actions stay copy-only (Quick Open paste). Checklist **Run all** copies `/run-plan-all`; it does not execute from the panel.
- Consumer L0 ships this command text, not `dashboard/**`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Panel shows kit plans / wrong HANDOFF | Missing `MISSION_CONTROL_REPO_ROOT` or opened another workspace's URL | Re-run step 2; open printed URL; check header basename |
| Expected `:3333` | Per-workspace port allocation | Use printed URL / `system.port` |
| `chrome-error://chromewebdata/` | Server not listening on that URL | Re-run starter; navigate again |
| `PORT … will not kill another workspace` | Explicit `PORT` held by another root | `unset PORT` and re-run starter |
| `No dashboard/start.mjs found` | Consumer-only tree | Set `MISSION_CONTROL_KIT_ROOT` / `AGENT_KIT_HOME`, sibling `../agent-kit`, or `npx @dadado/agent-kit-cli@latest dashboard` |
| `403 Forbidden` on CLI package fetch | Registry auth policy or private scope | `npm login`, check `.npmrc`, or use env/sibling fallback |
| Empty skeletons | Cold snapshot | Wait for `Live` |
