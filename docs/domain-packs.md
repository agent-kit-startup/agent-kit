# Domain packs

The base install is intentionally small - just the rules and commands every long project needs. **Packs** are optional bundles you add when your work calls for them: a security reviewer, a clean-code refactorer, testing helpers, and so on. Each pack is a set of related rules, skills, and agents that install together.

Add one anytime:

```bash
npx @agent-kit/cli add clean-code
```

Or list the packs you want when you first install:

```bash
npx @agent-kit/cli install --pack clean-code,cybersec,context-management
```

## Available packs

| Pack | What it adds | Good for |
|------|--------------|----------|
| `cybersec` | Security-review skill + a security-reviewer agent | Auditing auth, secrets, and risky changes |
| `devops` | CI/CD and infrastructure guidance | Pipelines, deploys, infra work |
| `engenharia-arquitetura` | tech-lead agent + docs-repo skill and agent (same pattern as clean-code) | Architecture decisions and keeping docs honest |
| `clean-code` | A clean-code skill + a refactoring agent | Readability and refactors |
| `project-management` | Adapters for project tools (ClickUp, Jira) | Teams that track work in a PM tool |
| `context-management` | Context-librarian and memory agents (beyond L0 guardian + native hooks) | Very long projects that lean hard on handoff |
| `quality` | A testing rule + a test-plan agent | Test coverage and QA routines |

## What packs deliberately leave out

Packs hold **discipline** knowledge that isn't tied to any particular language or service. Two things stay out of packs on purpose:

- **The core loop** (planning, handoff, the staging→production flow, clean commits) is always installed with the base kit - never bundled into a pack, even when a related agent lives in one. For example, the `project-management` pack adds PM-tool adapters, but the plan and handoff commands are part of the base install. The `devops` pack therefore **excludes** `git-autogit` and the L0 git slash commands; consumers get `/git-staging` and `/git-prod` from L0, not a second git agent via the pack.
- **Language- and service-specific tools** (n8n, SQL, Node, PHP, JSON helpers, and similar) are installed individually as skills, not as pack members. Add them on demand:

```bash
npx @agent-kit/cli add sql-postgres
npx @agent-kit/cli add n8n-workflows
```

## Agents that are not pack-installable (dogfood / demoted)

Every file under `.cursor/agents/` must be either a **pack/registry member** or explicitly **dogfood-only** (present in the kit repo for Task isolation; not copied to consumers by `add` / pack install). Prefer the matching L2 skill in the main window unless multi-file isolation is needed.

| Agent file | Install path | Notes |
|------------|--------------|-------|
| `cleancode-refactor` | L1 `clean-code` | Pair with `clean-code` skill |
| `security-reviewer` | L1 `cybersec` | Pair with security-review skill |
| `tech-lead` | L1 `engenharia-arquitetura` | Architecture / ADR |
| `docs-repo` (agent) | L1 `engenharia-arquitetura` | Pair with `docs-repo` skill; skill for short edits, agent for multi-file doc passes |
| `context-librarian`, `memory-extractor` | L1 `gestao-contexto` | Beyond L0 guardian / memory-loop |
| `clickup-tasks` | L1 `gestao-projeto` | Optional PM adapter |
| `testes-roteiros` | L1 `quality` | QA routines |
| `git-autogit` | **Dogfood-only** | L0 already ships git commands + `autogit/`; agent stays in the kit for optional Task isolation, never a pack member |
| `json-guardian`, `prompts-agents`, `n8n-workflows`, `sql-schema` | **Demoted (skill-first)** | Matching community skills are the install path; agent files remain dogfood-only for rare Task isolation |

## How your project records packs

Installed packs are listed in your project's manifest, `.cursor/agent-kit.json`:

```json
"packs": ["clean-code", "cybersec", "context-management"]
```

An empty list means you're running the base kit only, plus any individual skills you added.

## Related

- [Layers](layers-spec.md) - how the base install, packs, and your own files fit together
- [Manifest](agent-kit-manifest.md) - the `.cursor/agent-kit.json` file
- [Creating skills](creating-skills.md) - build your own
