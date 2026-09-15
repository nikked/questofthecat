import {
  TILE,
  Tile,
  pixelHeight,
  pixelWidth,
  seasonAt,
  solidAt,
  tileAt,
  type Level,
  type Season,
} from "../core/level";
import {
  TRACE_HZ,
  MONSTERA_H,
  MONSTERA_W,
  BOSS_H,
  BOSS_W,
  DEBRIS_TIME,
  EXPLOSION_TIME,
  endingFor,
  playerHeight,
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

export const VIEW_W = 640;
export const VIEW_H = 360;

/**
 * The scenery behind the play plane is drawn at half resolution and scaled up.
 * It is distant and hazed, so the softer pixels read as depth rather than as a
 * lower budget, and every hand-tuned constant in it keeps its original units.
 */
const BG_SCALE = 2;
const BG_W = VIEW_W / BG_SCALE;
const BG_H = VIEW_H / BG_SCALE;

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
  readonly cat: {
    idle: Sprite[];
    run: Sprite[];
    jump: Sprite[];
    cling: Sprite[];
    spin: Sprite[];
    slide: Sprite[];
    slam: Sprite[];
  };
  readonly boss: Sprite[];
  readonly vignette: CanvasGradient;
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
  readonly fontDim: Font;
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
          x: tx * TILE + slot * 10 + Math.floor(hash(tx + slot * 17) * 6),
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
        out.push({ x: tx * TILE - 16, y: ty * TILE, season, variant: 0, tree: true, leaf: false });
      }
      break;
    }
  }

  for (let i = 0; i < Math.min(grown, 60) && surfaces.length > 0; i++) {
    const spot = surfaces[Math.floor(hash(i * 53 + 11) * surfaces.length)];
    if (spot) out.push({ ...spot, x: spot.x + Math.floor(hash(i * 31) * 16) - 8 });
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
  const hedgehog = bake(art.HEDGEHOG);
  const wasp = bake(art.WASP);
  const boss = bake(art.BOSS);
  const spin = bake(art.CAT_SPIN);
  const slide = bake(art.CAT_SLIDE);
  const slam = bake(art.CAT_SLAM);

  // Darkening the corners is most of what stops a flat 2D frame reading flat.
  const vignette = ctx.createRadialGradient(
    VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.34,
    VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.72,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(24, 12, 4, 0.34)");

  return {
    ctx,
    cat: {
      idle: [flip(idle), idle],
      run: [flip(runA), runA, flip(runB), runB],
      jump: [flip(jump), jump],
      cling: [flip(cling), cling],
      spin: [flip(spin), spin],
      slide: [flip(slide), slide],
      slam: [flip(slam), slam],
    },
    // Authored facing left, so the pair is the other way round to the rest.
    boss: [boss, flip(boss)],
    vignette,
    dog: {
      terrier: { walk: [flip(dog), dog], scratch: [flip(dogScratch), dogScratch] },
      retriever: {
        walk: [flip(retriever), retriever],
        scratch: [flip(retrieverScratch), retrieverScratch],
      },
      hedgehog: { walk: [flip(hedgehog), hedgehog], scratch: [flip(hedgehog), hedgehog] },
      wasp: { walk: [flip(wasp), wasp], scratch: [flip(wasp), wasp] },
    },
    dogSquashed: bake(art.DOG_SQUASHED),
    flower: bake(art.FLOWER),
    flag: bake(art.FLAG),
    tiles: new Map([
      [Tile.Ground, bake(art.GROUND)],
      [Tile.Brick, bake(art.LOG)],
      [Tile.Sand, bake(art.SAND)],
      [Tile.CratePlain, bake(art.CRATE_PLAIN)],
      [Tile.CrateTnt, bake(art.CRATE_TNT)],
      [Tile.CrateNitro, bake(art.CRATE_NITRO)],
      [Tile.CrateBounce, bake(art.CRATE_BOUNCE)],
      [Tile.CrateCheck, bake(art.CRATE_CHECK)],
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
      idle: flip(bake(art.FLAG, { y: "#9aa7ad", e: "#6d7a80" })),
      taken: flip(bake(art.FLAG, { y: "#8ce66a", e: "#3f9a49" })),
    },
    fontLight: bakeFont("#fff6e2"),
    fontDark: bakeFont("#2a1c14"),
    fontDim: bakeFont("#9a8977"),
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
    const x = (((i * 71) % (BG_W + 24)) - camX * 0.4 + sway) % (BG_W + 24);
    const y = ((i * 43 + time * best.fall) % (BG_H + 20)) - 10;
    ctx.fillStyle = best.colors[i % 2]!;
    const size = best.size === 1 && i % 3 === 0 ? 2 : best.size;
    ctx.fillRect(Math.round(x < 0 ? x + BG_W + 24 : x) - 12, Math.round(y), size, size);
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
  for (let x = -160; x < span + 160; x += 18) {
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
  for (let x = 400; x < span * 1.2; x += 600) {
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
    const x = tree.x / BG_SCALE - camX * speed;
    if (x < -30 || x > BG_W + 30) continue;

    // Parallax slides trees relative to the world, so the species has to come
    // from where the tree is drawn, not from the x it was generated at.
    const worldX = (camX + x) * BG_SCALE;
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

    for (let x = 0; x < BG_W; x += 2) {
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
    const x = wx / BG_SCALE - camX * RIDGE_FAR_PARALLAX;
    if (x < -12 || x > BG_W + 12) continue;
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

  // Posterised rather than smooth, with an ordered dither across each seam:
  // a clean gradient is the one thing no game of this era could draw.
  const BANDS = 14;
  const bandH = Math.ceil(BG_H / BANDS);
  for (let b = 0; b < BANDS; b++) {
    ctx.fillStyle = css(mix(palette.sky, palette.horizon, b / (BANDS - 1)));
    ctx.fillRect(0, b * bandH, BG_W, bandH);
    if (b === 0) continue;
    ctx.fillStyle = css(mix(palette.sky, palette.horizon, (b - 0.5) / (BANDS - 1)));
    for (let x = (b % 2) * 2; x < BG_W; x += 4) ctx.fillRect(x, b * bandH, 2, 2);
  }

  // Sun rides just above the treeline, which is what sells the autumn sunset.
  const sunX = ((BG_W * 1.4 - camX * 0.12) % (BG_W + 160)) - 40;
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
  ctx.fillRect(x, top, VIEW_W - x, 12);

  ctx.fillStyle = "#bfe4f6";
  for (let i = x; i < VIEW_W; i += 4) {
    const lift = Math.round(Math.sin(state.time * 2.6 + i * 0.07) * 3.2);
    ctx.fillRect(i, top + lift, 4, 4);
  }
  // A thin line of foam where the sea meets the sand.
  ctx.fillStyle = "#eaf6fd";
  ctx.fillRect(x, top + 4 + Math.round(Math.sin(state.time * 3) * 2), Math.min(20, VIEW_W - x), 4);
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
      const index = ty * level.width + tx;
      const bump = state.bumps.get(index) ?? 0;
      const lift = bump > 0 ? Math.round(Math.sin((bump / 0.18) * Math.PI) * 10) : 0;
      const x = tx * TILE - camX;
      const y = ty * TILE - camY - lift;
      r.ctx.drawImage(sprite.canvas, x, y);

      // A lit fuse flashes faster as it runs out; it is the only warning there is.
      const fuse = state.crates.get(index)?.fuse ?? 0;
      if (fuse > 0) {
        const urgency = 1 + (1 - fuse / 3) * 8;
        if (Math.floor(state.time * urgency * 3) % 2 === 0) {
          r.ctx.globalAlpha = 0.45;
          r.ctx.fillStyle = "#fff4d0";
          r.ctx.fillRect(x, y, TILE, TILE);
          r.ctx.globalAlpha = 1;
        }
      }
    }
  }
}

/** How far a body can be off the ground before its shadow stops reading. */
const SHADOW_REACH = 200;

/**
 * An elliptical shadow that shrinks and fades with height. Cheap, and it does
 * more for the sense of a third dimension than any amount of sprite detail.
 */
function drawShadow(
  ctx: CanvasRenderingContext2D,
  level: Level,
  x: number,
  y: number,
  w: number,
  h: number,
  camX: number,
  camY: number,
): void {
  const left = Math.floor(x / TILE);
  const right = Math.floor((x + w - 1) / TILE);
  let floor: number | null = null;
  for (let ty = Math.floor((y + h) / TILE); ty < level.height; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (solidAt(level, tx, ty)) {
        floor = ty * TILE;
        break;
      }
    }
    if (floor !== null) break;
  }
  if (floor === null) return;

  const drop = floor - (y + h);
  if (drop > SHADOW_REACH) return;
  const near = 1 - Math.max(0, drop) / SHADOW_REACH;
  const rx = (w / 2) * (0.5 + near * 0.5);

  ctx.globalAlpha = 0.14 + near * 0.28;
  ctx.fillStyle = "#180f06";
  ctx.beginPath();
  ctx.ellipse(x + w / 2 - camX, floor + 3 - camY, rx, rx * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Splinters thrown out of whatever just came apart. */
function drawDebris(r: Renderer, state: GameState, camX: number, camY: number): void {
  const ctx = r.ctx;
  for (const piece of state.debris) {
    const explosive = piece.tile === Tile.CrateNitro || piece.tile === Tile.CrateTnt;
    const t = 1 - piece.life / (explosive ? EXPLOSION_TIME : DEBRIS_TIME);
    if (explosive) {
      const x = piece.x + TILE / 2 - camX;
      const y = piece.y + TILE / 2 - camY;
      const radius = TILE * (0.5 + t * 2);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = piece.tile === Tile.CrateNitro ? "#baff45" : "#ff922e";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fffbd6";
      ctx.beginPath();
      ctx.arc(x, y, radius * (1 - t) * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fffbd6";
      ctx.lineWidth = 4 * (1 - t);
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.25, 0, Math.PI * 2);
      ctx.stroke();
    }
    const sprite = r.tiles.get(piece.tile);
    ctx.globalAlpha = Math.max(0, 1 - t * 1.2);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + piece.x;
      const dist = t * (explosive ? 110 : 40);
      const px = piece.x + TILE / 2 + Math.cos(angle) * dist - camX;
      const py = piece.y + TILE / 2 + Math.sin(angle) * dist + t * t * 60 - camY;
      ctx.fillStyle = explosive ? "#fff18a" : sprite ? "#d8a24a" : "#a9762c";
      ctx.fillRect(Math.round(px), Math.round(py), 6, 6);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Blades rooted below the frame. Only their tips cross the play plane, so
 * nothing the player has to see can hide behind them.
 */
const OCCLUDER_PARALLAX = 1.28;
const OCCLUDER_SPACING = 96;

function drawOccluders(r: Renderer, camX: number, palette: Palette): void {
  const ctx = r.ctx;
  // Faint and shallow: depth cue only, never something a hazard can hide behind.
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = css(mix(palette.hillNear, [14, 10, 8], 0.55));
  const shift = camX * OCCLUDER_PARALLAX;
  const first = Math.floor(shift / OCCLUDER_SPACING) - 1;

  for (let i = first; i < first + Math.ceil(VIEW_W / OCCLUDER_SPACING) + 3; i++) {
    const x = Math.round(i * OCCLUDER_SPACING + hash(i * 17) * 50 - shift);
    if (x < -70 || x > VIEW_W + 70) continue;
    const tuft = 12 + hash(i * 31) * 16;
    for (let b = 0; b < 5; b++) {
      const root = x + b * 9 - 18;
      const lean = (hash(i * 7 + b * 3) - 0.5) * 16;
      const height = tuft * (0.55 + hash(i * 3 + b) * 0.7);
      ctx.beginPath();
      ctx.moveTo(root, VIEW_H);
      ctx.lineTo(root + lean, VIEW_H - height);
      ctx.lineTo(root + 7, VIEW_H);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** A warm pass and darkened corners, over the finished frame. */
function drawGrade(r: Renderer): void {
  const ctx = r.ctx;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = "rgba(255, 166, 84, 0.10)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = r.vignette;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function catFrame(r: Renderer, state: GameState): Sprite {
  const p = state.player;
  const side = p.facing > 0 ? 1 : 0;

  if (state.phase === "dying") return r.cat.jump[side]!;
  // A spin flips every couple of frames, which is what reads as spinning.
  if (p.action === "spin") return r.cat.spin[Math.floor(state.time * 30) % 2]!;
  if (p.action === "slide") return r.cat.slide[side]!;
  if (p.action === "slam" || p.action === "recover") return r.cat.slam[side]!;
  if (p.cling !== 0) return r.cat.cling[side]!;
  if (!p.grounded) return r.cat.jump[side]!;
  if (Math.abs(p.vx) < 2) return r.cat.idle[side]!;

  const frame = Math.floor(p.runTime / 18) % 2;
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
    ctx.fillRect(x, y, 2, 2);
    if (big) {
      // A four-armed twinkle rather than a plain dot.
      ctx.fillRect(x - 2, y, 2, 2);
      ctx.fillRect(x + 2, y, 2, 2);
      ctx.fillRect(x, y - 2, 2, 2);
      ctx.fillRect(x, y + 2, 2, 2);
    }
  }
}

function drawHud(r: Renderer, state: GameState, best: number | null): void {
  const ctx = r.ctx;
  const fields = [
    `SCORE ${String(state.score).padStart(5, "0")}`,
    `BEST ${best === null ? "-----" : String(best).padStart(5, "0")}`,
    `TIME ${formatTime(state.runTime)}`,
    `LIVES ${state.lives}`,
  ];

  ctx.fillStyle = "rgba(20, 14, 10, 0.45)";
  ctx.fillRect(0, 0, VIEW_W, 22);
  let x = 10;
  for (const field of fields) {
    drawText(ctx, r.fontLight, field, x, 6);
    x += textWidth(field) + 14;
  }
}

function drawBanner(r: Renderer, title: string, ...lines: readonly string[]): void {
  const ctx = r.ctx;
  const width = Math.max(textWidth(title), ...lines.map(textWidth)) + 48;
  const height = 44 + lines.length * 20;
  const x = Math.round((VIEW_W - width) / 2);
  const y = Math.round(VIEW_H / 2 - height / 2);

  ctx.fillStyle = "rgba(20, 14, 10, 0.72)";
  ctx.fillRect(x, y, width, height);
  drawText(ctx, r.fontLight, title, Math.round((VIEW_W - textWidth(title)) / 2), y + 16);
  lines.forEach((line, i) => {
    drawText(ctx, r.fontLight, line, Math.round((VIEW_W - textWidth(line)) / 2), y + 40 + i * 20);
  });
}

/**
 * The pause screen includes the controls, so it
 * carries the whole scheme rather than a reminder of it. The pad column leads:
 * this is a pad game, and the keyboard is the fallback. The font has no button
 * glyphs, which is no loss — names read faster than symbols anyway.
 */
type ControlRow = readonly [action: string, pad: string, keyboard: string];

const CONTROL_ROWS: readonly ControlRow[] = [
  ["", "PS5 PAD", "KEYBOARD"],
  ["MOVE", "STICK OR D-PAD", "ARROWS OR WASD"],
  ["RUN", "R2", "SHIFT"],
  ["JUMP", "CROSS", "SPACE"],
  ["SPIN", "SQUARE", "X OR K"],
  ["SLIDE", "CIRCLE", "DOWN WHEN RUNNING"],
  ["BODY SLAM", "DOWN IN THE AIR", "DOWN IN THE AIR"],
  ["PAUSE", "OPTIONS", "ESC"],
  ["RESTART", "", "R"],
];

/** The three things about the moveset that are not obvious from a key list. */
const PAUSE_NOTES: readonly string[] = [
  "HOLD INTO A WALL IN MID-AIR TO CLING THEN JUMP",
  "A SPIN CANCELS INTO A JUMP. A SLIDE NEEDS SPEED",
  "SLIDE UNDER A ROOF TOO LOW TO STAND UP IN",
];

/** The pause screen's actionable half. Index into this is what main.ts tracks. */
export const PAUSE_MENU: readonly string[] = ["RESUME", "RESTART", "MAIN MENU"];

const PAUSE_LINE_H = 16;
const PAUSE_MENU_H = 20;
const PAUSE_COL_GAP = textWidth("   ");

export function drawPause(r: Renderer, best: number | null, selected: number): void {
  const ctx = r.ctx;
  ctx.fillStyle = "rgba(16, 12, 9, 0.62)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const cols = [0, 1, 2].map((c) =>
    Math.max(...CONTROL_ROWS.map((row) => textWidth(row[c]!))),
  );
  const tableW = cols[0]! + cols[1]! + cols[2]! + PAUSE_COL_GAP * 2;
  const best_ = `BEST ${best === null ? "-----" : String(best).padStart(5, "0")}`;
  const width =
    Math.max(tableW, ...PAUSE_NOTES.map(textWidth), textWidth(best_)) + 48;
  const height =
    52 +
    PAUSE_MENU.length * PAUSE_MENU_H +
    16 +
    CONTROL_ROWS.length * PAUSE_LINE_H +
    12 +
    PAUSE_NOTES.length * PAUSE_LINE_H +
    24;
  const x = Math.round((VIEW_W - width) / 2);
  const y = Math.round((VIEW_H - height) / 2);

  ctx.fillStyle = "rgba(20, 14, 10, 0.86)";
  ctx.fillRect(x, y, width, height);
  drawText(ctx, r.fontLight, "PAUSED", Math.round((VIEW_W - textWidth("PAUSED")) / 2), y + 16);

  // The menu first: it is the only part of this screen you can act on.
  let row = y + 44;
  PAUSE_MENU.forEach((item, i) => {
    const on = i === selected;
    const w = textWidth(item);
    const itemX = Math.round((VIEW_W - w) / 2);
    if (on) {
      ctx.fillStyle = "#e8933c";
      ctx.fillRect(itemX - 22, row + 1, 10, 10);
      ctx.fillRect(itemX + w + 12, row + 1, 10, 10);
    }
    drawText(ctx, on ? r.fontLight : r.fontDim, item, itemX, row);
    row += PAUSE_MENU_H;
  });
  row += 16;

  // The table is left-aligned in its own block, centred as a whole.
  const left = Math.round((VIEW_W - tableW) / 2);
  const starts = [left, left + cols[0]! + PAUSE_COL_GAP, left + cols[0]! + cols[1]! + PAUSE_COL_GAP * 2];
  CONTROL_ROWS.forEach(([action, pad, keyboard], i) => {
    // The header names the columns and should not compete with them.
    const font = i === 0 ? r.fontDim : r.fontLight;
    drawText(ctx, font, action, starts[0]!, row);
    drawText(ctx, font, pad, starts[1]!, row);
    // The keyboard is the fallback, and reads as one.
    drawText(ctx, r.fontDim, keyboard, starts[2]!, row);
    row += PAUSE_LINE_H;
  });

  row += 12;
  for (const note of PAUSE_NOTES) {
    drawText(ctx, r.fontDim, note, Math.round((VIEW_W - textWidth(note)) / 2), row);
    row += PAUSE_LINE_H;
  }
  drawText(ctx, r.fontLight, best_, Math.round((VIEW_W - textWidth(best_)) / 2), row + 10);
}

/** Coat colour, for the scratching leg drawn over the sprite. */
const FUR: Readonly<Record<Breed, string>> = {
  terrier: "#c08a55",
  retriever: "#e6c88b",
  hedgehog: "#6b5f57",
  wasp: "#f2c53d",
};

const ENDING_TITLE: Readonly<Record<Ending, string>> = {
  shore: "NEXT YEAR, THEN",
  raft: "OFF YOU GO",
  sailboat: "FAIR WINDS",
  ship: "WHAT A YEAR!",
};

export type Hud = {
  /** The shared leaderboard score this run is trying to beat. */
  readonly best: number | null;
  /** Whether this run has already beaten the best it started with. */
  readonly beat: boolean;
};

/** Outro beats, in seconds since the flag was touched. */
const WALK_TO_BOAT = 0.4;
const BOARDED = 1.6;
const CAST_OFF = 2.6;
export const OUTRO_COMPLETE = CAST_OFF + 1.8;
const BOAT_SPEED = 104;
/** Row 8 of every hull sprite is its deck, whatever the sprite's height. */
const HULL_DECK_ROW = 16;

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
  const ending = endingFor(state.score);
  const water = state.level.water;
  // Moored just off the beach, not floating over the grass.
  const dock = water ? water.fromTile * TILE + 20 : state.goal.x + 68;
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
  ctx.save();
  ctx.scale(BG_SCALE, BG_SCALE);
  drawBackground(r, state.level, mixed, camX / BG_SCALE, camY / BG_SCALE, palette, state.time);
  ctx.restore();
  drawDecorations(r, camX, camY, true);
  drawTiles(r, state, camX, camY);
  drawDecorations(r, camX, camY, false);
  drawWater(r, state, camX, camY);

  if (state.avalanche.active && state.chimney) {
    const shaft = state.chimney;
    const top = Math.round(state.avalanche.y - camY);
    const x = Math.round(shaft.left - camX);
    const w = shaft.right - shaft.left;
    ctx.fillStyle = "#eef6fc";
    ctx.fillRect(x, top + 6, w, Math.round(shaft.floorY - state.avalanche.y) + TILE);
    // A churned crest so the snow reads as moving, not as a rising box.
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < w; i += 6) {
      const lift = Math.round(Math.sin(state.time * 9 + i * 0.35) * 4);
      ctx.fillRect(x + i, top + lift, 6, 10);
    }
  }

  // A checkpoint flies a flag on a pole three tiles tall, so a season's bank
  // point is visible from across the screen — and stays visible once the crate
  // under it is gone, raised and green instead of grey at half mast.
  for (const post of state.posts) {
    const tx = Math.floor(post.x / TILE);
    const ty = Math.floor(post.y / TILE);
    const banked = tileAt(state.level, tx, ty) !== Tile.CrateCheck;
    const poleTop = post.y - TILE * 3;
    // Centred on the crate tile: TILE / 2 less half the pole's own width.
    const poleX = Math.round(post.x + TILE / 2 - 3 - camX);

    ctx.fillStyle = banked ? "#8a5f33" : "#5e5044";
    ctx.fillRect(poleX, Math.round(poleTop - camY), 5, TILE * 3 + (banked ? TILE : 0));
    ctx.fillStyle = banked ? "#e0b070" : "#8d7d72";
    ctx.fillRect(poleX - 3, Math.round(poleTop - camY), 11, 5);

    const flag = banked ? r.post.taken : r.post.idle;
    // At half mast until the crate is broken, at the top once it is.
    const lift = banked ? 4 : TILE + 8;
    ctx.drawImage(flag.canvas, poleX + 5, Math.round(poleTop + lift - camY));
  }

  drawDebris(r, state, camX, camY);

  for (const c of state.cacti) {
    drawShadow(ctx, state.level, c.x, c.y, CACTUS_W, CACTUS_H, camX, camY);
    drawSprite(ctx, r.cactus, c.x, c.y, CACTUS_W, CACTUS_H, camX, camY);
  }

  if (state.goal) {
    const pole = state.goal;
    ctx.fillStyle = "#8a5f33";
    ctx.fillRect(pole.x + 4 - camX, pole.y - camY, 6, pole.h);
    ctx.fillStyle = "#e0b070";
    ctx.fillRect(pole.x - camX, pole.y - 6 - camY, 14, 6);
    ctx.drawImage(r.flag.canvas, pole.x - 22 - camX, pole.y + 2 - camY);
  }

  for (const f of state.flowers) {
    if (f.taken) continue;
    const bob = Math.round(Math.sin(state.time * 4 + f.x) * 3);
    drawSprite(ctx, r.flower, f.x, f.y + bob, FLOWER_W, FLOWER_H, camX, camY);
    drawSparkle(
      ctx, f.x + FLOWER_W / 2, f.y + bob + FLOWER_H / 2, 20, state.time, f.x, camX, camY,
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
      ctx, m.x + MONSTERA_W / 2, m.y + MONSTERA_H / 2, 28, state.time, m.y, camX, camY,
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
        nudge = 2 + (Math.floor(state.time * 6) % 2) * 2;
      } else {
        sprite = poses.walk[side]!;
      }
    }

    const dx = lerp(d.px, d.x, alpha);
    const dy = lerp(d.py, d.y, alpha) + nudge;
    if (d.alive) drawShadow(ctx, state.level, dx, dy, traits.w, traits.h, camX, camY);
    drawSprite(ctx, sprite, dx, dy, traits.w, traits.h, camX, camY);

    // The hind leg is drawn on top and animated: at this size the motion is
    // what reads as scratching, not the pose.
    if (d.alive && d.action === "scratch") {
      const beat = Math.floor(state.time * 15) % 2;
      // Mirrored properly: the leg sits just behind the head on either side.
      const legX = Math.round(dx + (side === 1 ? traits.w - 14 : 10) - camX);
      // Reaching up to the ear, not floating above the dog.
      const legY = Math.round(dy - 2 + beat * 2 - camY);
      // Two segments with a kink: a straight bar reads as a post, not a leg.
      const toward = side === 1 ? 2 : -2;
      ctx.fillStyle = "#3a2a22";
      ctx.fillRect(legX - 2, legY + 6, 8, 12);
      ctx.fillRect(legX - 2 + toward, legY, 8, 10);
      ctx.fillStyle = FUR[d.breed];
      ctx.fillRect(legX, legY + 8, 4, 8);
      ctx.fillRect(legX + toward, legY + 2, 4, 8);
    }
  }

  const boss = state.boss;
  if (boss && boss.mode !== "dead") {
    const bx = lerp(boss.px, boss.x, alpha);
    const by = lerp(boss.py, boss.y, alpha);
    // Braced low through a charge, and shaking while it is dazed.
    const dazed = boss.mode === "stunned" || boss.mode === "hurt";
    const shake = dazed ? Math.round(Math.sin(state.time * 40) * 2) : 0;
    const side = boss.facing > 0 ? 1 : 0;
    drawShadow(ctx, state.level, bx, by, BOSS_W, BOSS_H, camX, camY);
    drawSprite(ctx, r.boss[side]!, bx + shake, by, BOSS_W, BOSS_H, camX, camY);

    if (dazed) {
      // Stars, so the one window you can hit it in is unmissable.
      for (let i = 0; i < 3; i++) {
        const a = state.time * 4 + (i / 3) * Math.PI * 2;
        const sx = Math.round(bx + BOSS_W / 2 + Math.cos(a) * 26 - camX);
        const sy = Math.round(by - 12 + Math.sin(a) * 7 - camY);
        ctx.fillStyle = "#ffd34d";
        ctx.fillRect(sx - 2, sy, 6, 2);
        ctx.fillRect(sx, sy - 2, 2, 6);
      }
    }

    // Phases left, as a row of pips over its back.
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < boss.phase ? "#4a3a30" : "#e05a4a";
      ctx.fillRect(Math.round(bx + 8 + i * 14 - camX), Math.round(by - 26 - camY), 10, 6);
    }
  }

  drawGhost(r, state, camX, camY);

  if (outro) {
    // No boat at all on the shore ending, so the cat simply stays on the sand.
    const boat = outro.ending === "shore" ? null : r.boat[outro.ending];
    let deck = py;
    if (boat) {
      const bob = Math.round(Math.sin(state.time * 2.2) * 3);
      // Float the deck just above the waterline rather than sinking the hull.
      const hullY =
        outro.boatY !== null
          ? outro.boatY - HULL_DECK_ROW - 4 + bob
          : py + PLAYER_H - 40;
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
    const boxH = playerHeight(state.player);
    drawShadow(ctx, state.level, px, py, PLAYER_W, boxH, camX, camY);
    drawSprite(ctx, catFrame(r, state), px, py, PLAYER_W, boxH, camX, camY);
  }

  drawOccluders(r, camX, palette);

  ctx.save();
  ctx.scale(BG_SCALE, BG_SCALE);
  drawWeather(ctx, mixed, camX / BG_SCALE, state.time);
  ctx.restore();

  drawGrade(r);
  drawHud(r, state, hud.best);

  if (state.phase === "won") {
    // Let the boat get clear before the banner covers the screen.
    if (outro && outro.t > OUTRO_COMPLETE) {
      const title = hud.beat && outro.ending !== "shore" ? "NEW BEST!" : ENDING_TITLE[outro.ending];
      // The breakdown is in the name dialog, where it stays readable on a phone.
      drawBanner(r, title, `SCORE ${state.score}`, "PRESS R");
    }
  }
}

export function drawMainMenu(r: Renderer, time: number): void {
  const ctx = r.ctx;
  ctx.fillStyle = "#152338";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  for (let i = 0; i < 65; i++) {
    const x = Math.floor(hash(i * 7) * VIEW_W);
    const y = Math.floor(hash(i * 13 + 2) * 230);
    ctx.globalAlpha = 0.3 + (Math.sin(time * 1.5 + i) + 1) * 0.3;
    ctx.fillStyle = "#fff0cb";
    ctx.fillRect(x, y, i % 5 === 0 ? 3 : 2, 2);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#f4ddb0";
  ctx.beginPath();
  ctx.arc(535, 65, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#152338";
  ctx.beginPath();
  ctx.arc(524, 57, 24, 0, Math.PI * 2);
  ctx.fill();

  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = ["#243d50", "#2b5058", "#193e45"][layer]!;
    ctx.beginPath();
    ctx.moveTo(0, VIEW_H);
    for (let x = 0; x <= VIEW_W; x += 8) {
      const y = 225 + layer * 36 + Math.sin(x / (90 - layer * 15) + layer * 2 + time * 0.025) * 26;
      ctx.lineTo(x, Math.round(y));
    }
    ctx.lineTo(VIEW_W, VIEW_H);
    ctx.fill();
  }
  ctx.fillStyle = "#102b34";
  for (const x of [20, 70, 570, 620]) drawPine(ctx, x, 320, 80 + hash(x) * 70);
  ctx.fillStyle = "#50745a";
  ctx.fillRect(0, 318, VIEW_W, 6);
  ctx.fillStyle = "#132a30";
  ctx.fillRect(0, 324, VIEW_W, 36);
  const cat = r.cat.idle[1]!;
  ctx.drawImage(cat.canvas, 82, 264 + Math.round(Math.sin(time * 2) * 2), PLAYER_W * 2, PLAYER_H * 2);
  for (let i = 0; i < 12; i++) {
    const x = hash(i * 9 + 1) * VIEW_W + Math.sin(time + i) * 10;
    const y = 285 + Math.sin(time * 0.6 + i * 2) * 24;
    ctx.globalAlpha = 0.25 + (Math.sin(time * 2 + i) + 1) * 0.3;
    ctx.fillStyle = "#f7df85";
    ctx.fillRect(Math.round(x), Math.round(y), 3, 3);
  }
  ctx.globalAlpha = 1;
  drawGrade(r);
}
