# Agent Personas Contract

## Overview

Agent Personas provide execution mode-specific UX chrome for Agent Kit while preserving professional output hygiene. Personas affect chat tone and CLI banners only, never commits, HANDOFF, memory, or product documentation.

**Interface Skin** is a separate concept: Mission Control visual styling (`legacy` / `cursor`) via `data-dashboard-skin`. Personas never set Interface Skin values.

## Persona Pack Schema

Each persona pack defines:

```json
{
  "id": "string",
  "displayName": "string",
  "intent": "string",
  "chatHints": {
    "tone": "string",
    "confirmation": "string",
    "progress": "string"
  },
  "cliBanners": {
    "tickStart": "string",
    "tickEnd": "string",
    "phaseComplete": "string"
  },
  "ansiPalette": {
    "primary": "string",
    "secondary": "string",
    "accent": "string"
  }
}
```

### Field Constraints

- **id**: kebab-case identifier, 3-20 characters
- **displayName**: user-friendly name, max 30 characters
- **intent**: purpose description, max 100 characters
- **chatHints**: optional UX guidance strings, max 50 characters each
- **cliBanners**: optional CLI output prefixes, max 40 characters each
- **ansiPalette**: optional ANSI color codes for terminal theming

## Mode Defaults (Locked)

| Execution Mode | Surface | Default Persona |
|----------------|---------|-----------------|
| Manual chat | `/continue-plan` | autopilot |
| Continuous chat | `/run-plan` | night-shift |
| Headless CLI | `agent-kit run-plan` | ghost-runner |
| Multi-plan queue chat | `/run-plan-all` | night-shift |

## Configuration

Agent Persona preferences stored in `.cursor/context/config.json`:

```json
{
  "agentPersona": {
    "default": "autopilot",
    "modes": {
      "continue-plan": "autopilot",
      "run-plan": "night-shift",
      "cli-run-plan": "ghost-runner"
    }
  }
}
```

### Compatibility

Readers prefer `agentPersona`. If it is absent, they map the legacy `workspaceSkin` key (same shape). When both exist, `agentPersona` wins. Writers emit `agentPersona` only.

Users configure Agent Personas after repository readiness (personalization step) or by editing configuration directly. Community contribute path: [creating-personas.md](creating-personas.md).

## Acceptance Rules

### Pattern Requirements

1. **Surface scope**: Chat UX chrome and CLI banners only
2. **Token efficiency**: Brief messages respecting ux-tone guidelines
3. **Fallback graceful**: Missing persona defaults to neutral tone
4. **Mode awareness**: Persona selection based on execution context

### Content Standards

1. **Professional boundary**: No impact on commits, HANDOFF, memory, product docs
2. **No secrets**: Persona packs contain no sensitive information
3. **No personal references**: Generic terms only, no people names
4. **No em dash connectors**: Use hyphens, colons, or parentheses
5. **Repository hygiene**: Personas live in registry, not workspace commits

### UX Density Requirements

- Chat hints: Max 3 sentences per message
- CLI banners: Single line prefixes
- Progress indicators: Consistent format across modes
- Error messages: Clear next steps, no blame language

## Hygiene Invariant

Personas affect presentation layer only. Technical content including:

- Commit messages and CHANGELOG entries
- HANDOFF operational instructions
- Memory entries (errors/decisions)
- Product documentation voice
- ADR and technical decision records

Must follow existing professional standards regardless of active persona.

## Registry Location

- Built-in personas: `registry/personas/core/`
- Community personas: `registry/personas/community/`
- Schema validation: `registry/schemas/persona-pack.json`

## Validation

Persona packs validated on contribution:

1. Schema compliance (required fields, length limits)
2. Content standards (no secrets, professional tone)
3. UX density (token efficiency, clear messaging)
4. Hygiene boundary (presentation only, no technical content)
