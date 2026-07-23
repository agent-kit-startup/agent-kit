# Getting Started

Agent Kit keeps your AI coding agent working against a plan and stops you from losing context when a chat gets too long. This guide covers installing it, the commands you get, and how a normal day looks.

## Install

Run this from your project's root folder:

```bash
npx @dadado/agent-kit-cli install
```

Unpinned `npx` resolves to the latest publish. Pin a version when you need a reproducible install: `npx @dadado/agent-kit-cli@x.y.z install` (replace `x.y.z` with a version from npm).

That's the whole install. It drops a small set of rules and slash commands into `.cursor/`, a git routine into `autogit/`, and a manifest (`.cursor/agent-kit.json`) that records what was installed so the kit can update itself later without touching your work.

Want a few extra bundles up front? Add packs (clean code, context tools, and more - see [domain packs](domain-packs.md)):

```bash
npx @dadado/agent-kit-cli install --pack clean-code,context-management
```

**Prefer chat install?** Copy-paste the installer brief from the [README](../README.md#install) into Cursor chat. You get exactly the same result. The chat installer uses **Ask questions** for confirmations (clickable options in IDE UI, with chat fallback when tool unavailable), while the CLI uses terminal prompts.

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

0. **`/onboard`** *(first time only)* - Welcome, optional **workspace skin** pick, optional **external plan review** Ask (`Enable Claude external review` / `Skip for now`), and introduction to core commands via **Ask questions** tool (clickable options); sets onboarded marker and may write `workspaceSkin` / `externalPlanReview` into `.cursor/context/config.json`. Path after CLI install: open the folder in Cursor → `/onboard` → `/start-project`.
1. **`/start-project`** - Broad Intake Review, then two gates using **Ask questions**: (A) the agent proposes and writes a plan with checkable to-dos (no coding yet); (B) only after you confirm, it runs the **first** unit. Uses clickable options with chat fallback when tool unavailable. Goal text in the same message is not execute permission.
2. **Work one phase.** The agent implements the current phase (or one heavy to-do), checks it off, updates `.cursor/HANDOFF.md`, and stops. Context Guardian plus **native Cursor hooks** (`sessionStart` / `preCompact`) enforce that boundary; multi-phase in one window needs an explicit mode below.
3. **`/handoff`** - when the chat is getting long (or the IDE is about to compact context), the agent writes down where things stand (and suggests pushing to staging if there's something worth committing).
4. **New chat → `/continue-plan`** - it reads the handoff and continues, without you re-explaining the project. Chat tone follows the Autopilot skin by default (see [skins contract](skins-contract.md)).

### Workspace skins

Skins change **chat tone and CLI tick banners only**. Defaults by mode: Autopilot for `/continue-plan`, Night Shift for `/run-plan`, Ghost Runner for `agent-kit run-plan`. They never alter commits, HANDOFF, memory, or product documentation. Pick during `/onboard` / `agent-kit init`, change later via the onboarded menu, or edit `workspaceSkin` in `.cursor/context/config.json`. Contract and contribute path: [skins-contract.md](skins-contract.md), [creating-skins.md](creating-skins.md).

### Less babysitting

- **`/run-plan`** - the agent works through the plan to the end, checking off to-dos and pushing to staging when there's something to commit (Night Shift chat chrome by default). It picks the best execution strategy itself: worker delegation when your setup supports it (keeps the main chat from filling up), a same-chat loop otherwise. It never promotes to production on its own. The old `/run-plan-loop` and `/run-plan-orchestrated` still work as deprecated aliases.

> **Note for headless/scheduled execution:** If running continuous plan loops or scheduled agents outside the IDE (e.g. via `agent-kit run-plan` or `scripts/plan-loop.sh`), use a separate git worktree or clone rather than sharing an interactive working tree. This prevents conflicts between automated commits and manual work.

### Optional external plan review

When `/run-plan` finishes all implementable to-dos, you can get a second-agent check of the shipped work. Artifacts ship with L0; the feature stays opt-in (`enabled: false` by default).

1. **Enable it:** `/onboard` Ask, or set `"externalPlanReview": { "enabled": true, "offerOnExhausted": true }` in `.cursor/context/config.json` (see `config.example.json`)
2. **Auto-arm:** when enabled, `/run-plan` arms `.cursor/scripts/plan-external-review.sh` on plan exhausted (wrapper at `scripts/` still works)
3. **Exhaustion Ask:** if not enabled and `offerOnExhausted` allows it, chat may Ask `Run review now` / `Always enable automatic` / `Not now`
4. **Manual:** `/plan-external-review` anytime after a plan is done (`--force` for one-shot without persisting opt-in)
5. **Triage:** after Claude writes a monitor file, use `/plan-review-triage`

Claude Code on PATH is optional. If disabled or `claude` is missing, the kit continues with a tip and exit 0 (no CI failure). Details: [external plan review](external-plan-review.md).

### Security considerations

**Plan execution runs with sandbox disabled:** The continuous plan execution (`/run-plan`) uses `cursor-agent --sandbox disabled` to access filesystem operations, git commands, and project tools. This is required for the agent to implement code changes and commit to staging. Maintainers should review plan to-dos and registry skills before enabling continuous execution, as these function as direct agent instructions.

The exact git steps behind staging and production live in `autogit/gitupdate.md`; plan modes in `autogit/plan-routine.md`. Both are installed with the kit. Native hooks are listed in [layers-spec.md](layers-spec.md) (L0).

## Working on Agent Kit itself

If you're developing the kit (not just using it):

1. Install dependencies: `pnpm install`
2. Build the CLI: `pnpm build`
3. Try the scanner: `pnpm --filter @dadado/agent-kit-cli start scan`
4. Install into a test project: `pnpm --filter @dadado/agent-kit-cli start install --cwd /path/to/project`
5. Check this repo's own install: `pnpm --filter @dadado/agent-kit-cli start status`

See the root [README](../README.md) for the big picture and [CONTRIBUTING](CONTRIBUTING.md) for how changes flow.
