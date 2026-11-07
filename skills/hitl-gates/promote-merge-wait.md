# Promote PR merge wait

A staging→main promote PR that waits for the operator merge (the `/git-prod` PR path, a factory wrapper such as `/kit-prod`, the `/run-plan-all` ship lane) uses one bounded wait. GitHub can refuse a merge for a ruleset reason while it reports `MERGEABLE`/`CLEAN` and every check is green, so an open-ended wait can run forever.

## Ruleset preflight

Before the promote PR (or the local merge into `main`), run `agent-kit promote rules --base main`. It reads `gh api repos/<owner>/<repo>/rules/branches/main` and prints one `ruleset advisory` line per rule parameter the kit has no model for, by name (for example `pull_request.require_extra_approval_for_unattributed_changes = true`), and any rule type it does not model. Missing `gh`, no auth, offline or an API error prints one `skipped` note. It is advisory: it always exits 0 and never blocks the promote. Copy any advisory line into the summary before the merge.

## Wait

Run `agent-kit promote wait --pr <N>` (add `--repo <owner/name>` outside the checkout's repo). It is read-only: it polls `gh pr view <N>` with backoff from 30 s up to 5 min and stops at the cap, `promoteMergeWaitMs` in `.cursor/context/config.json` (default 3600000, 60 min; range 1 min to 24 h). `--cap-minutes <n>` overrides the cap for one run.

| Exit | Meaning | Next |
|------|---------|------|
| `0` | Merged | Continue the promote routine (tag, staging sync, verification) |
| `1` | Closed without a merge | Stop. Do not tag, do not reopen the PR. Report |
| `3` | Cap reached | Ask `promote-merge-wait` (below) |

Never hand-roll an unbounded `gh pr view` loop. On a CLI without `promote wait`, poll `gh pr view <N> --json state` with the same backoff and cap.

## Ask `promote-merge-wait`

Labels, in order: `Keep waiting` / `Show the merge box reason` / `Stop and hand off`. Numbered fallback and `HITL_GATE:` sentinel: [SKILL.md](./SKILL.md).

- `Keep waiting`: run the same command once more (one more cap window), then this Ask again on exit 3.
- `Show the merge box reason`: print `gh pr view <N> --json mergeStateStatus,mergeable,reviewDecision` and `agent-kit promote rules --base main`, and ask the operator for the merge box text on the PR page. `CLEAN` plus green checks is not proof GitHub accepts the merge; the API does not name the ruleset rule that refuses it. Then Ask again.
- `Stop and hand off`: write HANDOFF `Mode: STOPPED: awaiting operator merge of PR #<N>` with the last merge state, and stop. A `/run-plan-all` queue holds its cursor.

Never merge the PR yourself, never bypass or edit a ruleset, never run `/git-prod` from this Ask. In `/run-plan-all` this Ask is the expired-wait point; it is not a red stop and does not start the next plan.
