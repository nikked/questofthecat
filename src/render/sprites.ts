/**
 * Sprites are authored as character grids and baked once into canvases at
 * startup, so the hot loop only ever issues drawImage calls.
 *
 * The grids stay at their authored size and the bake doubles them, which keeps
 * the art diffable as text while the world runs at 32px tiles. On the way
 * through, two passes do the lighting that would otherwise have to be typed by
 * hand into every frame: the flat outline is retinted toward whatever material
 * it borders, and edges facing the light pick up a rim.
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
  q: "#6b5f57", // hedgehog spines
  Q: "#3d3531", // hedgehog spine shadow
  z: "#f2c53d", // wasp body
  Z: "#2b2118", // wasp stripe
  m: "#c8b9a6", // wasp wing
  N: "#d8a24a", // crate wood
  M: "#a9762c", // crate wood shade
  R: "#b3352a", // TNT red
  X: "#3f7f36", // nitro green
  L: "#e0a92b", // bounce yellow
  P: "#8fd2f0", // checkpoint blue
  O: "#7d5a36", // boss coat shadow
  K: "#b5895c", // boss coat
};

/**
 * Per material: the tint its outline takes, and the tint an edge takes when it
 * faces the light. A near-black outline on every sprite is the single loudest
 * "sprite era" signal, so nothing keeps one.
 */
type Ramp = { readonly dark: string; readonly light: string };

const RAMPS: Readonly<Record<string, Ramp>> = {
  o: { dark: "#8a4a12", light: "#ffc477" },
  d: { dark: "#6d3a10", light: "#e8933c" },
  w: { dark: "#c9a884", light: "#fffdf6" },
  p: { dark: "#a85266", light: "#ffc2d1" },
  g: { dark: "#3f8a34", light: "#c4ffa8" },
  b: { dark: "#4a2e18", light: "#c08a55" },
  n: { dark: "#6d4526", light: "#e8c197" },
  Y: { dark: "#8a6f36", light: "#fff0c4" },
  U: { dark: "#6d5626", light: "#e6c88b" },
  A: { dark: "#2a6b32", light: "#a8f78c" },
  B: { dark: "#1e4f26", light: "#68cf62" },
  C: { dark: "#5e3a1e", light: "#c98f5e" },
  D: { dark: "#472a14", light: "#a5673c" },
  E: { dark: "#5a3c20", light: "#c49466" },
  F: { dark: "#3f2a16", light: "#9c6b3c" },
  S: { dark: "#b09a68", light: "#fff2c8" },
  T: { dark: "#9a8558", light: "#e9d9a6" },
  V: { dark: "#2a5a32", light: "#84d089" },
  v: { dark: "#1c4224", light: "#4e9e57" },
  G: { dark: "#265c2e", light: "#6fc47a" },
  q: { dark: "#3d342e", light: "#a2938a" },
  Q: { dark: "#231e1a", light: "#6b5f57" },
  z: { dark: "#a8801c", light: "#ffe89a" },
  Z: { dark: "#171009", light: "#5c4a34" },
  m: { dark: "#8f8275", light: "#f2ece2" },
  N: { dark: "#8a5c1c", light: "#f5d78e" },
  M: { dark: "#6b4614", light: "#d8a24a" },
  R: { dark: "#6d1d16", light: "#e8705f" },
  X: { dark: "#25501f", light: "#79c46a" },
  L: { dark: "#8a6410", light: "#ffdc7a" },
  P: { dark: "#3f7f9e", light: "#cdeeff" },
  K: { dark: "#6b4a24", light: "#e0b884" },
  O: { dark: "#4a3418", light: "#b5895c" },
  y: { dark: "#a8801c", light: "#fff0a8" },
  e: { dark: "#7d2418", light: "#e8705f" },
  H: { dark: "#a87a3e", light: "#f7d5a4" },
  I: { dark: "#6d4526", light: "#e8c197" },
  J: { dark: "#5a3c1e", light: "#c08a55" },
  W: { dark: "#a8b48c", light: "#f7fce8" },
  r: { dark: "#9c2f24", light: "#ff8f80" },
};

/** Fallback for an outline with nothing recognisable beside it. */
const DEFAULT_DARK = "#3a2a22";

function channel(hex: string, at: number): number {
  return parseInt(hex.slice(at, at + 2), 16);
}

/** Scales a colour toward black or white, clamped, staying on its own hue. */
function shift(hex: string, factor: number): string {
  const parts = [channel(hex, 1), channel(hex, 3), channel(hex, 5)].map((c) =>
    Math.max(0, Math.min(255, Math.round(c * factor)))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${parts.join("")}`;
}

/**
 * A caller that retints a material — the seasonal ground, the tinted decor —
 * has to retint its edges with it, or winter ends up drawn in snow with dirt
 * coloured seams.
 */
function rampFor(
  ch: string,
  extra: Readonly<Record<string, string>> | undefined,
): Ramp | undefined {
  const override = extra?.[ch];
  if (override && override.length === 7) {
    return { dark: shift(override, 0.55), light: shift(override, 1.3) };
  }
  return RAMPS[ch];
}

export type Sprite = {
  readonly canvas: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;
};

/** Doubling on the way out keeps the authored grids small and readable. */
const SPRITE_SCALE = 2;

const OUTLINE = "k";
const EMPTY = ".";

function at(rows: readonly string[], x: number, y: number): string {
  const ch = rows[y]?.[x] ?? EMPTY;
  return ch === " " ? EMPTY : ch;
}

/**
 * The material an outline pixel is drawing the edge of. Interior neighbours win
 * over diagonal ones, so a corner takes the colour of the mass behind it rather
 * than of whatever happens to touch it first.
 */
function bordering(rows: readonly string[], x: number, y: number): string | null {
  const straight = [
    at(rows, x, y + 1),
    at(rows, x + 1, y),
    at(rows, x - 1, y),
    at(rows, x, y - 1),
  ];
  for (const ch of straight) if (ch !== EMPTY && ch !== OUTLINE && RAMPS[ch]) return ch;

  const diagonal = [
    at(rows, x + 1, y + 1),
    at(rows, x - 1, y + 1),
    at(rows, x + 1, y - 1),
    at(rows, x - 1, y - 1),
  ];
  for (const ch of diagonal) if (ch !== EMPTY && ch !== OUTLINE && RAMPS[ch]) return ch;
  return null;
}

/** Lit from the upper left, so that is the only edge that catches a rim. */
function litEdge(rows: readonly string[], x: number, y: number): boolean {
  const above = at(rows, x, y - 1);
  const left = at(rows, x - 1, y);
  const open = (ch: string): boolean => ch === EMPTY || ch === OUTLINE;
  return open(above) || open(left);
}

export function bake(
  rows: readonly string[],
  extra?: Readonly<Record<string, string>>,
): Sprite {
  const colors = extra ? { ...PALETTE, ...extra } : PALETTE;
  const h = rows.length;
  const w = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const scale = SPRITE_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = at(rows, x, y);
      if (ch === EMPTY) continue;

      let color: string | undefined;
      if (ch === OUTLINE) {
        const material = bordering(rows, x, y);
        // An override for `k` is a deliberate choice by the caller; respect it.
        const ramp = material ? rampFor(material, extra) : undefined;
        color = extra?.[OUTLINE] ?? ramp?.dark ?? DEFAULT_DARK;
      } else {
        const ramp = rampFor(ch, extra);
        color = ramp && litEdge(rows, x, y) ? ramp.light : colors[ch];
      }
      if (!color) continue;

      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return { canvas, w: w * scale, h: h * scale };
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
