# Command: /dashboard-broadcast

## Goal

Start Mission Control in **opt-in LAN broadcast** mode: bind a non-loopback interface with a **required session token**, print LAN URL(s) + token, and open a browser when possible.

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

1. **Prefer the starter** (handles token generation, `HOST=0.0.0.0`, detach, LAN URL print):

   ```bash
   cd "$(git rev-parse --show-toplevel)"
   npm run dashboard:broadcast
   ```

   Or detach manually only if you must:

   ```bash
   export HOST=0.0.0.0
   export MISSION_CONTROL_TOKEN="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
   # same double-fork / setsid pattern as /dashboard (agent shell reaps bare &)
   ```

2. **Confirm readiness** in a **separate** shell call. Probe with the token:

   ```bash
   curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:3333/?token=$MISSION_CONTROL_TOKEN"
   lsof -nP -iTCP:3333 -sTCP:LISTEN
   ```

3. **Share the printed LAN URL** (includes `?token=`). After first load, an HttpOnly cookie keeps same-origin assets/SSE working. Do not paste the token into docs or commits.

4. **IDE browser:** `cursor-ide-browser` may open `http://127.0.0.1:3333/?token=…` for local verify. LAN devices use the printed `http://<lan-ip>:3333/?token=…` URL.

## Security

- Non-loopback listen **refuses** to start without `MISSION_CONTROL_TOKEN` (min 16 chars). Empty-token / warn-only `HOST=0.0.0.0` is not allowed.
- Static, `/dashboard-data.json`, `/api/data`, and `/api/events` require the token (Bearer, `?token=`, header, or cookie).
- `PUT`/`PATCH /api/config` stays **loopback-only** (token does not unlock LAN writes).
- CTAs remain copy-only; no git stage, process kill, or `/git-prod` from the panel.
- Trusted LAN only; not multi-user internet hosting. See ADR `2026-07-27_mission-control-opt-in-lan-broadcast.md`.

## Stop / firewall

- Stop: `kill "$(lsof -nP -iTCP:3333 -sTCP:LISTEN -t)"` (always `-sTCP:LISTEN`).
- If a loopback `/dashboard` already holds the port, stop it before broadcast.
- OS firewall may block inbound LAN TCP; allow the chosen port for your local network profile if needed.

## Notes

- Port: `PORT` env, default `3333`
- Log default: `/tmp/mission-control-broadcast.log`
- Loopback UX remains `/dashboard` / `npm run dashboard` / `agent-kit dashboard`
- Detach lessons match `/dashboard` (error `2026-07-25_dashboard-server-reaped-agent-shell`)

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Serve exits: non-loopback requires token | `HOST` set without `MISSION_CONTROL_TOKEN` | Use `dashboard:broadcast` or set a ≥16 char token |
| Port busy / token rejected | Existing loopback instance on 3333 | Kill LISTEN pid; retry broadcast |
| Phone cannot connect | Firewall or wrong IP | Confirm printed LAN IPv4; allow inbound TCP |
| Config save 403 from phone | Expected | Config writes are loopback-only |
