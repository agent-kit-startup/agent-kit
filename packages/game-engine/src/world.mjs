/**
 * The map: axial hex grid in spiral order from the hub on tile 0. No DOM, fs or fetch.
 *
 * Terrain is an input, one letter per tile, because its source belongs to the host (a page can
 * read it from a painting, another host can derive it from a seed).
 * Letters: v trees or scrub, g open ground, e edge of the green, s slate, rock or water.
 */
export const MAP_RADIUS = 4;

/** @returns {{q: number, r: number}[]} */
export function hexTiles(radius = MAP_RADIUS) {
  const tiles = [{ q: 0, r: 0 }];
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  for (let k = 1; k <= radius; k += 1) {
    let q = -k;
    let r = k;
    for (const [dq, dr] of dirs) {
      for (let step = 0; step < k; step += 1) {
        tiles.push({ q, r });
        q += dq;
        r += dr;
      }
    }
  }
  return tiles;
}

export const TILES = Object.freeze(hexTiles());
const TILE_INDEX = new Map(TILES.map((tile, index) => [`${tile.q},${tile.r}`, index]));

/** Distance from the hub, in rings. */
export function ring(index) {
  const { q, r } = TILES[index];
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

/** The tile a two-hex structure also covers, or -1 past the edge of the map. */
export function partner(index) {
  const tile = TILES[index];
  return tile ? (TILE_INDEX.get(`${tile.q + 1},${tile.r}`) ?? -1) : -1;
}

/** Whether a structure's catalog terrain can stand on a tile of this terrain letter. */
export function fitsTerrain(letter, structureTerrain) {
  if (letter === "v") return false;
  if (structureTerrain === "tundra") return letter === "e" || letter === "s";
  if (structureTerrain === "plain") return letter === "g" || letter === "e";
  return false;
}
