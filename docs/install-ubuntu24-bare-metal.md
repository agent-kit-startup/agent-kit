# Install on a fresh Ubuntu 24.04 server

This page is for a bare-metal or VM box running **Ubuntu 24.04 LTS with no Node.js installed**, typically provisioned by a script with no terminal attached (cloud-init, Ansible, a `bash -c` over SSH). It puts a Node bootstrap in front of the same CLI install that [Getting Started](getting-started.md#install-the-kit) documents. It is not a third install path: the CLI path is primary and Port B (`install.md`, install via chat) stays the fallback.

What you get is the base kit only (L0: `.cursor/` rules, commands, hooks, templates, `.cursor/agent-kit.json`, `autogit/`). There is no Ubuntu-specific pack; add L1 packs afterwards with `--pack` if you want them.

**Validation status:** validated end-to-end on a clean Ubuntu 24.04 LTS host on 2026-09-12 — steps 1-4 completed with no errors (exit 0), and the no-terminal case (the same install line piped through `bash -c` with stdin from `/dev/null`) also completed cleanly, exit 0, no `EPERM` and no exit `255`. Keep the recovery table below at hand regardless; it documents the two known failure signatures even though neither reproduced on the validation host.

## Before you start

- A user with `sudo` (or root; cloud-init usually runs as root, in which case drop `sudo` from every command below).
- Outbound HTTPS to `deb.nodesource.com` and `registry.npmjs.org`.
- Do not rely on the `nodejs` package from Ubuntu's default repositories. The CLI requires Node.js 20 or newer (`engines` in its package manifest), and the distro package is not guaranteed to track that line.

Install the two tools the steps below use:

```bash
sudo apt-get update && sudo apt-get install -y curl git
```

## 1. Node.js 20+ from NodeSource (unattended)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```bash
sudo apt-get install -y nodejs
```

Any Node line at 20 or above satisfies the CLI; `22.x` is a maintained LTS line at the time of writing, so pick the line your fleet standardizes on. NodeSource is used instead of `nvm` on purpose: `nvm` depends on sourcing a shell profile, which a non-interactive provisioning script may never load. Confirm with `node -v` before continuing; `npx` comes with it.

## 2. Pick the project root and clear the root guard

```bash
mkdir -p /srv/your-project && cd /srv/your-project
```

```bash
git init
```

`install` refuses to write into a folder that has neither `.git` nor `.cursor/agent-kit.json`, and with no terminal attached that refusal is final (exit 1, nothing written). A `git init` is the recommended way to clear it; `--force-root` is the explicit bypass when you deliberately want L0 without Git. Details: [Project root guard](getting-started.md#project-root-guard) and [Starting from an empty folder](getting-started.md#starting-from-an-empty-folder). The CLI never runs `git init` for you.

## 3. Install the kit with a dedicated npm cache

```bash
npm_config_cache=$HOME/.cache/agent-kit/npm-cache npx -y @dadado/agent-kit-cli@latest install --yes
```

Three things in that line matter on a fresh box:

- `npm_config_cache=...` points npm and npx at a cache directory owned by this install, instead of the user-level `~/.npm/_cacache`. A cache with mixed root/user ownership is the usual source of `EPERM` failures during a scripted install.
- `-y` answers npx's own "Ok to proceed?" question, which npx asks the first time it has to fetch a package. npx asks it only when stdin is a terminal; with no terminal, or when it detects CI, it prints a warning and installs (npm 7 and later, checked against npm 11's `libnpmexec`). Keeping `-y` makes the line behave the same whether you paste it into an SSH session or a provisioning script.
- `--yes` runs the CLI install with defaults instead of the wizard. The CLI also switches to non-interactive mode on its own when `CI=true`, `AGENT_KIT_YES=1`, or stdin is not a terminal, so `--yes` is belt and braces in a provisioning script.

Use `@latest` so npx does not reuse a stale cached CLI; pin `@x.y.z` when the provisioning run has to be reproducible. Both forms are fine, an unpinned `npx @dadado/agent-kit-cli` is not.

## 4. Verify

```bash
npx @dadado/agent-kit-cli@latest status
```

`status` lists the installed version and the L0 tree. Then open the project in Cursor or Claude Code and run `/agent-kit-onboard`, or run `npx @dadado/agent-kit-cli@latest doctor` from the same shell. `npx` leaves no `agent-kit` on `PATH`; run `npm i -g @dadado/agent-kit-cli` once if you want the bare command.

## If it fails

| Symptom | Cause | What to do |
|---------|-------|------------|
| `EPERM` in the npm output, usually naming a path under `~/.npm` | The cache directory has ownership drift (root-written files in a user-owned cache), or something reset `npm_config_cache` to the default | Re-run step 3 with an explicit writable cache, for example `npm_config_cache=/tmp/agent-kit-npm-cache`, or fix ownership of `~/.npm` and re-run |
| Exit code `255` with no other error text | Something asked a question with no terminal to answer it. Confirmed on 2026-09-12: it is not npx when `-y`/`--yes` are present — a real Ubuntu 24.04 run with those flags produced no `255`, including under `bash -c ... < /dev/null`. Separately confirmed that an *unflagged* `npx <pkg> status` call does show a real "Ok to proceed?" prompt on an actual terminal (matching npm's own non-TTY/CI check), so a genuine `255` on this recipe would mean the `-y`/`--yes` flags were dropped from the line, not that npx prompts unconditionally | Re-run step 3 with `-y` and `--yes` present (or `AGENT_KIT_YES=1` in the environment); if the failure persists, run the same command once from an interactive terminal and note which prompt appears |
| `install` refuses the directory and exits `1` | Root guard: no `.git` and no manifest, or the folder looks like a parent of several repositories | `git init` in the intended root (step 2), or `--force-root` after confirming the absolute path |
| `node -v` prints a version below 20 after step 1 | Ubuntu's own `nodejs` package won the install | `sudo apt-get remove -y nodejs`, confirm `apt-cache policy nodejs` lists the NodeSource origin, repeat step 1 |

When the CLI path stays broken, fall back to Port B: attach the root [`install.md`](../install.md) in the IDE chat and let the agent copy the base files. Port B produces the same layout, but its raw fetches carry no package checksum, so use it as the fallback only.

## Maintainers

The factory checkout ships a helper that automates steps 1 to 3 and turns the two known failure signatures above into stable exit codes with recovery text. It is not part of the npm package or the public mirror. See [Development](DEVELOPMENT.md#ubuntu-2404-bare-metal-install-helper).
