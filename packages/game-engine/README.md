# Oligarchy rules engine

The rules of Oligarchy, the colony game in Colony IDE, as pure functions over an outcome ledger. The engine holds no game content: the host passes the catalog in. The game's own story, catalog and art are not in this package; players get them inside Colony builds.

Apache-2.0 (`LICENSE`). Not published to npm yet.

## Use

```js
import { createRules, ledgerFromEntries, settle } from "@dadado/oligarchy-engine";
import { placeholderCatalog } from "@dadado/oligarchy-engine/placeholder";

const rules = createRules(placeholderCatalog);
let state = rules.newGame();
state = rules.foldLedger(state, ledgerFromEntries(entries));
state = settle(state, Date.now());
```

`createRules({ structures, threats, twoHex })` checks the catalog with `validateRulesCatalog` and throws a `TypeError` listing every problem. It returns the bound functions: `newGame`, `parseState`, `foldLedger`, `canPlace`, `buildBlocker`, `queueBuild`, `queueRepair`, `pickCountermeasure`, `countermeasures`, `countermeasureCost`, `greenTiles`, `revealedRing`, `unlockedTier`, `spanOf`, `footprint`, plus `structures`, `threats` and `hub`.

Functions that read no catalog are plain exports: `ledgerFromEntries`, `ledgerFromSnapshot`, `wallet`, `settle`, `overclockActive`, `buildEndsAt`, `roll`, `turnsLeft`, `OUTCOME_RESOURCE`, `TUNING`, and the map in `hexTiles`, `TILES`, `ring`, `partner`, `fitsTerrain`.

## The catalog

- **`structures`**: `id`, `name`, `glyph`, `blurb`, `cost` (`logic`, `compute`, `rare`), `build_minutes`, `greens`, `unique`, `terrain` (`centre`, `plain` or `tundra`), `countermeasure_for` (a threat id or `null`), `aliases`, `art` or `placeholder`, `status`. Exactly one structure has terrain `centre`: it is the hub, standing free on hex 0 of a new colony, and it never goes offline.
- **`threats`**: `id`, `name`, `tier` (1 to 3), `family`, `vector`, `countermeasure`, `capture` (`name`, `effect`), `art` or `placeholder`, `status`. Every tier needs at least one threat.
- **`twoHex`**: the ids of the structures that stand on two hexes.

`placeholder/` holds a generic catalog in this shape. Tests run on it, and a build without the game's content can play with it.

## Rules

Pure functions with no DOM, network, filesystem, timer or clock of their own. The host holds the state and passes `now`.

- **Events come from the outcome ledger and nothing else.** One event is one turn and one unit of one resource (`OUTCOME_RESOURCE`). A test pins that table to the Mission Kit outcome ledger in `dashboard/lib/outcome-ledger.mjs`.
- **Lazy.** A build ends at `startedAt` plus its duration, evaluated when the host asks. An attack moves only when a new ledger event arrives, so time alone does nothing.
- **Nothing attacks while the player is away.** Only the first event of a `foldLedger` call can land an attack. The rest count it down to one turn left, so an attack the player has not seen never lands unseen. Call `foldLedger` while the game is on screen.
- **Same key, same dice.** `roll` hashes the event key, so the same ledger gives the same attacks on every machine that reads it at the same points.
- **Numbers are tuning.** `TUNING` holds every chance, cost and threshold the catalog does not.
- **Not built yet:** the effects of a capture (a capture is recorded and does nothing yet), immunities, an economy limit on defense spend and enemy movement along the map.
