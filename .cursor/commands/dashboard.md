# Command: /dashboard

## Goal

Start the local Mission Control panel (if needed) and open it in the IDE browser at `http://localhost:3333`.

Local-dev only. Read-only view of repo state. No HITL gate required to open.

**Human / terminal counterpart:** from the agent-kit repo root, `npm run dashboard` (or `agent-kit dashboard`, or `node dashboard/start.mjs`) detach-starts the same server, waits for ready, prints the URL, and opens the default browser. Prefer that over copying `npm run start:dashboard`. Foreground-only debugging remains `npm run start:dashboard`.

## When to Use

- To inspect plans, agents, git, memory, and health in Mission Control
- When the panel should be running but the browser is not open yet

## What to Do

1. **Detect the server** (default port `3333`, or `PORT` if set):
   - Prefer `lsof -nP -iTCP:3333 -sTCP:LISTEN` (or the configured port)
   - Or probe with `curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:3333/`
   - If it already answers `200`, skip to step 4

2. **Start if not listening.** The process must outlive the shell call.

   `nohup ... &`, `disown`, and `( cmd & )` are **not** enough: the agent shell reaps the
   whole process group when the call returns, so the server dies before the browser opens.
   Detach the process from the session (double fork + `setsid`) so it reparents to PID 1:

   ```bash
   cd "$(git rev-parse --show-toplevel)"
   if command -v setsid >/dev/null 2>&1; then
     setsid node dashboard/serve.mjs >/tmp/mission-control.log 2>&1 </dev/null &
   else
     perl -e 'use POSIX qw(setsid); exit if fork; setsid(); exit if fork;
       open(STDIN,"<","/dev/null"); open(STDOUT,">","/tmp/mission-control.log");
       open(STDERR,">&STDOUT"); exec("node","dashboard/serve.mjs");'
   fi
   ```

   macOS has no `setsid`, so the `perl` branch is the one that runs there. Use
   `node dashboard/serve.mjs` directly rather than `npm run start:dashboard`: the npm
   wrapper adds a parent process that complicates detaching and killing.

3. **Confirm readiness in a _separate_ shell call.**

   A curl inside the same call as the spawn will succeed even for a process that is about
   to be reaped, so it proves nothing. In a new call, poll `http://127.0.0.1:3333/` until
   it returns `200` and check the owner reparented:

   ```bash
   lsof -nP -iTCP:3333 -sTCP:LISTEN
   ps -o pid,ppid,command -p "$(lsof -nP -iTCP:3333 -sTCP:LISTEN -t)"
   ```

   `PPID` should be `1`. If there is no listener, read `/tmp/mission-control.log`, report the
   failure and the start command used, and stop.

   Always keep `-sTCP:LISTEN`. A bare `lsof -ti:3333` also matches *client* sockets, so it can
   return the browser host process alongside the server.

4. **Open the panel:**
   a. **`cursor-ide-browser` MCP `browser_navigate`** with `newTab: true` and the URL
      `http://127.0.0.1:3333/`. This works; do not skip it.
   b. If the result URL is `chrome-error://chromewebdata/`, that is **connection refused, not a
      browser crash**. Go back to step 3: the server is almost certainly dead. Fix the server,
      then navigate once more.
   c. Also copy the URL for the user: `echo 'http://localhost:3333' | pbcopy` (macOS) or
      equivalent, and mention **Simple Browser** (`Ctrl+Shift+P` → `Simple Browser`) as an
      alternative host.

5. **Verify data:** the first snapshot takes roughly 3-5s, so the panel renders empty skeletons
   and a `Refreshing...` badge before data lands. Wait for the badge to turn green (`Live`)
   before screenshotting, or curl `/dashboard-data.json` and print a quick summary
   (plan count, agent count, terminal count).

## Notes

- Server entry: `dashboard/serve.mjs` (SPA at `/`, data at `/dashboard-data.json` and `/api/data`, SSE at `/api/events`)
- Port: `PORT` env, default `3333`
- **Security:** binds `127.0.0.1` by default (`HOST` env to override). Local-only; do not expose on shared networks. Static files are limited to `dashboard/`; no secrets or repo files outside that directory are served.
- **The in-IDE browser MCP (`cursor-ide-browser`) does render this panel.** An earlier revision of this command claimed it crashes on localhost; that was a misdiagnosis of a server that had already been reaped. Treat `chrome-error://chromewebdata/` as a server-liveness signal, not a browser defect.
- Stop the panel with `kill "$(lsof -nP -iTCP:3333 -sTCP:LISTEN -t)"`. A detached server survives the chat session, so an old instance may still hold the port on the next `/dashboard`. Never use a bare `lsof -ti:3333` to pick the kill target; it also lists connected clients such as the IDE browser host.
- **File actions:** Mission Control copies the repo-relative path and toasts paste instructions for **Quick Open** (`Cmd+P` / `Ctrl+P`). Native `vscode://file` / `cursor://file` open cannot be confirmed from Simple Browser or agent browser hosts (protocol success is not observable), so path actions are labeled **Copy path**, never `Open`. Commit shas and slash commands stay copy-only.
- Not a remote deploy path; do not treat this as production hosting

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Port answered `200` during startup, then no listener on the next call | Server was backgrounded with `nohup`/`&`/`disown` and reaped with the shell call | Respawn with the double-fork `setsid` snippet in step 2 |
| `browser_navigate` returns `chrome-error://chromewebdata/` | Connection refused; nothing is listening | Re-check step 3, restart the server, navigate again |
| Panel loads but shows empty skeletons | Snapshot generation takes 3-5s | Wait for the `Live` badge before reading the page |
| `EADDRINUSE` on start | A detached instance from a previous session still holds the port | `kill "$(lsof -nP -iTCP:3333 -sTCP:LISTEN -t)"`, or use `PORT` for a second instance |
| `ps: Invalid process id` when inspecting the port | `lsof -ti:3333` returned several PIDs (server plus connected clients) | Add `-sTCP:LISTEN` to select only the listener |