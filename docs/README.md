# Mission Kit Docs

**Mission Kit** is the product-family name on [missionkit.io](https://missionkit.io). **Agent Kit** is the technical install surface (CLI, npm, slash commands, `.cursor/agent-kit.json`). The kit is a HITL framework for AI-assisted IDEs: plan, handoff, staging-to-prod git flow, and memory across long projects.

## Usage first

- [Getting Started](getting-started.md) - install, commands, workflow
- [CONTRIBUTING](CONTRIBUTING.md) - setup, standards, registry contributions
- [Contribute upstream](contribute-upstream.md) - `agent-kit contribute` return channel + gate

## Repository setup

- [Bootstrap](bootstrap.md) - install without nested `agent-kit/` folder
- [Repository readiness onboarding](repository-readiness-onboarding.md) - install discovery, guided preparation, and handoff to `/start-project`
- [Migrate consumer](migrate-consumer.md) - generic runbook to leave nested `agent-kit/` (`YOUR_PROJECT`)
- [Ubuntu 24.04 bare-metal install](install-ubuntu24-bare-metal.md) - fresh server with no Node.js, non-interactive provisioning in front of the same CLI path

## Configuration and features

- [Consumer configuration](consumer-configuration.md) - every consumer knob (session config, skin, install choices, CLI flags/env) with copy snippets
- [Domain packs (L1)](domain-packs.md) - seven discipline packs and membership
- [Agent Personas contract](personas-contract.md) - persona pack schema, mode defaults, acceptance rules
- [External plan review](external-plan-review.md) - opt-in Claude Code monitor after plan exhaustion
- [Claude CLI kit-load](claude-cli-kit-load.md) - thin `CLAUDE.md` plus `/agent-kit` session bootstrap (not audits, not A7)

## Reference

- [Agent Kit manifest](agent-kit-manifest.md) - `.cursor/agent-kit.json` schema (version, packs, protected L3)
- [Layers specification](layers-spec.md) - L0–L3 model, precedence, nomenclature
- [Repository Boundaries](repository-boundaries.md) - three-layer cheat sheet (local / private / public), npm, sync
- [Cursor Native Features](cursor-3-features.md) - how Mission Kit uses native IDE features
- [Cursor-native audit](cursor-native-audit.md) - hooks.json, plugin, rule modes, VS Code/Windsurf gaps

## Development

- [Development](DEVELOPMENT.md) - factory topology, local CLI, maintainer workflows (root README stays consumer storefront)
- [Creating Skills](creating-skills.md) - skill format, placement, registry
- [Creating Agent Personas](creating-personas.md) - persona pack format, placement, contribute checklist
- [Marketplace catalog](marketplace.md) - versioning, CLI add, Cursor plugin, quality gate

## Community

- [Code of Conduct](../.github/CODE_OF_CONDUCT.md) - Contributor Covenant 2.1 and how to report a concern
- [Security policy](../.github/SECURITY.md) - private disclosure channel, supported versions, documented posture (never open a public issue for a vulnerability)
- [Support](../.github/SUPPORT.md) - where to ask what, and what makes a question answerable
