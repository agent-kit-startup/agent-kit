# Mission Kit for Claude Code

Plan, build, review, ship, keep: a working routine for long-term projects with Claude Code. Plans with to-dos you approve, review agents, staging-to-production gates that wait for your yes, and a handoff and memory that survive new chats.

## Plan

Turn a request into a plan with to-dos you approve before any code changes.

- `/agent-kit-onboard`: Get a repository ready for the kit: runs the essential checks and tells you what to fix before your first plan.
- `/start-project`: Turn a request, issue or spec into a plan with phases and to-dos. You approve the plan, then the first step; nothing is built before that.
- `/backlog-add`: Save a new plan for later without touching the plan in progress.

## Build

Work through the plan one to-do at a time, or run a queue of plans.

- `/run-plan`: Work through the active plan to-do by to-do until it is done or needs you, keeping the plan file and the handoff current.
- `/continue-plan`: Do only the next to-do of a plan, then stop so you can review it.
- `/hotfix`: Ship an urgent, narrow fix as a small plan of a few to-dos, then run it. It goes to staging, never straight to production.
- `/run-plan-all`: Run several plans as a queue, one after another, with one release per finished plan after your approval.

## Review

Check the work for bugs, security problems and AI slop before it ships.

- `/qa`: Check a release or a bug report against what the changelog claims: the install path, the tests and what actually changed.
- `security-reviewer` (agent): Security review of a change: auth, secrets, personal data, injection and logging. Use before a merge or when asked for a security check.
- `cleancode-refactor` (agent): Readability and structure review, and refactors that keep behavior. Use when code works but is hard to follow or change.
- `clean-code` (skill): Remove AI code slop after an agent session: redundant comments, noisy try/catch, any casts and deep nesting. Use before a review or a merge.

## Ship

Staging first, production only after your explicit yes.

- `/git-staging`: Bring your changes to the staging branch: Conventional Commits, a changelog entry and the checks your repository defines.
- `/git-prod`: Promote staging to production: closes the release and tags it, and never merges without your explicit yes.

## Keep

State, memory and a live view that survive new chats and new agents.

- `/handoff`: Write down where the work stands, so a new chat or another agent picks it up without you explaining it again.
- `/summary`: Lost track? See where the project stands on one screen: what is done, what is left and the next step.
- `/dashboard`: Open Mission Control in your browser: the plans, runs, health and memory of this repository.
- `memory-extractor` (agent): Save the decisions and mistakes worth remembering into the repository memory, so the next session does not repeat them. Use after a milestone or before a handoff.

## Install

This folder is the plugin as listed in the Claude plugin directory (version 6.23.0): the commands, agents and skills above, and no hooks or scripts. The commands work on a repository prepared by the agent-kit CLI (`agent-kit install`); see [install.md](https://github.com/agent-kit-startup/agent-kit/blob/main/install.md). Mission Control comes with the CLI.

The full kit (every command, the session-start context and the shell guard hooks) installs from the repository marketplace:

```
/plugin install agent-kit --marketplace agent-kit-startup/agent-kit
```

Source, issues and license (Apache-2.0): https://github.com/agent-kit-startup/agent-kit
