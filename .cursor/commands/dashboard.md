# Command: /dashboard

## Goal

Start (or reuse) Mission Control for **this Cursor workspace only**, then open the printed URL in the IDE browser.

Local-dev only. Read-only. No HITL gate.

**Terminal counterpart:** `agent-kit dashboard` from the workspace cwd. After a CLI publish that ships Path C, the installed package includes `dashboard/start.mjs`. Fallbacks: env `MISSION_CONTROL_KIT_ROOT` / `AGENT_KIT_HOME`, sibling `../agent-kit`, or `node "$KIT_ROOT/dashboard/start.mjs"` with `MISSION_CONTROL_REPO_ROOT` set to this git root. Until Path C is on npm, do not assume `@dadado/agent-kit-cli@4.8.0` has the panel assets.

## When to Use

- Inspect plans / HANDOFF / git / memory for **the open workspace**
- Reload the panel after plan or HANDOFF changes (run this command again; starter reuses the same port when already up)
- Several workspaces open: each keeps its **own** instance and port. Never expect one shared `:3333` for every project.

## What to Do (required order)

### 1. Resolve roots

```bash
SNAPSHOT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
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

### 4. Open the panel

1. `cursor-ide-browser` → `browser_navigate` with `newTab: true` and the **printed** `MC_URL`
2. If result is `chrome-error://chromewebdata/`: connection refused; fix step 2/3, then navigate once more
3. Copy the URL for the operator (`pbcopy` on macOS) and mention Simple Browser as a fallback

### 5. Verify

Wait for the `Live` badge (~3–5s) or curl the JSON again. Header should show this workspace's basename. Confirm plan/HANDOFF counts look like **this** repo, not the kit monorepo.

## Hard rules

| Do | Do not |
|----|--------|
| Set `MISSION_CONTROL_REPO_ROOT` to this git toplevel | Assume `http://localhost:3333` |
| Use `node "$KIT_ROOT/dashboard/start.mjs"` | `kill` a listener to "free" 3333 for another project |
| Open the **printed** URL | Reuse HTTP 200 on any port without checking `system.repoRoot` |
| Leave other workspaces' Mission Control running | Start `serve.mjs` from a kit tree without `MISSION_CONTROL_REPO_ROOT` |

## Notes

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
| `No dashboard/start.mjs found` | Consumer-only tree | Set `MISSION_CONTROL_KIT_ROOT` / `AGENT_KIT_HOME` or sibling `../agent-kit` |
| Empty skeletons | Cold snapshot | Wait for `Live` |
