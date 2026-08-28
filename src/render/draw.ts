import {
  TILE,
  Tile,
  pixelHeight,
  pixelWidth,
  seasonAt,
  tileAt,
  type Level,
  type Season,
} from "../core/level";
import {
  TRACE_HZ,
  MONSTERA_H,
  MONSTERA_W,
  endingFor,
  harvest,
  timeBonus,
  CACTUS_H,
  CACTUS_W,
  BREEDS,
  type Breed,
  FLOWER_H,
  FLOWER_W,
  PLAYER_H,
  PLAYER_W,
  type Ending,
  type GameState,
} from "../core/state";
import * as art from "./art";
import { bakeFont, drawText, textWidth, type Font } from "./font";
import { bake, flip, type Sprite } from "./sprites";

export const VIEW_W = 320;
export const VIEW_H = 180;

type RGB = readonly [number, number, number];

type Palette = {
  readonly sky: RGB;
  /** Blended into the bottom of the sky; autumn's is what makes the sunset. */
  readonly horizon: RGB;
  readonly sun: RGB;
  readonly hillFar: RGB;
  readonly hillNear: RGB;
  readonly cloud: RGB;
};

/** Stops the sky, hills and clouds melt between as the camera crosses bands. */
const SEASON_PALETTE: Readonly<Record<Season, Palette>> = {
  spring: {
    sky: [172, 214, 244],
    horizon: [236, 240, 232],
    sun: [255, 246, 214],
    hillFar: [154, 216, 140],
    hillNear: [104, 180, 112],
    cloud: [255, 249, 251],
  },
  summer: {
    sky: [95, 184, 240],
    horizon: [186, 224, 246],
    sun: [255, 250, 224],
    hillFar: [79, 191, 95],
    hillNear: [61, 130, 80],
    cloud: [251, 253, 255],
  },
  autumn: {
    sky: [240, 176, 112],
    horizon: [244, 138, 74],
    sun: [255, 146, 76],
    hillFar: [201, 138, 62],
    hillNear: [150, 98, 42],
    cloud: [255, 240, 224],
  },
  winter: {
    sky: [207, 228, 242],
    horizon: [236, 242, 248],
    sun: [248, 250, 252],
    hillFar: [234, 244, 251],
    hillNear: [194, 214, 230],
    cloud: [255, 255, 255],
  },
  // Spring's own sky and light: the cherry blossom is the difference, not a
  // whole new season.
  sakura: {
    sky: [172, 214, 244],
    horizon: [244, 236, 236],
    sun: [255, 246, 220],
    hillFar: [214, 176, 194],
    hillNear: [150, 186, 138],
    cloud: [255, 250, 252],
  },
};

/** Only the ground recolours per season; logs and stumps stay wooden. */
const SEASON_TILES: Readonly<Record<Season, Readonly<Record<string, string>>>> = {
  spring: { A: "#93e879", B: "#5cc267", C: "#a5673c", D: "#7c4726" },
  summer: { A: "#68cf62", B: "#3f9a49", C: "#a5673c", D: "#7c4726" },
  autumn: { A: "#d9a441", B: "#a8721f", C: "#8f5a34", D: "#6b4020" },
  winter: { A: "#f4fafe", B: "#cfe0ee", C: "#93a3b1", D: "#74858f" },
  sakura: { A: "#93e879", B: "#5cc267", C: "#a5673c", D: "#7c4726" },
};


/** Fixed scenery so the parallax is identical on every run. */
const CLOUDS: readonly (readonly [number, number])[] = [
  [30, 24], [150, 46], [290, 18], [420, 40], [560, 28], [700, 50], [840, 22],
];

export type Renderer = {
  readonly ctx: CanvasRenderingContext2D;
  readonly cat: { idle: Sprite[]; run: Sprite[]; jump: Sprite[]; cling: Sprite[] };
  readonly dog: Readonly<Record<Breed, { walk: Sprite[]; scratch: Sprite[] }>>;
  readonly dogSquashed: Sprite;
  readonly flower: Sprite;
  readonly flag: Sprite;
  readonly tiles: ReadonlyMap<Tile, Sprite>;
  readonly ground: Readonly<Record<Season, { readonly top: Sprite; readonly body: Sprite }>>;
  readonly cactus: Sprite;
  readonly decor: Readonly<Record<Season, readonly Sprite[]>>;
  readonly tree: Sprite;
  readonly boat: Readonly<Record<"raft" | "sailboat" | "ship", Sprite>>;
  readonly monstera: Sprite;
  decorations: readonly Decoration[];
  forest: readonly Tree[];
  /** The best run to race against, flat [x, y, ...] at TRACE_HZ. */
  ghost: readonly number[];
  waterfalls: readonly number[];
  readonly post: { readonly idle: Sprite; readonly taken: Sprite };
  readonly fontLight: Font;
  readonly fontDark: Font;
};

/** Ground dressing: flowers and tufts that exist only in the renderer. */
export type Decoration = {
  readonly x: number;
  readonly y: number;
  readonly season: Season;
  readonly variant: number;
  readonly tree: boolean;
  /** Grown from monstera collected in past runs, not from this level's tiles. */
  readonly leaf: boolean;
};

const DECOR_TINT: Readonly<Record<Season, Readonly<Record<string, string>>>> = {
  spring: { p: "#f78fb0", y: "#ffe066", w: "#fff6fb", A: "#4fae54" },
  summer: { p: "#ff9ec4", y: "#ffd83d", w: "#fffdf0", A: "#3f9a49" },
  autumn: { p: "#d9762f", y: "#f0c24a", w: "#f6e2c0", A: "#9c7a2c" },
  winter: { p: "#dbe9f5", y: "#f4f9ff", w: "#ffffff", A: "#9fb6c4" },
  sakura: { p: "#f8a5c2", y: "#fff0a8", w: "#fff2f7", A: "#5cb85f" },
};

function seasonDecor(season: Season): readonly Sprite[] {
  const tint = DECOR_TINT[season];
  return [bake(art.BLOOM_A, tint), bake(art.BLOOM_B, tint), bake(art.TUFT, tint)];
}

/**
 * Deterministic from the tile column, so the meadow is identical every run and
 * costs nothing per frame beyond the draw calls for what is on screen.
 */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function buildScenery(level: Level, grown = 0): {
  readonly decorations: readonly Decoration[];
  readonly forest: readonly Tree[];
  readonly waterfalls: readonly number[];
} {
  return {
    decorations: buildDecorations(level, grown),
    forest: buildForest(level),
    waterfalls: waterfallsFor(level),
  };
}

function buildDecorations(level: Level, grown: number): readonly Decoration[] {
  const out: Decoration[] = [];
  // Every monstera ever collected leaves one growing in the world.
  const surfaces: Decoration[] = [];
  for (let tx = 0; tx < level.width; tx++) {
    for (let ty = 0; ty < level.height; ty++) {
      if (tileAt(level, tx, ty) !== Tile.Ground) continue;
      if (tileAt(level, tx, ty - 1) === Tile.Ground) continue;

      const season = seasonAt(level, tx * TILE);
      // Three slots per tile keeps the meadow dense without a regular beat.
      for (let slot = 0; slot < 3; slot++) {
        const roll = hash(tx * 7 + slot * 131);
        // A richer year leaves a denser meadow behind it.
        const density = Math.min(0.52 + grown * 0.004, 0.86);
        if (roll > (season === "sakura" ? density + 0.26 : density)) continue;
        out.push({
          x: tx * TILE + slot * 5 + Math.floor(hash(tx + slot * 17) * 3),
          y: ty * TILE,
          season,
          variant: Math.floor(hash(tx * 3 + slot) * 3) % 3,
          tree: false,
          leaf: false,
        });
      }

      // Monstera is tropical: nothing grows one out of the snow.
      if (season !== "winter") {
        surfaces.push({ x: tx * TILE, y: ty * TILE, season, variant: 0, tree: false, leaf: true });
      }
      if (season === "sakura" && tx % 7 === 3) {
        out.push({ x: tx * TILE - 8, y: ty * TILE, season, variant: 0, tree: true, leaf: false });
      }
      break;
    }
  }

  for (let i = 0; i < Math.min(grown, 60) && surfaces.length > 0; i++) {
    const spot = surfaces[Math.floor(hash(i * 53 + 11) * surfaces.length)];
    if (spot) out.push({ ...spot, x: spot.x + Math.floor(hash(i * 31) * 8) - 4 });
  }
  return out;
}

function seasonGround(season: Season): { top: Sprite; body: Sprite } {
  const palette = SEASON_TILES[season];
  return { top: bake(art.GROUND, palette), body: bake(art.DIRT, palette) };
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  // `alpha:false` skips compositing against the page; `desynchronized` lets the
  // browser hand frames to the compositor without waiting on the main thread.
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.imageSmoothingEnabled = false;

  const idle = bake(art.CAT_IDLE);
  const runA = bake(art.CAT_RUN_A);
  const runB = bake(art.CAT_RUN_B);
  const jump = bake(art.CAT_JUMP);
  const cling = bake(art.CAT_CLING);
  const dog = bake(art.DOG);
  const dogScratch = bake(art.DOG_SIT);
  const retriever = bake(art.RETRIEVER);
  const retrieverScratch = bake(art.RETRIEVER_SIT);

  return {
    ctx,
    cat: {
      idle: [flip(idle), idle],
      run: [flip(runA), runA, flip(runB), runB],
      jump: [flip(jump), jump],
      cling: [flip(cling), cling],
    },
    dog: {
      terrier: { walk: [flip(dog), dog], scratch: [flip(dogScratch), dogScratch] },
      retriever: {
        walk: [flip(retriever), retriever],
        scratch: [flip(retrieverScratch), retrieverScratch],
      },
    },
    dogSquashed: bake(art.DOG_SQUASHED),
    flower: bake(art.FLOWER),
    flag: bake(art.FLAG),
    tiles: new Map([
      [Tile.Ground, bake(art.GROUND)],
      [Tile.Brick, bake(art.LOG)],
      [Tile.Box, bake(art.STUMP)],
      [Tile.Sand, bake(art.SAND)],
    ]),
    ground: {
      spring: seasonGround("spring"),
      summer: seasonGround("summer"),
      autumn: seasonGround("autumn"),
      winter: seasonGround("winter"),
      sakura: seasonGround("sakura"),
    },
    cactus: bake(art.CACTUS),
    decor: {
      spring: seasonDecor("spring"),
      summer: seasonDecor("summer"),
      autumn: seasonDecor("autumn"),
      winter: seasonDecor("winter"),
      sakura: seasonDecor("sakura"),
    },
    tree: bake(art.CHERRY_TREE),
    boat: {
      raft: bake(art.RAFT),
      sailboat: bake(art.BOAT),
      ship: bake(art.SHIP),
    },
    monstera: bake(art.MONSTERA),
    decorations: [],
    forest: [],
    ghost: [],
    waterfalls: [],
    post: {
      idle: bake(art.FLAG, { y: "#9aa7ad", e: "#6d7a80" }),
      taken: bake(art.FLAG, { y: "#8ce66a", e: "#3f9a49" }),
    },
    fontLight: bakeFont("#fff6e2"),
    fontDark: bakeFont("#2a1c14"),
  };
}

const lerp = (from: number, to: number, alpha: number): number =>
  from + (to - from) * alpha;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export function cameraX(state: GameState, playerX: number): number {
  const max = Math.max(0, pixelWidth(state.level) - VIEW_W);
  return Math.round(clamp(playerX + PLAYER_W / 2 - VIEW_W / 2, 0, max));
}

export function cameraY(state: GameState, playerY: number): number {
  const max = Math.max(0, pixelHeight(state.level) - VIEW_H);
  return Math.round(clamp(playerY + PLAYER_H / 2 - VIEW_H / 2, 0, max));
}

/** Sprites are wider than their hitbox: centre them and sit them on its floor. */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  camX: number,
  camY: number,
): void {
  ctx.drawImage(
    sprite.canvas,
    Math.round(x - (sprite.w - boxW) / 2 - camX),
    Math.round(y + boxH - sprite.h - camY),
  );
}

/**
 * Seasons hold their own colour for most of a band and cross-fade only in a
 * window around the boundary, so the melt never parks on a muddy midpoint.
 */
const BLEND_WINDOW = VIEW_W * 0.6;

type SeasonMix = {
  readonly from: Season;
  readonly to: Season;
  readonly t: number;
};

function seasonMix(level: Level, camX: number): SeasonMix {
  const focus = camX + VIEW_W / 2;
  const bands = level.seasons;

  let index = 0;
  for (let i = 0; i < bands.length; i++) {
    if (bands[i]!.fromTile * TILE <= focus) index = i;
  }

  const current = bands[index]!.season;
  const previous = bands[index - 1];
  const next = bands[index + 1];
  const half = BLEND_WINDOW / 2;

  if (previous) {
    const boundary = bands[index]!.fromTile * TILE;
    if (focus < boundary + half) {
      return { from: previous.season, to: current, t: (focus - boundary + half) / BLEND_WINDOW };
    }
  }
  if (next) {
    const boundary = next.fromTile * TILE;
    if (focus > boundary - half) {
      return { from: current, to: next.season, t: (focus - boundary + half) / BLEND_WINDOW };
    }
  }
  return { from: current, to: current, t: 0 };
}

function blendPalette(level: Level, camX: number): Palette {
  const { from, to, t } = seasonMix(level, camX);
  return from === to
    ? SEASON_PALETTE[from]
    : mixPalette(SEASON_PALETTE[from], SEASON_PALETTE[to], t);
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

function mixPalette(a: Palette, b: Palette, t: number): Palette {
  return {
    sky: mix(a.sky, b.sky, t),
    horizon: mix(a.horizon, b.horizon, t),
    sun: mix(a.sun, b.sun, t),
    hillFar: mix(a.hillFar, b.hillFar, t),
    hillNear: mix(a.hillNear, b.hillNear, t),
    cloud: mix(a.cloud, b.cloud, t),
  };
}

const css = (c: RGB): string =>
  `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

/** How much of the view currently belongs to one season, for weather fades. */
function seasonWeight(mixed: SeasonMix, season: Season): number {
  if (mixed.from === mixed.to) return mixed.from === season ? 1 : 0;
  return (mixed.from === season ? 1 - mixed.t : 0) + (mixed.to === season ? mixed.t : 0);
}

type Weather = {
  readonly count: number;
  readonly fall: number;
  readonly sway: number;
  readonly size: number;
  readonly colors: readonly [string, string];
};

/** Summer is the only still season, which is what makes the others read. */
const SEASON_WEATHER: Readonly<Record<Season, Weather | null>> = {
  spring: { count: 22, fall: 26, sway: 11, size: 2, colors: ["#f9c2d6", "#ffe1ec"] },
  summer: null,
  autumn: { count: 26, fall: 34, sway: 9, size: 2, colors: ["#d9762f", "#c8a13a"] },
  winter: { count: 46, fall: 22, sway: 5, size: 1, colors: ["#ffffff", "#e6f2fb"] },
  sakura: { count: 64, fall: 20, sway: 16, size: 2, colors: ["#f7a8c4", "#ffdce8"] },
};

function drawWeather(
  ctx: CanvasRenderingContext2D,
  mixed: SeasonMix,
  camX: number,
  time: number,
): void {
  let best: Weather | null = null;
  let strength = 0;
  for (const season of [mixed.from, mixed.to]) {
    const weather = SEASON_WEATHER[season];
    const weight = weather ? seasonWeight(mixed, season) : 0;
    if (weather && weight > strength) {
      best = weather;
      strength = weight;
    }
  }
  if (!best || strength < 0.02) return;

  const count = Math.round(best.count * strength);
  for (let i = 0; i < count; i++) {
    const sway = Math.sin(time * 1.4 + i * 1.7) * best.sway;
    const x = (((i * 71) % (VIEW_W + 24)) - camX * 0.4 + sway) % (VIEW_W + 24);
    const y = ((i * 43 + time * best.fall) % (VIEW_H + 20)) - 10;
    ctx.fillStyle = best.colors[i % 2]!;
    const size = best.size === 1 && i % 3 === 0 ? 2 : best.size;
    ctx.fillRect(Math.round(x < 0 ? x + VIEW_W + 24 : x) - 12, Math.round(y), size, size);
  }
}

/**
 * The forest sits on a world baseline and parallaxes in both axes, so climbing
 * into winter genuinely puts the treeline below the cat.
 */
const FOREST_BASE = 227;
const FOREST_PARALLAX = 0.65;

type Tree = {
  readonly x: number;
  readonly height: number;
  readonly far: boolean;
};

export function buildForest(level: Level): readonly Tree[] {
  const trees: Tree[] = [];
  const span = level.width * TILE;
  for (let x = -80; x < span + 80; x += 9) {
    const far = hash(x) < 0.62;
    trees.push({
      x,
      height: (far ? 13 : 20) + Math.floor(hash(x * 5) * (far ? 6 : 11)),
      far,
    });
  }
  return trees;
}

/**
 * A continuous ridge runs the whole level behind the forest. Waterfalls hang
 * off it rather than standing on cliffs of their own.
 */
function ridgeHeight(x: number, near: boolean): number {
  const base = near ? 20 : 30;
  const scale = near ? 0.8 : 1;
  return (
    base +
    (Math.sin(x * 0.0071) * 13 +
      Math.sin(x * 0.019 + 1.7) * 6 +
      Math.sin(x * 0.0037 + 0.4) * 9) *
      scale
  );
}

const RIDGE_PARALLAX = 0.18;
const RIDGE_FAR_PARALLAX = 0.11;

/** Falls are placed where the ridge is high enough to carry one. */
function waterfallsFor(level: Level): readonly number[] {
  const out: number[] = [];
  const span = level.width * TILE;
  for (let x = 200; x < span * 1.2; x += 300) {
    const at = x + Math.floor(hash(x) * 120);
    if (ridgeHeight(at, false) > 38) out.push(at);
  }
  return out;
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function drawPine(ctx: CanvasRenderingContext2D, x: number, base: number, h: number): void {
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const top = base - h + (h / tiers) * i * 0.8;
    const width = (h * 0.42) * (0.45 + (i / tiers) * 0.55);
    const tierH = h / tiers;
    for (let row = 0; row < tierH; row += 2) {
      const half = (width * (row / tierH)) / 2;
      bar(ctx, x - half, top + row, half * 2, 2);
    }
  }
}

function drawCanopy(ctx: CanvasRenderingContext2D, x: number, base: number, h: number): void {
  // Radius kept under a third of the height so the trunk stays visible.
  const r = h * 0.3;
  const cy = base - h + r;
  for (let row = -r; row < r; row += 2) {
    const half = Math.sqrt(Math.max(0, r * r - row * row));
    bar(ctx, x - half, cy + row, half * 2, 2);
  }
}

function drawPalm(ctx: CanvasRenderingContext2D, x: number, base: number, h: number): void {
  const top = base - h;
  for (const dir of [-1, 1]) {
    for (const lift of [0, 5, 10]) {
      for (let i = 0; i < 9; i++) {
        bar(ctx, x + dir * i * 1.6, top + lift + i * i * 0.09, 2, 2);
      }
    }
  }
}

function drawTrunk(ctx: CanvasRenderingContext2D, x: number, base: number, h: number): void {
  bar(ctx, x - 1, base - h * 0.62, 2, h * 0.62);
}

function drawForest(
  r: Renderer,
  level: Level,
  camX: number,
  camY: number,
  palette: Palette,
  far: boolean,
): void {
  const ctx = r.ctx;
  const speed = far ? 0.3 : 0.55;
  // The far rank sits a little higher, which is what gives the wood its depth.
  const base = FOREST_BASE - camY * FOREST_PARALLAX + (far ? -7 : 3);
  ctx.fillStyle = css(far ? palette.hillFar : palette.hillNear);

  for (const tree of r.forest) {
    if (tree.far !== far) continue;
    const x = tree.x - camX * speed;
    if (x < -30 || x > VIEW_W + 30) continue;

    // Parallax slides trees relative to the world, so the species has to come
    // from where the tree is drawn, not from the x it was generated at.
    const worldX = camX + x;
    const season = seasonAt(level, worldX);
    // Palms crowd the shoreline, and grow in summer besides.
    const shore = level.water ? level.water.fromTile * TILE : Number.POSITIVE_INFINITY;
    const seaside = worldX > shore - 280;
    if (seaside || (season === "summer" && hash(tree.x * 3) > 0.55)) {
      drawTrunk(ctx, x, base, tree.height);
      drawPalm(ctx, x, base, tree.height);
    } else if (season === "winter") {
      drawPine(ctx, x, base, tree.height);
    } else {
      drawTrunk(ctx, x, base, tree.height);
      drawCanopy(ctx, x, base, tree.height);
    }
  }
}

function drawRidge(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  palette: Palette,
): void {
  const base = FOREST_BASE - camY * FOREST_PARALLAX + 8;

  // Two ranks, the far one hazed further toward the sky for depth.
  for (const near of [false, true]) {
    const speed = near ? RIDGE_PARALLAX : RIDGE_FAR_PARALLAX;
    const body = mix(palette.hillNear, palette.sky, near ? 0.42 : 0.62);
    const cap = mix(palette.hillNear, palette.sky, near ? 0.24 : 0.46);
    const drop = near ? 4 : 0;

    for (let x = 0; x < VIEW_W; x += 2) {
      const h = Math.round(ridgeHeight(camX * speed + x, near) / 2) * 2;
      const top = Math.round(base - h + drop);
      ctx.fillStyle = css(body);
      ctx.fillRect(x, top, 2, Math.round(h));
      ctx.fillStyle = css(cap);
      ctx.fillRect(x, top, 2, 3);
    }
  }
}

function drawWaterfalls(
  r: Renderer,
  mixed: SeasonMix,
  camX: number,
  camY: number,
  time: number,
): void {
  const ctx = r.ctx;
  // Meltwater: full flow in spring, gone by high summer.
  const flow = seasonWeight(mixed, "spring") + seasonWeight(mixed, "sakura");
  if (flow < 0.02) return;
  ctx.globalAlpha = Math.min(1, flow);
  const base = FOREST_BASE - camY * FOREST_PARALLAX + 8;

  for (const wx of r.waterfalls) {
    const x = wx - camX * RIDGE_FAR_PARALLAX;
    if (x < -12 || x > VIEW_W + 12) continue;
    const crest = base - ridgeHeight(camX * RIDGE_FAR_PARALLAX + x, false) + 4;
    const height = base - crest;
    if (height < 10) continue;

    ctx.fillStyle = "#c6e2f4";
    bar(ctx, x, crest, 7, height);
    ctx.fillStyle = "#f0f9ff";
    for (let i = 0; i < 6; i++) {
      const y = crest + ((i * 11 + time * 42) % height);
      bar(ctx, x + ((i * 3) % 5) + 1, y, 2, 5);
    }
    ctx.fillStyle = "#e2f2fc";
    bar(ctx, x - 3, base - 4, 13, 4);
  }
  ctx.globalAlpha = 1;
}

/** Like drawSprite, but pivoted at the foot so a leaf can lean. */
function drawTilted(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  camX: number,
  camY: number,
  tilt: number,
): void {
  ctx.save();
  ctx.translate(Math.round(x + boxW / 2 - camX), Math.round(y + boxH - camY));
  ctx.rotate(tilt);
  ctx.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h);
  ctx.restore();
}

function drawBackground(
  r: Renderer,
  level: Level,
  mixed: SeasonMix,
  camX: number,
  camY: number,
  palette: Palette,
  time: number,
): void {
  const ctx = r.ctx;
  const horizon = FOREST_BASE - camY * FOREST_PARALLAX;

  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, css(palette.sky));
  sky.addColorStop(1, css(palette.horizon));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Sun rides just above the treeline, which is what sells the autumn sunset.
  const sunX = ((VIEW_W * 1.4 - camX * 0.12) % (VIEW_W + 160)) - 40;
  ctx.fillStyle = css(palette.sun);
  const sunY = horizon - 46;
  for (let row = -13; row < 13; row += 2) {
    const half = Math.sqrt(Math.max(0, 169 - row * row));
    bar(ctx, sunX - half, sunY + row, half * 2, 2);
  }

  ctx.fillStyle = css(palette.cloud);
  for (const [x, y] of CLOUDS) {
    const sx = Math.round(x - camX * 0.25) % 960;
    const px = sx < -60 ? sx + 960 : sx;
    const py = y - camY * 0.2;
    bar(ctx, px, py, 22, 6);
    bar(ctx, px + 5, py - 4, 13, 6);
    bar(ctx, px + 14, py - 2, 12, 5);
  }

  drawRidge(ctx, camX, camY, palette);
  drawWaterfalls(r, mixed, camX, camY, time);
  drawForest(r, level, camX, camY, palette, true);
  drawForest(r, level, camX, camY, palette, false);
}

/** Monstera never stand bolt upright, planted or not. */
const LEAF_TILT = (10 * Math.PI) / 180;
/** Planted ones also sit back: smaller and faded. */
const LEAF_DECOR_SCALE = 0.6;
const LEAF_DECOR_ALPHA = 0.72;

function drawDecorations(r: Renderer, camX: number, camY: number, trees: boolean): void {
  const ctx = r.ctx;

  for (const d of r.decorations) {
    if (d.tree !== trees) continue;
    const sprite = d.tree ? r.tree : d.leaf ? r.monstera : r.decor[d.season][d.variant];
    if (!sprite) continue;
    const x = d.x - camX;
    if (x < -sprite.w || x > VIEW_W) continue;

    if (!d.leaf) {
      ctx.drawImage(sprite.canvas, Math.round(x), Math.round(d.y - sprite.h - camY));
      continue;
    }

    const w = sprite.w * LEAF_DECOR_SCALE;
    const h = sprite.h * LEAF_DECOR_SCALE;
    // Lean left or right depending on where it grew, so a bed of them varies.
    const tilt = (hash(d.x * 11) > 0.5 ? 1 : -1) * LEAF_TILT;

    ctx.save();
    ctx.globalAlpha = LEAF_DECOR_ALPHA;
    // Pivot at the foot of the stem so a tilted leaf still meets the ground.
    ctx.translate(Math.round(x + w / 2), Math.round(d.y - camY));
    ctx.rotate(tilt);
    ctx.drawImage(sprite.canvas, -w / 2, -h, w, h);
    ctx.restore();
  }
}

/** Open water beyond the beach: a flat sea with a moving surface line. */
function drawWater(
  r: Renderer,
  state: GameState,
  camX: number,
  camY: number,
): void {
  const water = state.level.water;
  if (!water) return;

  const ctx = r.ctx;
  const left = Math.round(water.fromTile * TILE - camX);
  const top = Math.round(water.row * TILE - camY);
  if (left > VIEW_W) return;

  const x = Math.max(0, left);
  ctx.fillStyle = "#3f92c4";
  ctx.fillRect(x, top, VIEW_W - x, VIEW_H - top);
  ctx.fillStyle = "#57a8d6";
  ctx.fillRect(x, top, VIEW_W - x, 6);

  ctx.fillStyle = "#bfe4f6";
  for (let i = x; i < VIEW_W; i += 2) {
    const lift = Math.round(Math.sin(state.time * 2.6 + i * 0.14) * 1.6);
    ctx.fillRect(i, top + lift, 2, 2);
  }
  // A thin line of foam where the sea meets the sand.
  ctx.fillStyle = "#eaf6fd";
  ctx.fillRect(x, top + 2 + Math.round(Math.sin(state.time * 3) * 1), Math.min(10, VIEW_W - x), 2);
}

function drawTiles(r: Renderer, state: GameState, camX: number, camY: number): void {
  const level = state.level;
  const firstCol = Math.max(0, Math.floor(camX / TILE));
  const lastCol = Math.min(level.width - 1, Math.floor((camX + VIEW_W) / TILE));
  const firstRow = Math.max(0, Math.floor(camY / TILE));
  const lastRow = Math.min(level.height - 1, Math.floor((camY + VIEW_H) / TILE));

  for (let ty = firstRow; ty <= lastRow; ty++) {
    for (let tx = firstCol; tx <= lastCol; tx++) {
      const tile = tileAt(level, tx, ty);
      if (tile === Tile.Empty) continue;
      // Grass belongs only on the ground tiles that are actually exposed.
      const ground = r.ground[seasonAt(level, tx * TILE)];
      const buried = tileAt(level, tx, ty - 1) === Tile.Ground;
      const sprite =
        tile === Tile.Ground ? (buried ? ground.body : ground.top) : r.tiles.get(tile);
      if (!sprite) continue;
      const bump = state.bumps.get(ty * level.width + tx) ?? 0;
      const lift = bump > 0 ? Math.round(Math.sin((bump / 0.18) * Math.PI) * 5) : 0;
      r.ctx.drawImage(sprite.canvas, tx * TILE - camX, ty * TILE - camY - lift);
    }
  }
}

function catFrame(r: Renderer, state: GameState): Sprite {
  const p = state.player;
  const side = p.facing > 0 ? 1 : 0;

  if (state.phase === "dying") return r.cat.jump[side]!;
  if (p.cling !== 0) return r.cat.cling[side]!;
  if (!p.grounded) return r.cat.jump[side]!;
  if (Math.abs(p.vx) < 2) return r.cat.idle[side]!;

  const frame = Math.floor(p.runTime / 9) % 2;
  return r.cat.run[frame * 2 + side]!;
}

/** Runs read as M:SS.CC; a dash stands in for a best that does not exist yet. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-:--.--";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

/**
 * The best run replayed beside you. Drawn faded and behind the live cat, so it
 * never gets mistaken for the one you are steering.
 */
function drawGhost(
  r: Renderer,
  state: GameState,
  camX: number,
  camY: number,
): void {
  if (r.ghost.length < 4 || !state.started || state.phase === "won") return;

  const at = state.runTime * TRACE_HZ;
  const i = Math.floor(at);
  const last = r.ghost.length / 2 - 1;
  if (i >= last) return;

  const t = at - i;
  const x = lerp(r.ghost[i * 2]!, r.ghost[i * 2 + 2]!, t);
  const y = lerp(r.ghost[i * 2 + 1]!, r.ghost[i * 2 + 3]!, t);
  const facing = r.ghost[i * 2 + 2]! >= r.ghost[i * 2]! ? 1 : 0;

  const ctx = r.ctx;
  ctx.globalAlpha = 0.34;
  drawSprite(ctx, r.cat.run[facing]!, x, y, PLAYER_W, PLAYER_H, camX, camY);
  ctx.globalAlpha = 1;
}

/**
 * Twinkles around anything still worth picking up. Background foliage never
 * sparkles, so what is collectable reads at a glance.
 */
function drawSparkle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  time: number,
  seed: number,
  camX: number,
  camY: number,
): void {
  for (let i = 0; i < 4; i++) {
    const phase = (time * 0.9 + seed * 0.13 + i * 0.27) % 1;
    if (phase > 0.42) continue;

    const angle = (i / 4) * Math.PI * 2 + seed + time * 0.5;
    const x = Math.round(cx + Math.cos(angle) * radius - camX);
    const y = Math.round(cy + Math.sin(angle) * radius * 0.75 - camY);
    const big = phase > 0.12 && phase < 0.3;

    ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#fff3ac";
    ctx.fillRect(x, y, 1, 1);
    if (big) {
      // A four-armed twinkle rather than a plain dot.
      ctx.fillRect(x - 1, y, 1, 1);
      ctx.fillRect(x + 1, y, 1, 1);
      ctx.fillRect(x, y - 1, 1, 1);
      ctx.fillRect(x, y + 1, 1, 1);
    }
  }
}

function drawHud(r: Renderer, state: GameState, best: number): void {
  const ctx = r.ctx;
  const lines = [
    `SCORE ${String(state.score).padStart(5, "0")}`,
    `BEST ${String(best).padStart(5, "0")}`,
    `TIME ${formatTime(state.runTime)}`,
    `PICKED ${harvest(state)}`,
    `LIVES ${state.lives}`,
  ];

  ctx.fillStyle = "rgba(20, 14, 10, 0.45)";
  ctx.fillRect(0, 0, VIEW_W, 11);
  let x = 5;
  for (const line of lines) {
    drawText(ctx, r.fontLight, line, x, 3);
    x += textWidth(line) + 6;
  }
}

function drawBanner(r: Renderer, title: string, ...lines: readonly string[]): void {
  const ctx = r.ctx;
  const width = Math.max(textWidth(title), ...lines.map(textWidth)) + 24;
  const height = 22 + lines.length * 10;
  const x = Math.round((VIEW_W - width) / 2);
  const y = Math.round(90 - height / 2);

  ctx.fillStyle = "rgba(20, 14, 10, 0.72)";
  ctx.fillRect(x, y, width, height);
  drawText(ctx, r.fontLight, title, Math.round((VIEW_W - textWidth(title)) / 2), y + 8);
  lines.forEach((line, i) => {
    drawText(ctx, r.fontLight, line, Math.round((VIEW_W - textWidth(line)) / 2), y + 20 + i * 10);
  });
}

/** Drawn over a frozen frame, so the loop can keep rendering while paused. */
/** The pause screen is where people look for controls, so it lists them. */
const PAUSE_LINES: readonly string[] = [
  "ESC RESUME    R RESTART",
  "",
  "ARROWS MOVE    SPACE JUMP    SHIFT RUN",
  "HOLD INTO A WALL IN MID-AIR TO CLING",
  "THEN SPACE TO KICK OFF IT",
];

export function drawPause(r: Renderer, best: number): void {
  const ctx = r.ctx;
  ctx.fillStyle = "rgba(16, 12, 9, 0.62)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const lines = [...PAUSE_LINES, "", `BEST ${formatTime(best)}`];
  const width = Math.max(...lines.map(textWidth), textWidth("PAUSED")) + 26;
  const height = 22 + lines.length * 9 + 10;
  const x = Math.round((VIEW_W - width) / 2);
  const y = Math.round((VIEW_H - height) / 2);

  ctx.fillStyle = "rgba(20, 14, 10, 0.82)";
  ctx.fillRect(x, y, width, height);
  drawText(ctx, r.fontLight, "PAUSED", Math.round((VIEW_W - textWidth("PAUSED")) / 2), y + 9);

  lines.forEach((line, i) => {
    if (!line) return;
    drawText(ctx, r.fontLight, line, Math.round((VIEW_W - textWidth(line)) / 2), y + 24 + i * 9);
  });
}

/** Coat colour, for the scratching leg drawn over the sprite. */
const FUR: Readonly<Record<Breed, string>> = {
  terrier: "#c08a55",
  retriever: "#e6c88b",
};

const ENDING_TITLE: Readonly<Record<Ending, string>> = {
  shore: "NEXT YEAR, THEN",
  raft: "OFF YOU GO",
  sailboat: "FAIR WINDS",
  ship: "WHAT A YEAR!",
};

export type Hud = {
  /** All-time best, shown live. */
  readonly best: number;
  /** Whether this run has already beaten the best it started with. */
  readonly beat: boolean;
};

/** Outro beats, in seconds since the flag was touched. */
const WALK_TO_BOAT = 0.4;
const BOARDED = 1.6;
const CAST_OFF = 2.6;
const BOAT_SPEED = 52;
/** Row 8 of every hull sprite is its deck, whatever the sprite's height. */
const HULL_DECK_ROW = 8;

type Outro = {
  readonly t: number;
  readonly ending: Ending;
  readonly boatX: number;
  /** Waterline the hull sits on, when the level has a sea. */
  readonly boatY: number | null;
  readonly catX: number;
  readonly aboard: boolean;
  /** 0 on the sand, 1 fully aboard. */
  readonly board: number;
  /** 0 at the shore, 1 once the voyage has fully turned to summer. */
  readonly summer: number;
};

function outroFor(state: GameState): Outro | null {
  if (state.phase !== "won" || !state.goal) return null;
  const t = Math.max(0, state.time - state.wonAt);
  const ending = endingFor(harvest(state));
  const water = state.level.water;
  // Moored just off the beach, not floating over the grass.
  const dock = water ? water.fromTile * TILE + 10 : state.goal.x + 34;
  // Nothing to board on the shore ending: the cat simply stays and waves.
  const sailed = ending === "shore" ? 0 : Math.max(0, t - CAST_OFF) * BOAT_SPEED;
  const boatX = dock + sailed;

  const board =
    ending === "shore" ? 0 : clamp((t - WALK_TO_BOAT) / (BOARDED - WALK_TO_BOAT), 0, 1);
  const aboard = board >= 1;
  const catX = state.player.x + (dock + 7 - state.player.x) * board;

  return {
    t,
    ending,
    boatX,
    boatY: water ? water.row * TILE : null,
    catX: aboard ? boatX + 7 : catX,
    aboard,
    board,
    summer: clamp((t - CAST_OFF) / 3, 0, 1),
  };
}

export function render(r: Renderer, state: GameState, alpha: number, hud: Hud): void {
  const ctx = r.ctx;
  const p = state.player;
  const px = lerp(p.px, p.x, alpha);
  const py = lerp(p.py, p.y, alpha);
  const camX = cameraX(state, px);
  const camY = cameraY(state, py);

  const outro = outroFor(state);
  const mixed = seasonMix(state.level, camX);
  // Sailing away turns the world back to high summer.
  const palette = outro
    ? mixPalette(blendPalette(state.level, camX), SEASON_PALETTE.summer, outro.summer)
    : blendPalette(state.level, camX);
  drawBackground(r, state.level, mixed, camX, camY, palette, state.time);
  drawDecorations(r, camX, camY, true);
  drawTiles(r, state, camX, camY);
  drawDecorations(r, camX, camY, false);
  drawWater(r, state, camX, camY);

  for (const c of state.checkpoints) {
    ctx.fillStyle = "#8a5f33";
    ctx.fillRect(c.x + 2 - camX, c.y - camY, 3, TILE * 4);
    ctx.drawImage((c.taken ? r.post.taken : r.post.idle).canvas, c.x - 11 - camX, c.y + 1 - camY);
  }

  if (state.avalanche.active && state.chimney) {
    const shaft = state.chimney;
    const top = Math.round(state.avalanche.y - camY);
    const x = Math.round(shaft.left - camX);
    const w = shaft.right - shaft.left;
    ctx.fillStyle = "#eef6fc";
    ctx.fillRect(x, top + 3, w, Math.round(shaft.floorY - state.avalanche.y) + TILE);
    // A churned crest so the snow reads as moving, not as a rising box.
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < w; i += 3) {
      const lift = Math.round(Math.sin(state.time * 9 + i * 0.7) * 2);
      ctx.fillRect(x + i, top + lift, 3, 5);
    }
  }

  for (const c of state.cacti) {
    drawSprite(ctx, r.cactus, c.x, c.y, CACTUS_W, CACTUS_H, camX, camY);
  }

  if (state.goal) {
    const pole = state.goal;
    ctx.fillStyle = "#8a5f33";
    ctx.fillRect(pole.x + 2 - camX, pole.y - camY, 3, pole.h);
    ctx.fillStyle = "#e0b070";
    ctx.fillRect(pole.x - camX, pole.y - 3 - camY, 7, 3);
    ctx.drawImage(r.flag.canvas, pole.x - 11 - camX, pole.y + 1 - camY);
  }

  for (const f of state.flowers) {
    if (f.taken) continue;
    const bob = Math.round(Math.sin(state.time * 4 + f.x) * 1.5);
    drawSprite(ctx, r.flower, f.x, f.y + bob, FLOWER_W, FLOWER_H, camX, camY);
    drawSparkle(
      ctx, f.x + FLOWER_W / 2, f.y + bob + FLOWER_H / 2, 10, state.time, f.x, camX, camY,
    );
  }

  for (const m of state.monstera) {
    if (m.taken) continue;
    // Leaning, with a slow rock on top so it reads as growing rather than pinned.
    const lean = hash(m.x) > 0.5 ? 1 : -1;
    const rock = Math.sin(state.time * 1.6 + m.x) * 0.05;
    drawTilted(
      ctx, r.monstera, m.x, m.y, MONSTERA_W, MONSTERA_H, camX, camY, lean * LEAF_TILT + rock,
    );
    drawSparkle(
      ctx, m.x + MONSTERA_W / 2, m.y + MONSTERA_H / 2, 14, state.time, m.y, camX, camY,
    );
  }

  for (const d of state.dogs) {
    if (!d.alive && d.squash <= 0) continue;
    const traits = BREEDS[d.breed];
    const side = d.vx > 0 ? 1 : 0;
    const poses = r.dog[d.breed];

    let sprite = r.dogSquashed;
    let nudge = 0;
    if (d.alive) {
      if (d.action === "scratch") {
        sprite = poses.scratch[side]!;
      } else if (d.action === "sniff") {
        sprite = poses.walk[side]!;
        // Nose to the ground, with a slow snuffle.
        nudge = 1 + (Math.floor(state.time * 6) % 2);
      } else {
        sprite = poses.walk[side]!;
      }
    }

    const dx = lerp(d.px, d.x, alpha);
    const dy = lerp(d.py, d.y, alpha) + nudge;
    drawSprite(ctx, sprite, dx, dy, traits.w, traits.h, camX, camY);

    // The hind leg is drawn on top and animated: at this size the motion is
    // what reads as scratching, not the pose.
    if (d.alive && d.action === "scratch") {
      const beat = Math.floor(state.time * 15) % 2;
      // Mirrored properly: the leg sits just behind the head on either side.
      const legX = Math.round(dx + (side === 1 ? traits.w - 7 : 5) - camX);
      // Reaching up to the ear, not floating above the dog.
      const legY = Math.round(dy - 1 + beat - camY);
      // Two segments with a kink: a straight bar reads as a post, not a leg.
      const toward = side === 1 ? 1 : -1;
      ctx.fillStyle = "#241a17";
      ctx.fillRect(legX - 1, legY + 3, 4, 6);
      ctx.fillRect(legX - 1 + toward, legY, 4, 5);
      ctx.fillStyle = FUR[d.breed];
      ctx.fillRect(legX, legY + 4, 2, 4);
      ctx.fillRect(legX + toward, legY + 1, 2, 4);
    }
  }

  drawGhost(r, state, camX, camY);

  if (outro) {
    // No boat at all on the shore ending, so the cat simply stays on the sand.
    const boat = outro.ending === "shore" ? null : r.boat[outro.ending];
    let deck = py;
    if (boat) {
      const bob = Math.round(Math.sin(state.time * 2.2) * 1.5);
      // Float the deck just above the waterline rather than sinking the hull.
      const hullY =
        outro.boatY !== null
          ? outro.boatY - HULL_DECK_ROW - 2 + bob
          : py + PLAYER_H - 20;
      // Step down so the cat stands on the deck, not in the sea.
      const deckTop = hullY + HULL_DECK_ROW - PLAYER_H;
      deck = py + (deckTop - py) * outro.board;
      ctx.drawImage(boat.canvas, Math.round(outro.boatX - camX), Math.round(hullY - camY));
    }
    // Trotting to the boat, then sitting once aboard.
    const stride = Math.floor(outro.t * 7) % 2;
    const frame = outro.aboard ? r.cat.idle[1]! : r.cat.run[stride * 2 + 1]!;
    drawSprite(ctx, frame, outro.catX, deck, PLAYER_W, PLAYER_H, camX, camY);
  } else {
    drawSprite(ctx, catFrame(r, state), px, py, PLAYER_W, PLAYER_H, camX, camY);
  }

  drawWeather(ctx, mixed, camX, state.time);
  drawHud(r, state, hud.best);

  if (state.phase === "won") {
    // Let the boat get clear before the banner covers the screen.
    if (outro && outro.t > CAST_OFF + 1.8) {
      const title = hud.beat && outro.ending !== "shore" ? "NEW BEST!" : ENDING_TITLE[outro.ending];
      const bonus = timeBonus(state.runTime);
      drawBanner(
        r,
        title,
        `${formatTime(state.runTime)}  SPEED BONUS ${bonus}`,
        `SCORE ${state.score}`,
        "PRESS R",
      );
    }
  }
}
