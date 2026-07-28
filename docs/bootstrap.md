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
4. Scans the repository, applies safe local readiness fixes, and writes `.cursor/context/readiness.json`.
5. Writes `.cursor/agent-kit.json` recording the version and which of your files to leave untouched on update.

**No CLI on your PATH?** Open the project in your IDE, attach the root [`install.md`](../install.md), and ask the agent to install. It produces the same files, manifest, and readiness snapshot. After install (CLI or chat), the first step is `/agent-kit-onboard` for progressive repository preparation. Chat install and onboarding use **Ask questions** (clickable options in the IDE, with chat fallback when tool unavailable) for confirmations and choices. The CLI path (`agent-kit init` / install) keeps `@clack/prompts` in the terminal; it does not call IDE Ask questions.

## Keeping it current

The kit can update itself against the same source without ever touching your plans, notes, or local tweaks:

| Command | What it does |
|---------|------|
| `agent-kit add <id>` | Add a pack or skill |
| `agent-kit update --check` | **Notify only:** compare installed version to the latest public release tag (no L0 writes) |
| `agent-kit update` | Explicit apply: refresh installed rules/commands; skips protected files |
| `agent-kit diff` | Show what's changed vs the latest |
| `agent-kit status` | Version, installed packs, readiness summary |
| `agent-kit doctor` | Refresh or repair repository readiness |

**Check ≠ apply.** Opt-in session nudges use `updateCheck.enabled` in `.cursor/context/config.json` (default `false`). When enabled, `sessionStart` may advise that a newer public release exists; it never rewrites `.cursor/`. Applying still requires `/update` with Ask confirmation (or an explicit terminal `agent-kit update`). `updateApply.auto` defaults to `false` and is not a silent background path.

Factory/dogfood installs (manifest registry URL `agent-kit-dev` or pre-prod refs such as `staging`) skip the public check with a warning so the factory is not treated as a consumer.

This path is distinct from **public sync** (factory → public mirror) and from **remote-cache auto-refresh** (refreshing a cloned registry tree on resolve).

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
