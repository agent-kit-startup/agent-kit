# Domain packs

The base install is intentionally small — just the rules and commands every long project needs. **Packs** are optional bundles you add when your work calls for them: a security reviewer, a clean-code refactorer, testing helpers, and so on. Each pack is a set of related rules, skills, and agents that install together.

Add one anytime:

```bash
npx @agent-kit/cli add clean-code
```

Or list the packs you want when you first install:

```bash
npx @agent-kit/cli install --pack clean-code,cybersec,gestao-contexto
```

## Available packs

| Pack | What it adds | Good for |
|------|--------------|----------|
| `cybersec` | Security-review skill + a security-reviewer agent | Auditing auth, secrets, and risky changes |
| `devops` | CI/CD and infrastructure guidance | Pipelines, deploys, infra work |
| `engenharia-arquitetura` | A tech-lead agent + a docs/repo skill | Architecture decisions and keeping docs honest |
| `clean-code` | A clean-code skill + a refactoring agent | Readability and refactors |
| `gestao-projeto` | Adapters for project tools (ClickUp, Jira) | Teams that track work in a PM tool |
| `gestao-contexto` | Context-librarian and memory agents | Very long projects that lean hard on handoff |
| `quality` | A testing rule + a test-plan agent | Test coverage and QA routines |

## What packs deliberately leave out

Packs hold **discipline** knowledge that isn't tied to any particular language or service. Two things stay out of packs on purpose:

- **The core loop** (planning, handoff, the staging→production flow, clean commits) is always installed with the base kit — never bundled into a pack, even when a related agent lives in one. For example, the `gestao-projeto` pack adds PM-tool adapters, but the plan and handoff commands are part of the base install.
- **Language- and service-specific tools** (n8n, SQL, Node, PHP, JSON helpers, and similar) are installed individually as skills, not as pack members. Add them on demand:

```bash
npx @agent-kit/cli add sql-postgres
npx @agent-kit/cli add n8n-workflows
```

## How your project records packs

Installed packs are listed in your project's manifest, `.cursor/agent-kit.json`:

```json
"packs": ["clean-code", "cybersec", "gestao-contexto"]
```

An empty list means you're running the base kit only, plus any individual skills you added.

## Related

- [Layers](layers-spec.md) — how the base install, packs, and your own files fit together
- [Manifest](agent-kit-manifest.md) — the `.cursor/agent-kit.json` file
- [Creating skills](creating-skills.md) — build your own
