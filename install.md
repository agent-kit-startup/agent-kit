# Agent Kit - Installation

> **You are the installer.** Set up the kit **in the user's project** without copying the entire Agent Kit monorepo into it.

## Contract (mandatory)

1. **Forbidden:** create or maintain an `agent-kit/` folder with the entire repo (CLI, `packages/`, `node_modules`, etc.) inside the consumer project.
2. **Mandatory:** minimal bootstrap layout - see [docs/bootstrap.md](docs/bootstrap.md).
3. **Result:** `.cursor/` with L0 + `.cursor/agent-kit.json` + `autogit/` at project root.

## Preference: CLI

If Node.js is available, in the **consumer project root**:

```bash
npx @dadado/agent-kit-cli install
```

Unpinned `npx` resolves to the latest publish. Pin a version when you need a reproducible install: `npx @dadado/agent-kit-cli@x.y.z install` (replace `x.y.z` with a version from npm).

Optional L1 packs (separate command):

```bash
npx @dadado/agent-kit-cli install --pack clean-code,context-management
```

After: `agent-kit status` (or `npx @dadado/agent-kit-cli status`).

Contributors working from a kit monorepo checkout: use the local CLI examples in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) (Working on the kit). Do not paste monorepo `pnpm --filter` commands into a consumer project.

If CLI runs successfully, skip to **Onboarding** below.

## Port B: install via chat (no CLI)

Entry path: either the user drags `install.md` into chat, or they paste the agent brief from [install-prompt.md](install-prompt.md) which points to this contract. Before any file writes, confirm the absolute workspace root path using **Ask questions** tool (fallback to chat if unavailable). Prefer running `npx @dadado/agent-kit-cli install` when Node.js/npx are available; use the file sync below only when CLI is not available.

### 1. Create minimal structure (L0 + session)

```
.cursor/
├── agent-kit.json
├── hooks.json      # Cursor-native: sessionStart / preCompact
├── rules/          # rules L0 listadas abaixo
├── commands/       # commands L0
├── hooks/
│   ├── pre-commit/
│   │   └── check-secrets.sh
│   └── agent/
│       ├── session-plan-guard.py
│       └── precompact-handoff.py
├── plans/
├── memory/
├── context/
│   ├── templates/  # optional: context-pack, handoff, task-brief, adr
│   ├── current/
│   └── archive/
└── HANDOFF.md      # if it does not exist yet
autogit/
├── gitupdate.md
└── plan-routine.md
```

**Don't** create complete skill tree n8n/SQL/ClickUp by default - that's L2 (`agent-kit add`) or L1 pack.

### 2. L0 content (source = this repository / registry)

Copy **only** these artifacts (same content from SoT / registry), not the monorepo:

| Destination | Source in kit |
|-------------|---------------|
| `.cursor/rules/cursor-plan-handoff.mdc` | `.cursor/rules/cursor-plan-handoff.mdc` |
| `.cursor/rules/context-guardian.mdc` | idem |
| `.cursor/rules/cursor-skills-git-workflow.mdc` | idem |
| `.cursor/rules/cursor-skills-general.mdc` | idem |
| `.cursor/rules/ux-tone.mdc` | idem |
| `.cursor/rules/agent-output-hygiene.mdc` | idem |
| `.cursor/rules/docs-professional-standard.mdc` | idem |
| `.cursor/rules/memory-loop.mdc` | idem |
| `.cursor/rules/hitl-ask-questions.mdc` | idem |
| `.cursor/commands/start-project.md` | idem |
| `.cursor/commands/continue-plan.md` | idem |
| `.cursor/commands/run-plan.md` | idem |
| `.cursor/commands/run-plan-loop.md` | idem (deprecated alias) |
| `.cursor/commands/run-plan-orchestrated.md` | idem (deprecated alias) |
| `.cursor/commands/handoff.md` | idem |
| `.cursor/commands/summary.md` | idem |
| `.cursor/commands/git-staging.md` | idem |
| `.cursor/commands/git-prod.md` | idem |
| `.cursor/hooks.json` | idem |
| `.cursor/hooks/pre-commit/check-secrets.sh` | idem |
| `.cursor/hooks/agent/session-plan-guard.py` | idem |
| `.cursor/hooks/agent/precompact-handoff.py` | idem |
| `autogit/gitupdate.md` | `autogit/gitupdate.md` |
| `autogit/plan-routine.md` | `autogit/plan-routine.md` |

If the agent has the Agent Kit monorepo open as workspace, use those paths. If only in consumer project, fetch from the public registry URL: `https://raw.githubusercontent.com/agent-kit-startup/agent-kit/main/` + each file path. Use **Ask questions** tool for any registry source confirmation:
Options: `Fetch from public registry` / `Use different registry URL` / `Skip registry for now`

**Fallback:** if Ask questions tool unavailable, ask the same options in chat as numbered list.

### 3. Manifest `.cursor/agent-kit.json`

Create if it doesn't exist (adjust `version` / `registry` to current SoT):

```json
{
  "schemaVersion": 1,
  "version": "3.0.0",
  "profile": "default",
  "packs": [],
  "skills": [],
  "protected": [
    ".cursor/HANDOFF.md",
    ".cursor/plans/**",
    ".cursor/memory/**",
    ".cursor/context/config.json",
    ".cursor/context/current/**",
    ".cursor/context/backups/**"
  ],
  "registry": {
    "url": "https://github.com/agent-kit-startup/agent-kit",
    "ref": "main"
  }
}
```

Schema: [docs/agent-kit-manifest.md](docs/agent-kit-manifest.md).

### 4. HANDOFF (first installation)

If `.cursor/HANDOFF.md` does **not** exist, create from `HANDOFF.md.example` or `.cursor/context/templates/handoff.md`.

### 5. Git hooks (optional)

Use **Ask questions** tool to confirm git hooks installation:
Options: `Install git hooks` / `Skip hooks` / `Show hook paths only`

**Fallback:** if Ask questions tool unavailable, ask the same options in chat as numbered list.

```bash
# secrets (if project already uses custom pre-commit, integrate check-secrets.sh)
cp .cursor/hooks/pre-commit/check-secrets.sh .git/hooks/  # only if repo flow requires

# prepare-commit-msg: copy the *file* from registry, never the agent-kit/ folder
# source in kit: git-hooks/prepare-commit-msg → .git/hooks/prepare-commit-msg
```

### 6. Onboarding (first installation)

After L0 files are written (Port B or chat install), **run or offer `/onboard`**. That slash command is the SoT for first-session welcome and HITL; do not invent a parallel welcome here. Follow [`.cursor/commands/onboard.md`](.cursor/commands/onboard.md).

**Ask questions** options (must match `/onboard`):

- First install: `Create first plan` / `Skip for now` / `Learn more`
- Already onboarded or existing structure: use the already-onboarded menu in `onboard.md` (`Start a plan (/start-project)` / `Continue plan (/continue-plan)` / `Show commands overview` / `Done`), or if still mid-setup without the marker: `Show commands overview` / `Create first plan` / `Skip for now`

On `Create first plan`, bridge to `/start-project` (do not write a plan file from install alone). Port B post-install ends at `/onboard`, not a jump straight to `/start-project`.

**Fallback:** if Ask questions tool unavailable, ask the same options in chat as numbered list.

**Note:** Install via chat uses **Ask questions** for confirmations (clickable options in IDE UI). CLI wizard uses `@clack/prompts` (terminal interface); its Next block points at `/onboard` in chat.

### 7. Migrate old copy

If project still has nested `agent-kit/`: preserve L3, install via CLI/manifest, then use **Ask questions** tool before removal:
Options: `Migrate and remove nested folder` / `Keep nested folder` / `Cancel migration`

**Fallback:** if Ask questions tool unavailable, ask the same options in chat as numbered list.

Details: [docs/bootstrap.md](docs/bootstrap.md).

---

## What NOT to install by default

- Stack rules/skills (n8n, SQL, Node, PM tools) - `agent-kit add` or `--pack`
- Kit subtree `packages/`, `node_modules`, `pnpm-lock`
- Legacy CLI `cursor-handoff` as requirement - prefer `@dadado/agent-kit-cli`

## References

- [docs/bootstrap.md](docs/bootstrap.md) - bootstrap contract
- [docs/layers-spec.md](docs/layers-spec.md) - L0–L3
- [docs/getting-started.md](docs/getting-started.md) - lifecycle commands
