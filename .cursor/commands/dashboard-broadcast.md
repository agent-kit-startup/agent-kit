---
name: dashboard-broadcast
description: Start Mission Control in opt-in LAN broadcast mode with a required session token.
---

# Command: /dashboard-broadcast

## Goal

Start Mission Control in **opt-in LAN broadcast** mode: bind a non-loopback interface with a **required session token**, print LAN URL(s) + token, and open **one** browser surface when possible (preferred OS browser from config/env, or IDE local verify — not both unless Ask says so).

This does **not** change `/dashboard` (loopback-first, no token). Do not set `HOST=0.0.0.0` on the loopback path without this command and token gate.

**Human / terminal counterpart:** from the agent-kit repo root:

```bash
npm run dashboard:broadcast
# or
agent-kit dashboard-broadcast
# or
node dashboard/start-broadcast.mjs
```

## When to Use

- Operator wants Mission Control on a phone/tablet on the **same trusted LAN**
- Explicit opt-in only; never as the default for `/dashboard`

## What to Do

0. **Derive the workspace port** so the probe/stop snippets below are runnable. The starter also prints this port.

   From the agent-kit repo root:

   ```bash
   cd "$(git rev-parse --show-toplevel)"
   export MC_PORT=$(node -e 'import("./dashboard/lib/guards.mjs").then(m => console.log(m.preferredPortForRepoRoot(process.cwd()))).catch(e => { console.error(e.message); process.exit(1) })')
   ```

   If you set an explicit `PORT`, use that value instead of the derivation.

1. **Prefer the starter** (handles token generation, `HOST=0.0.0.0`, detach, LAN URL print):

   ```bash
   cd "$(git rev-parse --show-toplevel)"
   npm run dashboard:broadcast
   ```

   Or detach manually only if you must:

   ```bash
   export HOST=0.0.0.0
   export MISSION_CONTROL_TOKEN="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
   export MC_PORT=$(node -e 'import("./dashboard/lib/guards.mjs").then(m => console.log(m.preferredPortForRepoRoot(process.cwd()))).catch(e => { console.error(e.message); process.exit(1) })')
   export PORT=$MC_PORT
   # same double-fork / setsid pattern as /dashboard (agent shell reaps bare &)
   ```

2. **Confirm readiness** in a **separate** shell call. Use the port printed by the starter (per-workspace allocation, often not `:3333`) or the `MC_PORT` derived above:

   ```bash
   curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:$MC_PORT/?token=$MISSION_CONTROL_TOKEN"
   lsof -nP -iTCP:$MC_PORT -sTCP:LISTEN
   ```

   Verify `system.repoRoot` matches this workspace before trusting the response as your own Mission Control.

3. **Share the printed Share URL** (Mission Kit cosmetic mask, default `https://missionkit.io/mc/open.html#…`). The fragment is reversible base64url of the full LAN URL **including the live token** — treat the Share URL with the **same secret handling** as the raw token (do not paste into Slack, tickets, screenshots, docs, or commits). Hostinger access logs never see the fragment; that does not make the link non-secret. Phone/tablet must still be on the **same trusted LAN**. After first Mission Control load, an HttpOnly cookie keeps same-origin assets/SSE working. Override base with `MISSION_CONTROL_SHARE_BASE` (BYO **HTTPS** origin hosting `open.html`; non-HTTPS is rejected except loopback http for local preview). Set `off` for raw LAN-only print (also the recovery if a hosted resolver 404s). Extensionless `…/mc/open` may still 404 on Hostinger until an alias exists; the default uses `open.html`. Soft TTL via `MISSION_CONTROL_SHARE_TTL_SEC` (default 86400; `0` = never expires in the UI). Expiry is **advisory only** (client refuse); hard revoke = stop broadcast or rotate `MISSION_CONTROL_TOKEN`. Secondary LAN lines default on (`MISSION_CONTROL_SHARE_SHOW_LAN=0` to hide).

4. **Open one surface only** (never OS + IDE together by default):
   - **Default (CLI / npm):** let `start-broadcast.mjs` open the preferred browser to the **Share URL** when masking is on (config `missionControl.preferredBrowser`, env `MISSION_CONTROL_PREFERRED_BROWSER`, or `--browser`). Use `--no-open` / `MISSION_CONTROL_NO_OPEN=1` to skip OS open (server still prints Share URL + token / LAN lines).
   - **Slash / agent path:** prefer Ask when preference is unset/`ask`: `Open OS preferred browser` / `IDE verify only (no OS open)` / `Skip open`. Then either run the starter **without** `MISSION_CONTROL_NO_OPEN` (OS preferred, no IDE navigate) **or** set `MISSION_CONTROL_NO_OPEN=1` and navigate once with `cursor-ide-browser` to `http://127.0.0.1:$MC_PORT/?token=…` (or to a local `http://127.0.0.1:$MC_PORT/open.html#…` preview). Do not do both in the same run unless the operator explicitly asked for dual open.
   - LAN devices use the printed **Share** URL (human paste). Raw `http://<lan-ip>:$MC_PORT/?token=…` remains secondary/debug.

## Security

- Non-loopback listen **refuses** to start without `MISSION_CONTROL_TOKEN` (min 16 chars). Empty-token / warn-only `HOST=0.0.0.0` is not allowed.
- Static, `/dashboard-data.json`, `/api/data`, and `/api/events` require the token (Bearer, `?token=`, header, or cookie).
- `PUT`/`PATCH /api/config` stays **loopback-only** (token does not unlock LAN writes).
- CTAs remain copy-only; no git stage, process kill, or `/git-prod` from the panel.
- Trusted LAN only; not multi-user internet hosting. Share URLs are **cosmetic** (fragment → private/loopback LAN only); they are not a WAN relay. The Share URL **is a secret** (embeds the live token). See ADR `2026-07-27_mission-control-opt-in-lan-broadcast.md` and `2026-08-11_mission-control-broadcast-url-mask.md`.
- `GET /open.html` (alias `/open`) is the public share-resolver shell under broadcast bind; it does not unlock snapshot/SSE/API without the token. Resolver rejects non-private targets.

## Stop / firewall

- Stop **this workspace only**: kill the PID on the port printed by the starter or derived as `MC_PORT`, never a hardcoded `:3333`. Use the printed `system.port` (or `PORT` / `MC_PORT` if you set one):
  ```bash
  kill "$(lsof -nP -iTCP:$MC_PORT -sTCP:LISTEN -t)"
  ```
- **Never kill a listener on a port owned by another workspace.** Verify `system.repoRoot` before killing:
  ```bash
  curl -sf "http://127.0.0.1:$MC_PORT/dashboard-data.json?token=$MISSION_CONTROL_TOKEN" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(JSON.parse(d).system?.repoRoot))'
  ```
- If a loopback `/dashboard` already holds the port, stop it before broadcast.
- OS firewall may block inbound LAN TCP; allow the chosen port for your local network profile if needed.

## Notes

- Port: `PORT` env overrides; default is the per-workspace hash allocation (range `3333-3588`). Derive it with the snippet in step 0 or read the printed `system.port`.
- Log default: `/tmp/mission-control-broadcast.log`
- Loopback UX remains `/dashboard` / `npm run dashboard` / `agent-kit dashboard`
- Detach lessons match `/dashboard` (error `2026-07-25_dashboard-server-reaped-agent-shell`)

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Serve exits: non-loopback requires token | `HOST` set without `MISSION_CONTROL_TOKEN` | Use `dashboard:broadcast` or set a ≥16 char token |
| Port busy / token rejected | Existing instance on the allocated port | Kill LISTEN pid for **this** workspace only (verify `repoRoot`); retry broadcast |
| Phone cannot connect | Firewall or wrong IP | Confirm printed LAN IPv4; allow inbound TCP |
| Config save 403 from phone | Expected | Config writes are loopback-only |
