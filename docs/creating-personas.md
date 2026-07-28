# Creating Agent Personas

Agent Personas provide execution mode-specific UX chrome for Agent Kit while preserving professional output. They affect chat tone and CLI banners only, never commits, HANDOFF, memory, or product documentation.

Do not confuse Agent Personas with Mission Control **Interface Skins** (`legacy` / `cursor`).

## Persona Pack Format

Each persona pack provides a JSON configuration with:

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

See [personas-contract.md](personas-contract.md) for detailed schema constraints and acceptance rules.

## Where to place

- **Core personas:** `registry/personas/core/` (first-party, built-in)
- **Community personas:** `registry/personas/community/` (community contributions)

Each persona pack lives in its own folder: `registry/personas/{category}/{persona-id}/persona.json`

## Acceptance rules

Persona packs must comply with these requirements:

1. **Surface scope**: Chat UX chrome and CLI banners only
2. **Token efficiency**: Brief messages respecting ux-tone guidelines
3. **Professional boundary**: No impact on commits, HANDOFF, memory, product docs
4. **Schema compliance**: Valid against `registry/schemas/persona-pack.json`
5. **Content standards**: No secrets, personal references, or em dash connectors

Full acceptance criteria detailed in [personas-contract.md](personas-contract.md).

## Registry discovery

Personas are installed via workspace configuration in `.cursor/context/config.json`. Users select Agent Persona preferences after repository readiness or by editing configuration directly.

Unlike skills and packs, personas do not require `registry.json` entries. They are discovered by directory structure under `registry/personas/`.

## Contribute checklist

When submitting a community persona pack:

- [ ] Valid JSON against `registry/schemas/persona-pack.json`
- [ ] No secrets or agent metalanguage
- [ ] Professional tone (no personal references, em dash connectors)
- [ ] UX density limits respected (chat hints ≤50 chars, CLI banners ≤40 chars)
- [ ] Intent clearly describes when to use this persona
- [ ] Display name under 30 characters
- [ ] Persona ID follows kebab-case pattern (3-20 characters)
- [ ] Chat hints enhance UX without breaking token efficiency
- [ ] CLI banners provide optional theming without breaking core functionality
- [ ] Hygiene boundary maintained (presentation layer only)
- [ ] No impact on technical content (commits, memory, docs)

Submit via PR to the `registry/personas/community/` directory. Maintainers review for compliance with acceptance rules and may suggest adjustments before merge.
