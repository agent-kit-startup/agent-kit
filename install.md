# Agent Kit - Installation

> **You are the installer.** Set up the kit **in the user's project** without copying the entire Agent Kit monorepo into it.

## Contract (mandatory)

1. **Forbidden:** create or maintain an `agent-kit/` folder with the entire repo (CLI, `packages/`, `node_modules`, etc.) inside the consumer project.
2. **Mandatory:** minimal bootstrap layout - see [docs/bootstrap.md](docs/bootstrap.md).
3. **Result:** `.cursor/` with L0 + `.cursor/agent-kit.json` + `autogit/` at project root.

## Preference: CLI

If Node.js is available, in the **consumer project root**:

```bash
npx @agent-kit/cli install
# optional L1 packs:
npx @agent-kit/cli install --pack clean-code,context-management
```

With local checkout of Agent Kit monorepo:

```bash
pnpm --filter @agent-kit/cli start install --cwd /path/to/project
```

After: `agent-kit status` (or equivalent via `pnpm --filter @agent-kit/cli start status --cwd …`).

If CLI runs successfully, skip to **Onboarding** below.

## Port B: install via chat (no CLI)

When the user drags this file or uses `@install.md` and CLI is not available:

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
| `.cursor/commands/start-project.md` | idem |
| `.cursor/commands/continue-plan.md` | idem |
| `.cursor/commands/run-plan-loop.md` | idem |
| `.cursor/commands/run-plan-orchestrated.md` | idem |
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

If the agent has the Agent Kit monorepo open as workspace, use those paths. If only in consumer project, ask user for registry URL/ref or use `npx @agent-kit/cli install`.

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
    ".cursor/context/**"
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

```bash
# secrets (if project already uses custom pre-commit, integrate check-secrets.sh)
cp .cursor/hooks/pre-commit/check-secrets.sh .git/hooks/  # only if repo flow requires

# prepare-commit-msg: copy the *file* from registry, never the agent-kit/ folder
# source in kit: git-hooks/prepare-commit-msg → .git/hooks/prepare-commit-msg
```

### 6. Onboarding (first installation)

If HANDOFF didn't exist before:

1. Short welcome to Agent Kit (handoff + plans).
2. Commands: `/start-project`, `/handoff`, `/continue-plan`, `/git-staging`, `/git-prod`.
   Manual mode = one phase per chat; multi-phase in same window only with `/run-plan-loop` or `/run-plan-orchestrated`.
3. Ask if they want to create the first plan.

If structure already existed: confirm and list the same commands.

### 7. Migrate old copy

If project still has nested `agent-kit/`: preserve L3, install via CLI/manifest, then **delete** the nested folder. Details: [docs/bootstrap.md](docs/bootstrap.md).

---

## What NOT to install by default

- Stack rules/skills (n8n, SQL, Node, PM tools) - `agent-kit add` or `--pack`
- Kit subtree `packages/`, `node_modules`, `pnpm-lock`
- Legacy CLI `cursor-handoff` as requirement - prefer `@agent-kit/cli`

## References

- [docs/bootstrap.md](docs/bootstrap.md) - bootstrap contract
- [docs/layers-spec.md](docs/layers-spec.md) - L0–L3
- [docs/getting-started.md](docs/getting-started.md) - lifecycle commands
