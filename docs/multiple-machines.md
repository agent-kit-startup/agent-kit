# Multiple machines

Running the kit on more than one machine (a home-lab server plus laptops, say) does not mean "all state lives in git". Git carries the committed kit surfaces. Several things the kit and Claude Code rely on stay on the machine that wrote them.

## What git carries

Committed and pushed files sync like any other code:

- `.cursor/plans/` (once committed, and only if your `.gitignore` does not exclude `*.plan.md`; some repos keep plans local, so check with `git check-ignore -v .cursor/plans/<name>.plan.md`)
- `.cursor/memory/` (once committed)
- Anything else tracked under `.cursor/`

## What git does not carry

| Surface | Why it stays local |
| --- | --- |
| Uncommitted plan WIP (modified or new `.cursor/plans/*.plan.md`) | Not committed, so other machines never see it. An idle machine can hold it for weeks. |
| `.cursor/HANDOFF.md` | The installer adds it to `.gitignore` as kit-owned state. The active plan and next to-do exist on one machine only. |
| Claude Code auto-memory | Lives outside the repo at `~/.claude/projects/<abs-path-with-dashes>/memory/`. The directory name is derived from the absolute checkout path, so `-Users-me-Documents-repo` and `-home-me-repo` never meet, even for the same repo. User-level memories are also per machine. |
| Runtime context: `.cursor/dogfood/`, `.cursor/context/readiness.json`, `flight-log.json`, `mission-timing.json`, `outcome-ledger.json`, `test-results.json`, `gate-exit.json`, `review-ledger.json`, `plan-index.json` | Machine-local runtime state; the installer adds these to `.gitignore`, and for `gate-exit.json`, `review-ledger.json` and `plan-index.json` the CLI also adds the path to the clone-local `.git/info/exclude` when `.gitignore` does not list it yet. Run logs (`.cursor/loop-logs/`) are local too: the installer adds that pattern, and the runner also drops a `.gitignore` of `*` inside the directory, so logs never show up as untracked files. Audit waits (`.cursor/context/audit-wait/`) are local too, but the installer does not ignore them, so add them to `.gitignore` yourself or they show up as untracked files. |
| Checkout freshness | A checkout can be days behind its upstream branch and still look current. |

Memories that were synced by hand are often machine-relative ("this Mac", `/Users/...` paths, a host since reinstalled with another OS). Treat them as input to curate, not to copy.

## Prerequisites

- SSH (or Tailscale SSH) enabled on every machine you want to audit. On macOS that is Remote Login; if it is off, the machine cannot be inspected from another one.
- If a self-hosted git host sits behind an edge with rate limiting, route over the tailnet so repeated fetches from several machines do not get banned.

## Pull, then curate (read-only first)

Do not `rsync` `.cursor/` or `~/.claude/projects` between machines. A blind copy overwrites newer work with older state.

1. **Inventory, read-only.** On each remote, with no writes:
   - `git --no-optional-locks status --short` for uncommitted plans and other WIP.
   - `git --no-optional-locks rev-list --left-right --count HEAD...@{upstream}` for how far behind or ahead the checkout is.
   - Check whether `.cursor/HANDOFF.md` exists and is git-ignored (`git check-ignore -v .cursor/HANDOFF.md`).
   - List the Claude memory directory for that repo.
2. **Compare against the local HEAD.** For each remote plan edit, check whether a later commit already superseded it. A stale edit copied over a newer commit regresses the plan.
3. **Apply only non-superseded diffs.** Bring them in as a normal commit so they travel through git from then on.
4. **Map memory by repo identity, not path.** Match the remote's memory directory to the local one for the same repo (same `origin` URL), then merge memory by memory. Rewrite or drop anything machine-relative or describing sessions that no longer exist.
5. **Decide on HANDOFF.** Either track it in git, or sync it out of band deliberately. Leaving it silently ignored means the active plan lives on one machine only.

## Not yet automated

These are proposed, not shipped: `agent-kit doctor --stale` (warn on a checkout behind upstream or old plan WIP), and `agent-kit memory export|import` (mirror Claude auto-memory into a repo-relative location keyed by remote URL, with a lint for machine-relative content). Until then, use the manual procedure above.
