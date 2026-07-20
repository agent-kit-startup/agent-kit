# What installing Agent Kit puts in your project

When you install Agent Kit, it doesn't copy its own repository into your project. It writes just the files your project needs: a few rules and commands under `.cursor/`, a git routine under `autogit/`, and a small manifest that tracks what was installed. This page shows exactly what lands where and why.

## The layout you get

```text
your-project/
├── .cursor/
│   ├── agent-kit.json          # manifest: version, installed packs, files to protect
│   ├── hooks.json              # Cursor-native agent hooks (phase/context)
│   ├── rules/                  # always-on rules (base install; more if you add packs)
│   ├── commands/               # slash commands (/start-project, /handoff, /git-prod, …)
│   ├── hooks/
│   │   ├── pre-commit/         # secrets check (git)
│   │   └── agent/              # sessionStart / stop / preCompact scripts
│   ├── skills/                 # only if you add skills
│   ├── agents/                 # only if a pack or skill brings them
│   ├── plans/                  # your plans (created as you work)
│   ├── memory/                 # notes the agent keeps between chats
│   ├── context/                # working context files
│   └── HANDOFF.md              # where the last session stopped
└── autogit/
    ├── gitupdate.md            # the staging → production routine
    └── plan-routine.md         # how the plan modes (manual / loop / orchestrated) work
```

Everything under `plans/`, `memory/`, `context/`, and `HANDOFF.md` is **yours** - the kit creates the folders but never overwrites what's inside them when it updates.

Optional extra: a `prepare-commit-msg` git hook you can copy from the kit's `git-hooks/` folder (one file, not the whole tree).

Native agent hooks need `python3` on PATH. They are separate from git pre-commit hooks: one runs inside the IDE agent loop; the other runs at commit time.

## Installing

From your project's root:

```bash
npx @dadado/agent-kit-cli install
```

With optional packs:

```bash
npx @dadado/agent-kit-cli install --pack clean-code,context-management
```

What `install` does:

1. Finds the source of the kit's files (a local copy, a `--registry` path, or a remote one from `--url`).
2. Copies the base rules, commands, hooks, and the `autogit/` routine into your project.
3. Optionally adds any packs you asked for with `--pack`.
4. Writes `.cursor/agent-kit.json` recording the version and which of your files to leave untouched on update.

**No CLI on your PATH?** Open the project in your IDE, attach the root [`install.md`](../install.md), and ask the agent to install. It produces the same files and manifest. Chat install and first-install onboarding use **Ask questions** (clickable options in the IDE) for confirmations and choices, with a chat fallback if the tool is unavailable. The CLI path (`agent-kit init` / install wizard) keeps `@clack/prompts` in the terminal; it does not call IDE Ask questions.

## Keeping it current

The kit can update itself against the same source without ever touching your plans, notes, or local tweaks:

| Command | What it does |
|---------|------|
| `agent-kit add <id>` | Add a pack or skill |
| `agent-kit update` | Refresh the installed rules/commands; skips your protected files |
| `agent-kit diff` | Show what's changed vs the latest |
| `agent-kit status` | Version, installed packs, health |

## Moving off an old nested copy

Older setups sometimes copied the whole Agent Kit repo into the project as a nested `agent-kit/` folder. That made it impossible to tell which version you had or to update safely. If you have one:

1. Note anything that only lives in that folder and is unique to your project (custom rules, local skills, plans, notes).
2. Run `agent-kit install` (or the chat install) so the manifest exists.
3. Move your unique files into `.cursor/`.
4. Delete the nested `agent-kit/` folder (and its `node_modules`, if any).
5. Run `agent-kit diff` and `status` to confirm.

Step-by-step: [migrate-consumer.md](migrate-consumer.md).

## Related

- [Getting started](getting-started.md) - install, commands, workflow
- [Layers](layers-spec.md) - how the base install, packs, and your own files layer together
- [Manifest](agent-kit-manifest.md) - the `.cursor/agent-kit.json` file
