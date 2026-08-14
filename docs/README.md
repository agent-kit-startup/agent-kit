# Mission Kit Docs

**Mission Kit** is the product-family name on [missionkit.io](https://missionkit.io). **Agent Kit** is the technical install surface (CLI, npm, slash commands, `.cursor/agent-kit.json`). The kit is a HITL framework for AI-assisted IDEs: plan, handoff, staging-to-prod git flow, and memory across long projects. Install generates Cursor-first project setup; VS Code and Windsurf get partial generators (parity Low / Minimal per [cursor-native-audit.md](cursor-native-audit.md)). Mechanizable invariants live in the CLI so non-Cursor paths can run the same checks.

## Guides

- [Getting Started](getting-started.md) - install, commands, workflow
- [Bootstrap](bootstrap.md) - install without nested `agent-kit/` folder
- [Repository readiness onboarding](repository-readiness-onboarding.md) - install discovery, guided preparation, and handoff to `/start-project`
- [Migrate consumer](migrate-consumer.md) - generic runbook to leave nested `agent-kit/` (`YOUR_PROJECT`)
- [Contribute upstream](contribute-upstream.md) - `agent-kit contribute` return channel + gate
- [Public launch](public-launch.md) - go/no-go + append-only sync
- [Public launch announcement](public-launch-announcement.md) - copy-paste launch text (chat / social)
- [Adoption comms](comms.md) - channel map, recap/release cadence, HITL draft pipeline (does not auto-post)
- [Mission Kit Landing](agentkit-landing.md) - public marketing page at [missionkit.io](https://missionkit.io) (filename kept for link stability; previous `agent.startupkit.com.br` is deprecated and 301-redirects)
- [Topology private × public](topology-private-public.md) - Fase 7 registry-canonical public
- [Marketplace catalog](marketplace.md) - versioning, CLI add, Cursor plugin, quality gate
- [Review layers](review-camadas.md) - final HITL / go-no-go pass
- [Creating Skills](creating-skills.md) - skill format, placement, registry
- [Creating Agent Personas](creating-personas.md) - persona pack format, placement, contribute checklist
- [Agent Personas contract](personas-contract.md) - persona pack schema, mode defaults, acceptance rules (also summarized in the root [README Features](../README.md#features))
- [External plan review](external-plan-review.md) - opt-in Claude Code monitor after plan exhaustion
- [Claude CLI kit-load](claude-cli-kit-load.md) - thin `CLAUDE.md` plus `/agent-kit` session bootstrap (not audits, not A7)
- [Consumer configuration](consumer-configuration.md) - every consumer knob (session config, skin, install choices, CLI flags/env) with copy snippets
- Config tab write verification - durable allowlist PATCH matrix for Mission Control Config (private factory evidence under `docs/evidence/`; not public-synced)
- [Cursor 3.0 Features](cursor-3-features.md) - how Mission Kit uses native IDE features
- [Cursor-native audit](cursor-native-audit.md) - hooks.json, plugin, rule modes, VS Code/Windsurf gaps
- [Coherence inventory](coherence-inventory.md) - classification of rules, skills, hooks, agents, commands
- [Drift inventory](drift-inventory.md) - per-workspace kit copies, L0 candidates, L3 uniques
- [Layers specification](layers-spec.md) - L0–L3 model, precedence, nomenclature
- [Five-layer claim matrix](five-layer-claim-matrix.md) - public five-layer positioning (core / optional / planned / unsupported)
- [Domain packs (L1)](domain-packs.md) - seven discipline packs and membership
- [Agent Kit manifest](agent-kit-manifest.md) - `.cursor/agent-kit.json` schema (version, packs, protected L3)
- [Repository Boundaries](repository-boundaries.md) - three-layer cheat sheet (local / private / public), npm, sync
- [Contributing](CONTRIBUTING.md) - setup, standards, registry contributions
- [Development](DEVELOPMENT.md) - factory topology, local CLI, maintainer workflows (root README stays consumer storefront)
- [GitHub About](github-about.md) - description and topics for the GitHub repo

## Community

- [Adoption comms](comms.md) - spread-the-word drafts with HITL; contributor funnel stays CONTRIBUTING
- [Code of Conduct](../.github/CODE_OF_CONDUCT.md) - Contributor Covenant 2.1 and how to report a concern
- [Security policy](../.github/SECURITY.md) - private disclosure channel, supported versions, documented posture (never open a public issue for a vulnerability)
- [Support](../.github/SUPPORT.md) - where to ask what, and what makes a question answerable
