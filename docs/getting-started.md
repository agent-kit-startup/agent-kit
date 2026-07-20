# Getting Started

Agent Kit keeps your AI coding agent working against a plan and stops you from losing context when a chat gets too long. This guide covers installing it, the commands you get, and how a normal day looks.

## Install

Run this in your project's root folder:

```bash
# once @dadado/agent-kit-cli is on npm
npx @dadado/agent-kit-cli install
```

That's the whole install. It drops a small set of rules and slash commands into `.cursor/`, a git routine into `autogit/`, and a manifest (`.cursor/agent-kit.json`) that records what was installed so the kit can update itself later without touching your work.

**Until the CLI is published to npm**, install from a kit checkout and pull the public registry:

```bash
# from a clone of agent-kit-dev (or public agent-kit after pnpm install && pnpm build)
pnpm --filter @dadado/agent-kit-cli start -- install \
  --cwd /path/to/your-project \
  --url https://github.com/agent-kit-startup/agent-kit \
  --ref main
```

Want a few extra bundles up front? Add packs (clean code, context tools, and more - see [domain packs](domain-packs.md)):

```bash
npx @dadado/agent-kit-cli install --pack clean-code,context-management
# or the same --pack flag on the pnpm start -- install form above
```

**Prefer not to use the CLI?** Open your project in the IDE, drag in the root [`install.md`](../install.md), and ask the agent to install. You get exactly the same result. The install wizard will use **Ask questions** for confirmations (clickable options in IDE UI), while the CLI uses terminal prompts.

> Don't clone the Agent Kit repo into your project. Installing writes only the files your project needs - see [bootstrap](bootstrap.md) for the exact layout.

There's also a guided setup that scans your project and asks a few questions before installing:

```bash
npx @dadado/agent-kit-cli init
```

## The commands you get

| Command | What it does |
|---------|-------------|
| `agent-kit install [profile]` | Install the base kit into your project (add packs with `--pack`) |
| `agent-kit init` | Guided setup: scan your project, ask a few questions, then install |
| `agent-kit add <id>` | Add one skill or pack later |
| `agent-kit status` | Show what's installed (version, packs, protected files) |
| `agent-kit update` | Pull the latest rules and commands; leaves your own files alone |
| `agent-kit diff` | Show what changed between what you have and the latest |
| `agent-kit contribute` | Send an improvement you made locally back upstream |
| `agent-kit handoff` | Save your progress to `.cursor/HANDOFF.md` |
| `agent-kit scan` | Just scan the project, don't install |

## A normal day

The idea is simple: work against a plan, save your place before a conversation gets too big, and (in manual mode) keep **one phase per chat**.

1. **`/start-project`** - Broad Intake Review, then two gates using **Ask questions**: (A) the agent proposes and writes a plan with checkable to-dos (no coding yet); (B) only after you confirm, it runs the **first** unit. Uses clickable options instead of "type yes to continue". Goal text in the same message is not a green light to edit the repo.
2. **Work one phase.** The agent implements the current phase (or one heavy to-do), checks it off, updates `.cursor/HANDOFF.md`, and stops. Soft rules plus **native Cursor hooks** (`sessionStart` / `preCompact`) reinforce that boundary; multi-phase in one window needs an explicit mode below.
3. **`/handoff`** - when the chat is getting long (or the IDE is about to compact context), the agent writes down where things stand (and suggests pushing to staging if there's something worth committing).
4. **New chat → `/continue-plan`** - it reads the handoff and continues, without you re-explaining the project.

### Less babysitting

- **`/run-plan`** - the agent works through the plan to the end, checking off to-dos and pushing to staging when there's something to commit. It picks the best execution strategy itself: worker delegation when your setup supports it (keeps the main chat from filling up), a same-chat loop otherwise. It never promotes to production on its own. The old `/run-plan-loop` and `/run-plan-orchestrated` still work as deprecated aliases.

> **Note for headless/scheduled execution:** If running continuous plan loops or scheduled agents outside the IDE (e.g. via `agent-kit run-plan` or `scripts/plan-loop.sh`), use a separate git worktree or clone rather than sharing an interactive working tree. This prevents conflicts between automated commits and manual work.

### Optional external plan review

When `/run-plan` finishes all implementable to-dos, you can get a second-agent check of the shipped work:

1. **Enable it:** Add `"externalPlanReview": { "enabled": true }` to `.cursor/context/config.json`
2. **Auto-arm:** `/run-plan` suggests running `scripts/plan-external-review.sh` when it reaches plan exhausted
3. **Manual:** Use `/plan-external-review` command anytime after a plan is done
4. **Triage:** After Claude writes a monitor file, use `/plan-review-triage` to process findings with clickable options

This requires Claude Code CLI on your PATH. If disabled or Claude is missing, the kit continues normally without external review.

The exact git steps behind staging and production live in `autogit/gitupdate.md`; plan modes in `autogit/plan-routine.md`. Both are installed with the kit. Native hooks are listed in [layers-spec.md](layers-spec.md) (L0).

## Working on Agent Kit itself

If you're developing the kit (not just using it):

1. Install dependencies: `pnpm install`
2. Build the CLI: `pnpm build`
3. Try the scanner: `pnpm --filter @dadado/agent-kit-cli start scan`
4. Install into a test project: `pnpm --filter @dadado/agent-kit-cli start install --cwd /path/to/project`
5. Check this repo's own install: `pnpm --filter @dadado/agent-kit-cli start status`

See the root [README](../README.md) for the big picture and [CONTRIBUTING](CONTRIBUTING.md) for how changes flow.
