import { MANIFEST_RELATIVE_PATH } from "../manifest/types.js";

/**
 * Pre-rename L1 pack ids and the English id each became (ADR
 * `2026-07-19_l1-pack-ids-english`). The single source for every pack lookup
 * and for the `update` manifest rewrite. An exact registry match always wins,
 * so a registry pinned to a ref that still ships the old id keeps working.
 */
export const LEGACY_PACK_ID_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "gestao-projeto": "project-management",
  "gestao-contexto": "context-management",
  "engenharia-arquitetura": "engineering-architecture",
});

/** The current id a legacy pack id was renamed to, or undefined. */
export function legacyPackIdTarget(id: string): string | undefined {
  return Object.hasOwn(LEGACY_PACK_ID_ALIASES, id) ? LEGACY_PACK_ID_ALIASES[id] : undefined;
}

export interface PackIdRewrite {
  from: string;
  to: string;
}

/** One line per manifest rewrite, printed by `update` and `install`. */
export function formatPackIdRewrite(rewrite: PackIdRewrite): string {
  return `Pack id '${rewrite.from}' renamed to '${rewrite.to}' in ${MANIFEST_RELATIVE_PATH} (legacy L1 pack id).`;
}

/** Named warning for a pack id the registry does not ship, with the next step. */
export function formatUnknownPack(packId: string, knownIds: readonly string[]): string {
  const known = knownIds.length > 0 ? knownIds.join(", ") : "none";
  return `Unknown pack '${packId}': not found in registry (known packs: ${known}). Next: replace or remove '${packId}' in "packs" of ${MANIFEST_RELATIVE_PATH} (or in --pack), then re-run.`;
}

export class UnknownPackError extends Error {
  readonly packId: string;
  readonly knownIds: readonly string[];

  constructor(packId: string, knownIds: readonly string[]) {
    super(formatUnknownPack(packId, knownIds));
    this.name = "UnknownPackError";
    this.packId = packId;
    this.knownIds = knownIds;
  }
}
