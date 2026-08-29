export const TILE = 32;

export const enum Tile {
  Empty = 0,
  Ground = 1,
  Brick = 2,
  Sand = 3,
  /** Crates are tiles: they are grid-aligned, static, and already collide. */
  CratePlain = 4,
  CrateTnt = 5,
  CrateNitro = 6,
  CrateBounce = 7,
  CrateCheck = 8,
}

/** Everything a verb can act on, and the only tiles the crate counter sees. */
export function isCrate(tile: Tile): boolean {
  return tile >= Tile.CratePlain && tile <= Tile.CrateCheck;
}

/** Nitro is the exception: it is never broken by a verb, only by a blast. */
export function breakableByVerb(tile: Tile): boolean {
  return isCrate(tile) && tile !== Tile.CrateNitro;
}

export type SpawnKind =
  | "player"
  | "dog"
  | "retriever"
  | "hedgehog"
  | "wasp"
  | "flower"
  | "goal"
  | "cactus"
  | "monstera"
  | "boss";

export type Season = "spring" | "summer" | "autumn" | "winter" | "sakura";

/** A season owns every column from `fromTile` up to the next band's start. */
export type SeasonBand = {
  readonly season: Season;
  readonly fromTile: number;
};

/** Where the beach gives way to open water, in tiles. */
export type WaterBounds = {
  readonly fromTile: number;
  readonly row: number;
};

/** Interior columns of the climbing shaft, inclusive. */
export type ChimneyBounds = {
  readonly fromTile: number;
  readonly toTile: number;
};

export type LevelSource = {
  readonly rows: readonly string[];
  readonly seasons?: readonly SeasonBand[];
  readonly chimney?: ChimneyBounds;
  readonly water?: WaterBounds;
};

export type Spawn = {
  readonly kind: SpawnKind;
  readonly x: number;
  readonly y: number;
};

export type Level = {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
  readonly spawns: readonly Spawn[];
  readonly seasons: readonly SeasonBand[];
  readonly chimney: ChimneyBounds | null;
  readonly water: WaterBounds | null;
};

const TILE_CHARS: Readonly<Record<string, Tile>> = {
  "#": Tile.Ground,
  b: Tile.Brick,
  "=": Tile.Sand,
  c: Tile.CratePlain,
  t: Tile.CrateTnt,
  n: Tile.CrateNitro,
  "^": Tile.CrateBounce,
  p: Tile.CrateCheck,
};

const SPAWN_CHARS: Readonly<Record<string, SpawnKind>> = {
  C: "player",
  d: "dog",
  D: "retriever",
  h: "hedgehog",
  w: "wasp",
  f: "flower",
  G: "goal",
  x: "cactus",
  M: "monstera",
  B: "boss",
};

/**
 * Rows are padded to the longest row so a level file can have ragged
 * trailing whitespace without shifting the grid.
 */
const ONE_SEASON: readonly SeasonBand[] = [{ season: "summer", fromTile: 0 }];

export function parseLevel({ rows, seasons, chimney, water }: LevelSource): Level {
  const height = rows.length;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const tiles = new Uint8Array(width * height);
  const spawns: Spawn[] = [];

  for (let ty = 0; ty < height; ty++) {
    const row = rows[ty] ?? "";
    for (let tx = 0; tx < width; tx++) {
      const ch = row[tx] ?? " ";
      const tile = TILE_CHARS[ch];
      if (tile !== undefined) {
        tiles[ty * width + tx] = tile;
        continue;
      }
      const kind = SPAWN_CHARS[ch];
      if (kind !== undefined) {
        spawns.push({ kind, x: tx * TILE, y: ty * TILE });
      }
    }
  }

  return { width, height, tiles, spawns, seasons: seasons ?? ONE_SEASON, chimney: chimney ?? null, water: water ?? null };
}

/** Bands are ordered, so the last one starting at or before `x` wins. */
export function seasonAt(level: Level, x: number): Season {
  const tile = Math.floor(x / TILE);
  let current: Season = level.seasons[0]?.season ?? "summer";
  for (const band of level.seasons) {
    if (band.fromTile > tile) break;
    current = band.season;
  }
  return current;
}

/** Out of bounds is solid at the sides, open above and below. */
export function tileAt(level: Level, tx: number, ty: number): Tile {
  if (tx < 0 || tx >= level.width) return Tile.Ground;
  if (ty < 0 || ty >= level.height) return Tile.Empty;
  return (level.tiles[ty * level.width + tx] ?? Tile.Empty) as Tile;
}

export function isSolid(tile: Tile): boolean {
  return tile !== Tile.Empty;
}

export function solidAt(level: Level, tx: number, ty: number): boolean {
  return isSolid(tileAt(level, tx, ty));
}

export function pixelWidth(level: Level): number {
  return level.width * TILE;
}

export function pixelHeight(level: Level): number {
  return level.height * TILE;
}
