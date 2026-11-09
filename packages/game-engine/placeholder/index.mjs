/**
 * Placeholder catalog: generic rows in the catalog shape, so the engine runs and tests without the
 * game's content. A public or third-party build plays with this; the game's own story, catalog and
 * art reach players only inside Colony builds.
 */
import structures from "./structures.json" with { type: "json" };
import threats from "./threats.json" with { type: "json" };

/** Placeholder structures that stand on two hexes. */
export const twoHex = Object.freeze(["hub", "sprout", "relay", "block"]);

export const placeholderCatalog = Object.freeze({ structures, threats, twoHex });
export { structures, threats };
