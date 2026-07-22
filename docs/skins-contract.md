# Workspace Skins Contract

## Overview

Workspace skins provide execution mode-specific UX chrome for Agent Kit while preserving professional output hygiene. Skins affect chat tone and CLI banners only, never commits, HANDOFF, memory, or product documentation.

## Skin Pack Schema

Each skin pack defines:

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

| Execution Mode | Surface | Default Skin |
|----------------|---------|--------------|
| Manual chat | `/continue-plan` | autopilot |
| Continuous chat | `/run-plan` | night-shift |
| Headless CLI | `agent-kit run-plan` | ghost-runner |

## Configuration

Workspace skin preferences stored in `.cursor/context/config.json`:

```json
{
  "workspaceSkin": {
    "default": "autopilot",
    "modes": {
      "continue-plan": "autopilot",
      "run-plan": "night-shift",
      "cli-run-plan": "ghost-runner"
    }
  }
}
```

Users select workspace skin during `/onboard` (or `agent-kit init` wizard) or by editing configuration directly. Community contribute path: Phase 5 (`docs/creating-skins.md` when published).

## Acceptance Rules

### Pattern Requirements

1. **Surface scope**: Chat UX chrome and CLI banners only
2. **Token efficiency**: Brief messages respecting ux-tone guidelines
3. **Fallback graceful**: Missing skin defaults to neutral tone
4. **Mode awareness**: Skin selection based on execution context

### Content Standards

1. **Professional boundary**: No impact on commits, HANDOFF, memory, product docs
2. **No secrets**: Skin packs contain no sensitive information
3. **No personal references**: Generic terms only, no people names
4. **No em dash connectors**: Use hyphens, colons, or parentheses
5. **Repository hygiene**: Skins live in registry, not workspace commits

### UX Density Requirements

- Chat hints: Max 3 sentences per message
- CLI banners: Single line prefixes
- Progress indicators: Consistent format across modes
- Error messages: Clear next steps, no blame language

## Hygiene Invariant

Skins affect presentation layer only. Technical content including:

- Commit messages and CHANGELOG entries
- HANDOFF operational instructions  
- Memory entries (errors/decisions)
- Product documentation voice
- ADR and technical decision records

Must follow existing professional standards regardless of active skin.

## Implementation Phases

1. **Phase 0**: Contract design (this document)
2. **Phase 1**: Built-in skin packs (autopilot, night-shift, ghost-runner)
3. **Phase 2**: Chat mode integration (/continue-plan, /run-plan)
4. **Phase 3**: CLI integration (agent-kit run-plan)
5. **Phase 4**: Onboard selection flow
6. **Phase 5**: Community contribution path

## Registry Location

- Built-in skins: `registry/skins/core/`
- Community skins: `registry/skins/community/`
- Schema validation: `registry/schemas/skin-pack.json`

## Validation

Skin packs validated on contribution:

1. Schema compliance (required fields, length limits)
2. Content standards (no secrets, professional tone)
3. UX density (token efficiency, clear messaging)  
4. Hygiene boundary (presentation only, no technical content)