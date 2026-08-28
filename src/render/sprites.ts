/**
 * Sprites are authored as character grids and baked once into canvases at
 * startup, so the hot loop only ever issues drawImage calls.
 */
export const PALETTE: Readonly<Record<string, string>> = {
  k: "#241a17", // outline
  o: "#e8933c", // fur
  d: "#bd6a22", // fur shadow
  w: "#fff3df", // belly / muzzle
  p: "#ef8fa4", // nose, inner ear
  g: "#8ce66a", // eyes
  b: "#8a5a34", // dog fur
  n: "#c08a55", // dog fur light
  r: "#e05a4a", // dog tongue
  y: "#ffd34d", // flag / sparkle
  e: "#c4442f", // flag pole shadow
  A: "#68cf62", // grass
  B: "#3f9a49", // grass shadow
  C: "#a5673c", // dirt
  D: "#7c4726", // dirt speckle
  E: "#9c6b3c", // log
  F: "#6f4a2a", // log bark
  H: "#e0b070", // stump rim
  I: "#c08a55", // stump wood
  J: "#8a5f33", // stump rings
  V: "#4e9e57", // cactus
  v: "#2f6b3a", // cactus shadow
  W: "#dfe9c9", // cactus spines
  G: "#42904d", // monstera vein
  S: "#e9d9a6", // sand
  T: "#cbb684", // wet sand
  Y: "#e6c88b", // retriever coat
  U: "#bd9a5d", // retriever shadow
};

export type Sprite = {
  readonly canvas: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;
};

export function bake(
  rows: readonly string[],
  extra?: Readonly<Record<string, string>>,
): Sprite {
  const colors = extra ? { ...PALETTE, ...extra } : PALETTE;
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < w; x++) {
      const color = colors[row[x] ?? "."];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return { canvas, w, h };
}

/** Mirrored copy, baked once so flipping never costs a transform at draw time. */
export function flip(sprite: Sprite): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = sprite.w;
  canvas.height = sprite.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.translate(sprite.w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(sprite.canvas, 0, 0);
  return { canvas, w: sprite.w, h: sprite.h };
}
