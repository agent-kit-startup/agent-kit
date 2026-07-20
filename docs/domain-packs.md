# Domain packs

The base install is intentionally small - just the rules and commands every long project needs. **Packs** are optional bundles you add when your work calls for them: a security reviewer, a clean-code refactorer, testing helpers, and so on. Each pack is a set of related rules, skills, agents, and templates that install together.

Add one anytime:

```bash
npx @dadado/agent-kit-cli add clean-code
```

Or list the packs you want when you first install:

```bash
npx @dadado/agent-kit-cli install --pack clean-code,cybersec,context-management
```

## Available packs

| Pack | Members (approx.) | What it adds | Good for |
|------|-------------------|--------------|----------|
| `cybersec` | 3 | Security-review skill, security-reviewer agent, and `git-secrets-safety` (pack double-check; also L0 always-on) | Auditing auth, secrets, and risky changes |
| `devops` | 5 | DevOps rule plus CODEOWNERS and GitLab CI scaffolding templates | Pipelines, deploys, infra work |
| `engineering-architecture` | 5 | tech-lead agent, docs-repo skill and agent, ADR and task-brief templates | Architecture decisions and keeping docs honest |
| `clean-code` | 2 | A clean-code skill + a refactoring agent | Readability and refactors |
| `project-management` | 4 | Adapters for project tools (ClickUp, Jira) | Teams that track work in a PM tool |
| `context-management` | 4 | Context-librarian and memory agents, context-status, context-pack template | Very long projects that lean hard on handoff |
| `quality` | 2 | A testing rule + a test-plan agent | Test coverage and QA routines |

## Secrets rule dual placement

`git-secrets-safety` ships in **L0** (always installed) and again as a **cybersec** pack member. Core keeps the invariant on every install; the cybersec pack reaffirms it when teams add a security discipline bundle. The structural pre-commit hook (`check-secrets.sh`) stays L0-only and is listed in cybersec `excludes`.

## What packs deliberately leave out

Packs hold **discipline** knowledge that isn't tied to any particular language or service. Two things stay out of packs on purpose:

- **The core loop** (planning, handoff, the staging→production flow, clean commits) is always installed with the base kit - never bundled into a pack, even when a related agent lives in one. For example, the `project-management` pack adds PM-tool adapters, but the plan and handoff commands are part of the base install. The `devops` pack therefore **excludes** `git-autogit`, the L0 git slash commands, and `git-secrets-safety` (that rule is L0 + cybersec, not devops).
- **Language- and service-specific tools** (n8n, SQL, Node, PHP, JSON helpers, and similar) are installed individually as skills, not as pack members. Add them on demand:

```bash
npx @dadado/agent-kit-cli add sql-postgres
npx @dadado/agent-kit-cli add n8n-workflows
```

## Agents that are not pack-installable (dogfood / demoted)

Every file under `.cursor/agents/` must be either a **pack/registry member** or explicitly **dogfood-only** (present in the kit repo for Task isolation; not copied to consumers by `add` / pack install). Prefer the matching L2 skill in the main window unless multi-file isolation is needed.

| Agent file | Install path | Notes |
|------------|--------------|-------|
| `cleancode-refactor` | L1 `clean-code` | Pair with `clean-code` skill |
| `security-reviewer` | L1 `cybersec` | Pair with security-review skill |
| `tech-lead` | L1 `engineering-architecture` | Architecture / ADR |
| `docs-repo` (agent) | L1 `engineering-architecture` | Pair with `docs-repo` skill; skill for short edits, agent for multi-file doc passes |
| `context-librarian`, `memory-extractor` | L1 `context-management` | Beyond L0 guardian / memory-loop |
| `clickup-tasks` | L1 `project-management` | Optional PM adapter |
| `test-suites` | L1 `quality` | QA routines |
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
