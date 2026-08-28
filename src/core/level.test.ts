import { describe, expect, it } from "vitest";
import { TILE, Tile, parseLevel, seasonAt, solidAt, tileAt } from "./level";

describe("parseLevel", () => {
  it("maps characters to tiles and pads ragged rows", () => {
    const level = parseLevel({ rows: ["  b", "###", "#"] });

    expect(level.width).toBe(3);
    expect(level.height).toBe(3);
    expect(tileAt(level, 2, 0)).toBe(Tile.Brick);
    expect(tileAt(level, 0, 1)).toBe(Tile.Ground);
    expect(tileAt(level, 1, 2)).toBe(Tile.Empty);
  });

  it("collects spawns in pixel coordinates and leaves their tiles empty", () => {
    const level = parseLevel({ rows: [" C f", "####"] });

    expect(level.spawns).toEqual([
      { kind: "player", x: TILE, y: 0 },
      { kind: "flower", x: 3 * TILE, y: 0 },
    ]);
    expect(tileAt(level, 1, 0)).toBe(Tile.Empty);
  });
});

describe("seasonAt", () => {
  const level = parseLevel({
    rows: ["####"],
    seasons: [
      { season: "spring", fromTile: 0 },
      { season: "winter", fromTile: 2 },
    ],
  });

  it("returns the band that owns the column", () => {
    expect(seasonAt(level, 0)).toBe("spring");
    expect(seasonAt(level, TILE * 2 - 1)).toBe("spring");
    expect(seasonAt(level, TILE * 2)).toBe("winter");
    expect(seasonAt(level, TILE * 3)).toBe("winter");
  });

  it("defaults to a single band when a level declares none", () => {
    expect(seasonAt(parseLevel({ rows: ["##"] }), 0)).toBe("summer");
  });
});

describe("tileAt bounds", () => {
  const level = parseLevel({ rows: ["..", "##"] });

  it("treats the sides as solid so nothing walks out of the level", () => {
    expect(solidAt(level, -1, 0)).toBe(true);
    expect(solidAt(level, 2, 0)).toBe(true);
  });

  it("leaves above and below open so falling out is detectable", () => {
    expect(solidAt(level, 0, -1)).toBe(false);
    expect(solidAt(level, 0, 5)).toBe(false);
  });
});
