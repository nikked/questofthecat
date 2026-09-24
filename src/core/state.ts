import {
  TILE,
  Tile,
  breakableByVerb,
  isCrate,
  parseLevel,
  pixelHeight,
  seasonAt,
  solidAt,
  tileAt,
  type Level,
  type LevelSource,
  type Season,
} from "./level";
import {
  COYOTE_TIME,
  FALL_GRAVITY,
  ICE,
  SOLID,
  JUMP_BUFFER,
  JUMP_CUT,
  JUMP_SPEED,
  SLAM_RECOVER,
  SLAM_SPEED,
  SLIDE_H,
  SLIDE_JUMP_X,
  SLIDE_JUMP_Y,
  SLIDE_MIN_SPEED,
  SLIDE_SPEED,
  SLIDE_TIME,
  SPIN_CANCEL,
  SPIN_COOLDOWN,
  SPIN_REACH,
  SPIN_TIME,
  STOMP_BOUNCE,
  WALL_COYOTE,
  WALL_JUMP_X,
  WALL_JUMP_Y,
  WALL_LOCK,
  WALL_REACH,
  WALL_SLIDE_SPEED,
  NO_INPUT,
  fallSpeed,
  horizontalSpeed,
  inputDirection,
  jumpGravity,
  wallContact,
  overlaps,
  sweepX,
  sweepY,
  type Input,
  type Rect,
  type Side,
  type Surface,
  type Sweep,
} from "./physics";

export const PLAYER_W = 22;
/**
 * Taller than one 32px tile on purpose. At an exact 2x of the old 14 the cat
 * would be 28 and fit standing through a one-tile gap, which would leave the
 * slide with no geometry that ever requires it.
 */
export const PLAYER_H = 34;
export type Breed = "terrier" | "retriever" | "hedgehog" | "wasp";

/**
 * Which verbs answer this enemy. This table is the whole of the combat design:
 * a retriever is where you learn spin is not optional, a hedgehog is where you
 * learn slide is not decorative.
 */
export type BreedTraits = {
  readonly w: number;
  readonly h: number;
  readonly speed: number;
  /** How often it stops to be an animal rather than a hazard. */
  readonly fidget: number;
  readonly spin: boolean;
  readonly stomp: boolean;
  /** Whether a sliding cat passes under it safely. */
  readonly slidePass: boolean;
  /** Flies a fixed sine path instead of walking a platform. */
  readonly flies: boolean;
};

export const BREEDS: Readonly<Record<Breed, BreedTraits>> = {
  terrier: { w: 28, h: 24, speed: 56, fidget: 0.5, spin: true, stomp: true, slidePass: false, flies: false },
  retriever: { w: 36, h: 28, speed: 38, fidget: 0.35, spin: true, stomp: false, slidePass: false, flies: false },
  hedgehog: { w: 26, h: 22, speed: 34, fidget: 0.6, spin: false, stomp: false, slidePass: true, flies: false },
  wasp: { w: 24, h: 20, speed: 62, fidget: 0, spin: true, stomp: false, slidePass: false, flies: true },
};

export const FLOWER_W = 20;
export const FLOWER_H = 20;
export const MONSTERA_W = 28;
export const MONSTERA_H = 28;
/** A monstera is worth an armful of ordinary flowers. */
export const MONSTERA_VALUE = 5;
export const FLOWER_POINTS = 100;
export const MONSTERA_POINTS = 500;
export const STOMP_POINTS = 300;
export const GOAL_POINTS = 1000;
export const LIFE_BONUS_POINTS = 2500;
export const BOSS_POINTS = 5000;
const TIME_BONUSES: readonly (readonly [seconds: number, points: number])[] = [
  [30, 30000], [40, 20000], [50, 10000], [60, 5000],
  [70, 2500], [80, 1500], [90, 500], [95, 0],
];

export const CACTUS_W = 24;
export const CACTUS_H = 28;
export const STARTING_LIVES = 9;
/** Long enough for the death to read, short enough not to be a wait. */
export const DEATH_BEAT = 0.35;

export const SAFE_AREA_MARGIN = 2 * TILE;
export const EXPLOSION_TIME = 0.65;
export const TNT_FUSE = 3;
/** A crate caught in a blast goes off faster than one you armed yourself. */
export const TNT_CHAIN_FUSE = 0.35;
/** How many bounces a bounce crate survives before it breaks like any other. */
export const BOUNCE_LIMIT = 4;
export const BOUNCE_SPEED = 900;
/** Each bounce goes higher, so the crate is a route and a countdown at once. */
export const BOUNCE_STEP = 130;
/** Slamming a bounce crate skips straight to the top of its range. */
export const SLAM_BOUNCE_BONUS = 180;
export const FLOWERS_PER_LIFE = 100;
/** How long a broken crate's debris is drawn for. */
export const DEBRIS_TIME = 0.4;

export const BOSS_W = 56;
export const BOSS_H = 40;
export const BOSS_PHASES = 3;
export const BOSS_CHARGE_SPEED = 300;
/** The window the fight is actually won in. */
export const BOSS_STUN_TIME = 2.2;
/** Down for a while after a hit, so landing one is not straight back to dodging. */
export const BOSS_HURT_TIME = 3;
export const BOSS_WIND_UP = 0.9;

/** Each verb is a fixed-length action, so nothing can get stuck in a pose. */
export type Action = "none" | "spin" | "slide" | "slam" | "recover";

export type Player = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  coyote: number;
  buffer: number;
  jumpHeld: boolean;
  runTime: number;
  dying: number;
  /** Wall the cat is currently gripping: -1 to its left, 1 to its right. */
  cling: Side;
  /** The wall it last gripped, held alive for `wallCoyote` seconds. */
  wallSide: Side;
  wallCoyote: number;
  wallLock: number;
  action: Action;
  actionTime: number;
  spinCooldown: number;
  /** Verbs fire on the press, never on the hold. */
  spinHeld: boolean;
  downHeld: boolean;
  slideHeld: boolean;
  /** Set when a slide's sweep hit something, so the next frame can react. */
  slideBlocked: boolean;
};

/** What an enemy is doing right now. Only `walk` moves it. */
export type DogAction = "walk" | "scratch" | "sniff";

export type Dog = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  alive: boolean;
  squash: number;
  readonly breed: Breed;
  action: DogAction;
  actionTime: number;
  /** Carried per enemy so behaviour is varied but replays identically. */
  seed: number;
  /** The height a wasp sines around; unused by anything that walks. */
  readonly homeY: number;
  /** Clock for the wasp's sine, kept per enemy so they are not in lockstep. */
  flyClock: number;
};

export type Flower = {
  readonly x: number;
  readonly y: number;
  taken: boolean;
};

/** The mutable half of a crate. Crates that are doing nothing are not in the map. */
export type Crate = {
  /** Seconds until a TNT goes off. Zero means unlit. */
  fuse: number;
  bounces: number;
};

/**
 * Where a checkpoint crate started. Breaking one clears its tile, so the flag
 * that marks the season needs its own record to keep standing afterwards.
 */
export type Post = {
  readonly x: number;
  readonly y: number;
};

export type Debris = {
  readonly x: number;
  readonly y: number;
  readonly tile: Tile;
  life: number;
};

export type BossMode = "wait" | "charge" | "stunned" | "hurt" | "dead";

export type Boss = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  readonly homeX: number;
  readonly floorY: number;
  mode: BossMode;
  modeTime: number;
  /** Counts up: the fight is over at BOSS_PHASES. */
  phase: number;
  facing: 1 | -1;
};

/** The shaft the avalanche fills, resolved from the level's tiles. */
export type Chimney = {
  readonly left: number;
  readonly right: number;
  /** Top surface of the shaft floor, where the snow starts. */
  readonly floorY: number;
  /** Clear of the confining walls: above this the cat has escaped. */
  readonly exitY: number;
};

export type Avalanche = {
  active: boolean;
  y: number;
};

export const AVALANCHE_SPEED = 68;
/** Ghost samples per second. Coarse enough to store, fine enough to read. */
export const TRACE_HZ = 30;
/** The snow starts below the floor, so entering the shaft is not instant death. */
export const AVALANCHE_GRACE = 160;

export type Phase = "playing" | "dying" | "won";

export type Sound =
  | "jump"
  | "land"
  | "grip"
  | "flower"
  | "monstera"
  | "checkpoint"
  | "stomp"
  | "hurt"
  | "death"
  | "spin"
  | "slide"
  | "slam"
  | "crate"
  | "fuse"
  | "explode"
  | "bounce"
  | "life"
  | "bossHurt";

/** Only winter changes what the ground does; the rest share solid footing. */
const SURFACES: Readonly<Record<Season, Surface>> = {
  spring: SOLID,
  summer: SOLID,
  autumn: SOLID,
  winter: ICE,
  sakura: SOLID,
};

export type GameState = {
  readonly level: Level;
  /** Moves to the last checkpoint crate the cat has broken. */
  spawnX: number;
  spawnY: number;
  readonly goal: Rect | null;
  player: Player;
  dogs: Dog[];
  flowers: Flower[];
  monstera: Flower[];
  readonly cacti: readonly Rect[];
  readonly chimney: Chimney | null;
  avalanche: Avalanche;
  boss: Boss | null;
  /** Replaying a boss phase after death must not pay for the same hit twice. */
  bossHitsScored: number;
  /** Mutable crate state, keyed by tile index. Static crates are absent. */
  crates: Map<number, Crate>;
  /** Checkpoint crate positions, fixed at load. One flag per season. */
  readonly posts: readonly Post[];
  readonly safeAreas: readonly Rect[];
  debris: Debris[];
  phase: Phase;
  lives: number;
  deaths: number;
  /** Enemies taken out by any means, each paid STOMP_POINTS. */
  defeated: number;
  /** Every flower gathered: FLOWERS_PER_LIFE of them buys a life. */
  flowerCount: number;
  score: number;
  /** Wall clock for the run, started by the first input and stopped at the boat. */
  runTime: number;
  started: boolean;
  /** Flat [x, y, x, y, ...] of this run, sampled at TRACE_HZ. */
  trace: number[];
  traceClock: number;
  time: number;
  /** Stamp of the winning touch, so the outro can play off the clock. */
  wonAt: number;
  /** Bumped tiles, used only by the renderer for the pop animation. */
  bumps: Map<number, number>;
  /** Emitted by the current step and drained by the caller; cleared every step. */
  sounds: Sound[];
};

/** The pole runs from its marker down to the floor, so touching it anywhere counts. */
function goalRect(level: Level, x: number, y: number): Rect {
  const tx = Math.floor(x / TILE);
  let ty = Math.floor(y / TILE);
  while (ty < level.height && !solidAt(level, tx, ty + 1)) ty++;
  return { x: x + 8, y, w: 16, h: (ty + 1) * TILE - y };
}

function findChimney(level: Level): Chimney | null {
  const bounds = level.chimney;
  if (!bounds) return null;

  let floorRow = level.height;
  for (let ty = 0; ty < level.height; ty++) {
    if (solidAt(level, bounds.fromTile, ty)) {
      floorRow = ty;
      break;
    }
  }
  // The wall beside the shaft defines how high the climb is confined.
  let wallTop = 0;
  for (let ty = 0; ty < level.height; ty++) {
    if (solidAt(level, bounds.fromTile - 1, ty)) {
      wallTop = ty;
      break;
    }
  }

  return {
    left: bounds.fromTile * TILE,
    right: (bounds.toTile + 1) * TILE,
    floorY: floorRow * TILE,
    exitY: wallTop * TILE,
  };
}

/** Drops the cat's feet onto the floor of its spawn tile rather than its ceiling. */
function spawnY(tileY: number): number {
  return tileY + TILE - PLAYER_H;
}

function makePlayer(x: number, y: number): Player {
  return {
    x,
    y,
    px: x,
    py: y,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    coyote: 0,
    buffer: 0,
    jumpHeld: false,
    runTime: 0,
    dying: 0,
    cling: 0,
    wallSide: 0,
    wallCoyote: 0,
    wallLock: 0,
    action: "none",
    actionTime: 0,
    spinCooldown: 0,
    spinHeld: false,
    downHeld: false,
    slideHeld: false,
    slideBlocked: false,
  };
}

function findPosts(level: Level): readonly Post[] {
  const posts: Post[] = [];
  for (let i = 0; i < level.tiles.length; i++) {
    if ((level.tiles[i] as Tile) !== Tile.CrateCheck) continue;
    posts.push({ x: (i % level.width) * TILE, y: Math.floor(i / level.width) * TILE });
  }
  return posts;
}

/** Kept so a level restart can put every crate back exactly as authored. */
function snapshotTiles(level: Level): Uint8Array {
  return Uint8Array.from(level.tiles);
}

const pristine = new WeakMap<Level, Uint8Array>();

export function createState(source: LevelSource): GameState {
  const level = parseLevel(source);
  const start = level.spawns.find((s) => s.kind === "player");
  const spawnX = start?.x ?? TILE;
  const startY = start?.y ?? TILE;
  const goalSpawn = level.spawns.find((s) => s.kind === "goal");
  pristine.set(level, snapshotTiles(level));

  return {
    level,
    spawnX,
    spawnY: startY,
    goal: goalSpawn ? goalRect(level, goalSpawn.x, goalSpawn.y) : null,
    player: makePlayer(spawnX, spawnY(startY)),
    dogs: [],
    flowers: [],
    monstera: [],
    cacti: level.spawns
      .filter((sp) => sp.kind === "cactus")
      .map((sp) => ({
        x: sp.x + (TILE - CACTUS_W) / 2,
        y: sp.y + (TILE - CACTUS_H),
        w: CACTUS_W,
        h: CACTUS_H,
      })),
    chimney: findChimney(level),
    avalanche: { active: false, y: 0 },
    boss: null,
    bossHitsScored: 0,
    crates: new Map(),
    posts: findPosts(level),
    safeAreas: [{ x: spawnX, y: startY }, ...findPosts(level)].map((point) => ({
      x: point.x - SAFE_AREA_MARGIN,
      y: point.y - TILE,
      w: TILE + SAFE_AREA_MARGIN * 2,
      h: TILE * 3,
    })),
    debris: [],
    phase: "playing",
    lives: STARTING_LIVES,
    deaths: 0,
    defeated: 0,
    flowerCount: 0,
    score: 0,
    runTime: 0,
    started: false,
    trace: [],
    traceClock: 0,
    time: 0,
    wonAt: 0,
    bumps: new Map(),
    sounds: [],
  };
}

function makeBoss(level: Level, x: number, y: number): Boss {
  const tx = Math.floor(x / TILE);
  let ty = Math.floor(y / TILE);
  while (ty < level.height && !solidAt(level, tx, ty + 1)) ty++;
  const floorY = (ty + 1) * TILE - BOSS_H;
  return {
    x,
    y: floorY,
    px: x,
    py: floorY,
    vx: 0,
    vy: 0,
    homeX: x,
    floorY,
    mode: "wait",
    modeTime: BOSS_WIND_UP,
    phase: 0,
    facing: -1,
  };
}

function spawnEnemies(state: GameState): Dog[] {
  const breedOf: Readonly<Record<string, Breed>> = {
    dog: "terrier",
    retriever: "retriever",
    hedgehog: "hedgehog",
    wasp: "wasp",
  };
  return state.level.spawns
    .filter((s) => breedOf[s.kind] !== undefined)
    .map((s) => {
      const breed = breedOf[s.kind] as Breed;
      const traits = BREEDS[breed];
      const y = s.y + (TILE - traits.h);
      return {
        x: s.x + (TILE - traits.w) / 2,
        y,
        px: s.x,
        py: y,
        vx: -traits.speed,
        vy: 0,
        alive: true,
        squash: 0,
        breed,
        action: "walk" as DogAction,
        actionTime: 1.2 + (s.x % 7) * 0.3,
        seed: ((s.x + 1) * 2654435761) >>> 0 || 1,
        homeY: y,
        flyClock: (s.x % 13) * 0.21,
      };
    })
    .filter((d) => !state.safeAreas.some((area) => overlaps(dogRect(d), area)));
}

/** Puts the cat back without taking anything it has collected. */
export function respawn(state: GameState): void {
  state.player = makePlayer(state.spawnX, spawnY(state.spawnY));
  state.dogs = spawnEnemies(state);
  const bossSpawn = state.level.spawns.find((s) => s.kind === "boss");
  const boss = bossSpawn ? makeBoss(state.level, bossSpawn.x, bossSpawn.y) : null;
  state.boss = boss && !state.safeAreas.some((area) => overlaps(bossRect(boss), area))
    ? boss : null;
  state.phase = "playing";
  state.bumps.clear();
  state.debris.length = 0;
  state.avalanche.active = false;
  state.avalanche.y = (state.chimney?.floorY ?? 0) + AVALANCHE_GRACE;
}

/** Full reset for a fresh run. Crates come back, which respawn deliberately does not do. */
export function resetLevel(state: GameState): void {
  const original = pristine.get(state.level);
  if (original) state.level.tiles.set(original);
  state.crates.clear();

  respawn(state);
  state.flowers = state.level.spawns
    .filter((s) => s.kind === "flower")
    .map((s) => ({ x: s.x + (TILE - FLOWER_W) / 2, y: s.y + 6, taken: false }));
  state.monstera = state.level.spawns
    .filter((s) => s.kind === "monstera")
    .map((s) => ({ x: s.x + (TILE - MONSTERA_W) / 2, y: s.y + 2, taken: false }));
  state.spawnX = state.level.spawns.find((s) => s.kind === "player")?.x ?? TILE;
  state.spawnY = state.level.spawns.find((s) => s.kind === "player")?.y ?? TILE;
  state.player = makePlayer(state.spawnX, spawnY(state.spawnY));
  state.lives = STARTING_LIVES;
  state.deaths = 0;
  state.defeated = 0;
  state.flowerCount = 0;
  state.score = 0;
  state.bossHitsScored = 0;
  state.runTime = 0;
  state.started = false;
  state.trace = [];
  state.traceClock = 0;
}

export function playerHeight(p: Player): number {
  return p.action === "slide" ? SLIDE_H : PLAYER_H;
}

export function playerRect(p: Player): Rect {
  return { x: p.x, y: p.y, w: PLAYER_W, h: playerHeight(p) };
}

/** The reach of a spin, which is wider than the cat and only ever breaks things. */
export function spinRect(p: Player): Rect {
  return {
    x: p.x - SPIN_REACH,
    y: p.y,
    w: PLAYER_W + SPIN_REACH * 2,
    h: playerHeight(p),
  };
}

export function dogRect(d: Dog): Rect {
  const traits = BREEDS[d.breed];
  return { x: d.x, y: d.y, w: traits.w, h: traits.h };
}

export function bossRect(b: Boss): Rect {
  return { x: b.x, y: b.y, w: BOSS_W, h: BOSS_H };
}

function rectClear(level: Level, r: Rect): boolean {
  const left = Math.floor(r.x / TILE);
  const right = Math.floor((r.x + r.w - 1) / TILE);
  const top = Math.floor(r.y / TILE);
  const bottom = Math.floor((r.y + r.h - 1) / TILE);
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (solidAt(level, tx, ty)) return false;
    }
  }
  return true;
}

/** A slide only ends where there is headroom, which is what lets tunnels work. */
function canStand(level: Level, p: Player): boolean {
  const rise = PLAYER_H - SLIDE_H;
  return rectClear(level, { x: p.x, y: p.y - rise, w: PLAYER_W, h: rise });
}

function startSlide(state: GameState, p: Player): void {
  p.y += PLAYER_H - SLIDE_H;
  p.action = "slide";
  p.actionTime = SLIDE_TIME;
  p.vx = p.facing * SLIDE_SPEED;
  p.slideBlocked = false;
  state.sounds.push("slide");
}

function endSlide(p: Player): void {
  p.y -= PLAYER_H - SLIDE_H;
  p.action = "none";
  p.actionTime = 0;
  p.slideBlocked = false;
}

/* ── crates ────────────────────────────────────────────────────────────── */

function crateAt(state: GameState, index: number): Crate {
  let crate = state.crates.get(index);
  if (!crate) {
    crate = { fuse: 0, bounces: 0 };
    state.crates.set(index, crate);
  }
  return crate;
}

function clearCrate(state: GameState, index: number): void {
  const tile = state.level.tiles[index] as Tile;
  const width = state.level.width;
  state.debris.push({
    x: (index % width) * TILE,
    y: Math.floor(index / width) * TILE,
    tile,
    life: tile === Tile.CrateNitro || tile === Tile.CrateTnt ? EXPLOSION_TIME : DEBRIS_TIME,
  });
  state.level.tiles[index] = Tile.Empty;
  state.crates.delete(index);
}

/** Every hundredth flower buys a life back, however it was gathered. */
function grantFlowers(state: GameState, count: number): void {
  const before = Math.floor(state.flowerCount / FLOWERS_PER_LIFE);
  state.flowerCount += count;
  const after = Math.floor(state.flowerCount / FLOWERS_PER_LIFE);
  state.score += count * FLOWER_POINTS;
  if (after > before) {
    state.lives += after - before;
    state.sounds.push("life");
  }
}

/**
 * Breaks one crate. TNT is the exception that does not break on contact: it
 * lights, and the fuse is the whole point of it.
 */
function breakCrate(state: GameState, index: number): void {
  const tile = state.level.tiles[index] as Tile;
  if (!isCrate(tile)) return;

  if (tile === Tile.CrateTnt) {
    const crate = crateAt(state, index);
    if (crate.fuse === 0) {
      crate.fuse = TNT_FUSE;
      state.sounds.push("fuse");
    }
    return;
  }
  if (tile === Tile.CrateNitro) return;

  if (tile === Tile.CrateCheck) {
    state.spawnX = (index % state.level.width) * TILE;
    state.spawnY = Math.floor(index / state.level.width) * TILE;
    state.sounds.push("checkpoint");
    clearCrate(state, index);
    return;
  }

  state.sounds.push("crate");
  clearCrate(state, index);
}

/** A blast clears its own tile and reaches one tile in every direction. */
function detonate(state: GameState, index: number): void {
  const { width, height } = state.level;
  const tx = index % width;
  const ty = Math.floor(index / width);
  clearCrate(state, index);
  state.sounds.push("explode");

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const at = ny * width + nx;
      const tile = state.level.tiles[at] as Tile;
      if (!isCrate(tile)) continue;
      // Nitro caught in a blast goes at once; anything else lights a short fuse
      // so a stack comes apart in sequence rather than all on one frame.
      if (tile === Tile.CrateNitro) detonate(state, at);
      else if (tile === Tile.CrateTnt) {
        const crate = crateAt(state, at);
        if (crate.fuse === 0 || crate.fuse > TNT_CHAIN_FUSE) crate.fuse = TNT_CHAIN_FUSE;
      } else breakCrate(state, at);
    }
  }

  const blast: Rect = {
    x: (tx - 1) * TILE,
    y: (ty - 1) * TILE,
    w: TILE * 3,
    h: TILE * 3,
  };
  if (overlaps(playerRect(state.player), blast)) kill(state, EXPLOSION_TIME);
  for (const d of state.dogs) {
    if (d.alive && overlaps(dogRect(d), blast)) killDog(state, d);
  }
}

function stepCrates(state: GameState, dt: number): void {
  for (const [index, crate] of [...state.crates]) {
    if (crate.fuse <= 0) continue;
    crate.fuse -= dt;
    if (crate.fuse <= 0) detonate(state, index);
  }
  for (let i = state.debris.length - 1; i >= 0; i--) {
    const piece = state.debris[i]!;
    piece.life -= dt;
    if (piece.life <= 0) state.debris.splice(i, 1);
  }
}

/** Every crate tile a rect touches, nearest first is not needed: verbs hit all of them. */
function cratesIn(state: GameState, r: Rect): number[] {
  const { width } = state.level;
  const left = Math.floor(r.x / TILE);
  const right = Math.floor((r.x + r.w - 1) / TILE);
  const top = Math.floor(r.y / TILE);
  const bottom = Math.floor((r.y + r.h - 1) / TILE);
  const found: number[] = [];
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (tx < 0 || tx >= width || ty < 0) continue;
      const index = ty * width + tx;
      if (isCrate(state.level.tiles[index] as Tile)) found.push(index);
    }
  }
  return found;
}

/**
 * Crates are solid, so the cat can never overlap one. Touching nitro or TNT has
 * to come from brushing against it instead, which is what one pixel of
 * inflation buys.
 */
function touchingCrates(state: GameState, r: Rect, tile: Tile): number[] {
  const grazed: Rect = { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 };
  return cratesIn(state, grazed).filter((i) => (state.level.tiles[i] as Tile) === tile);
}

/* ── enemies ───────────────────────────────────────────────────────────── */

/**
 * Deterministic per-enemy roll, so a replay behaves exactly the same. Xorshift
 * rather than an LCG: the fidget check only ever reads every other draw, and a
 * linear generator correlates badly enough there to leave some animals walking
 * in a straight line forever.
 */
function rollDog(d: Dog): number {
  let x = d.seed;
  x ^= (x << 13) >>> 0;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  x >>>= 0;
  d.seed = x;
  return x / 4294967296;
}

/** Animals do not patrol forever: they stop, scratch, sniff, then carry on. */
function nextAction(d: Dog): void {
  const traits = BREEDS[d.breed];
  if (d.action !== "walk") {
    d.action = "walk";
    d.actionTime = 1.4 + rollDog(d) * 2.6;
    return;
  }
  if (rollDog(d) < traits.fidget) {
    d.action = rollDog(d) < 0.5 ? "scratch" : "sniff";
    d.actionTime = 1.0 + rollDog(d) * 1.3;
  } else {
    d.action = "walk";
    d.actionTime = 1.4 + rollDog(d) * 2.6;
  }
}

const WASP_AMPLITUDE = 26;
const WASP_RATE = 2.4;

/**
 * A walker turns around at a wall or at the edge of the ground it is standing
 * on, which is what keeps them pacing a platform instead of walking off it. A
 * wasp ignores both and flies a fixed sine instead.
 */
function stepDog(level: Level, d: Dog, dt: number): void {
  d.px = d.x;
  d.py = d.y;

  if (!d.alive) {
    d.squash = Math.max(0, d.squash - dt);
    return;
  }

  const traits = BREEDS[d.breed];

  if (traits.flies) {
    d.flyClock += dt;
    const moved = sweepX(level, dogRect(d), Math.sign(d.vx) * traits.speed * dt);
    d.x = moved.value;
    if (moved.hit) d.vx = -d.vx;
    d.y = d.homeY + Math.sin(d.flyClock * WASP_RATE) * WASP_AMPLITUDE;
    return;
  }

  d.actionTime -= dt;
  if (d.actionTime <= 0) nextAction(d);

  const speed = d.action === "walk" ? Math.sign(d.vx) * traits.speed : 0;
  const moved = sweepX(level, dogRect(d), speed * dt);
  d.x = moved.value;
  if (moved.hit) d.vx = -d.vx;

  d.vy = fallSpeed(d.vy, dt, FALL_GRAVITY);
  const fell = sweepY(level, dogRect(d), d.vy * dt);
  d.y = fell.value;
  const grounded = fell.hit && d.vy > 0;
  if (fell.hit) d.vy = 0;

  if (grounded && d.action === "walk") {
    const aheadX = d.vx > 0 ? d.x + traits.w + 1 : d.x - 1;
    const tx = Math.floor(aheadX / TILE);
    const ty = Math.floor((d.y + traits.h + 1) / TILE);
    if (tileAt(level, tx, ty) === Tile.Empty) {
      d.vx = -d.vx;
      d.x = moved.hit ? d.x : d.px;
    }
  }
}

function killDog(state: GameState, d: Dog): void {
  d.alive = false;
  d.squash = 0.5;
  d.vx = 0;
  state.defeated += 1;
  state.score += STOMP_POINTS;
}

/* ── the player's verbs ────────────────────────────────────────────────── */

function advanceAction(state: GameState, dt: number): void {
  const p = state.player;
  if (p.action === "none" || p.action === "slam") return;

  p.actionTime -= dt;
  if (p.actionTime > 0) return;

  if (p.action === "slide") {
    // Still under something: keep sliding rather than standing up into a ceiling.
    if (canStand(state.level, p)) endSlide(p);
    else p.actionTime = 0.1;
    return;
  }
  if (p.action === "spin") p.spinCooldown = SPIN_COOLDOWN;
  p.action = "none";
  p.actionTime = 0;
}

function startAction(
  state: GameState,
  spinPressed: boolean,
  downPressed: boolean,
  slidePressed: boolean,
): void {
  const p = state.player;
  if (p.action !== "none") return;

  if (spinPressed && p.spinCooldown === 0) {
    p.action = "spin";
    p.actionTime = SPIN_TIME;
    state.sounds.push("spin");
    return;
  }
  if (slidePressed && p.grounded && Math.abs(p.vx) >= SLIDE_MIN_SPEED) {
    startSlide(state, p);
  } else if (downPressed && !p.grounded) {
    p.action = "slam";
    p.actionTime = 0;
    p.vx = 0;
    p.vy = SLAM_SPEED;
    p.cling = 0;
    state.sounds.push("slam");
  }
}

/** A spin breaks everything within reach; a slide breaks what it runs through. */
function verbBreaksCrates(state: GameState): void {
  const p = state.player;
  if (p.action === "spin") {
    for (const index of cratesIn(state, spinRect(p))) breakCrate(state, index);
  } else if (p.action === "slide") {
    // Reaching a little past the nose matters: a crate the slide has stopped
    // flush against is adjacent, not overlapping, and grinding to a halt on
    // one is the opposite of what a slide is for.
    const r = playerRect(p);
    const reach = { x: r.x - 2, y: r.y, w: r.w + 4, h: r.h };
    for (const index of cratesIn(state, reach)) breakCrate(state, index);
  }
}

/** Landing on a bounce crate is a route; landing on it four times is not. */
function bounceOff(state: GameState, index: number, slammed: boolean): void {
  const p = state.player;
  const crate = crateAt(state, index);
  crate.bounces += 1;
  const power = BOUNCE_SPEED + BOUNCE_STEP * Math.min(crate.bounces - 1, BOUNCE_LIMIT - 1);
  p.vy = -(power + (slammed ? SLAM_BOUNCE_BONUS : 0));
  p.buffer = 0;
  p.grounded = false;
  state.sounds.push("bounce");
  if (crate.bounces >= BOUNCE_LIMIT) {
    clearCrate(state, index);
  }
}

/** The tile directly under the cat's feet, or -1 where there is none. */
function tileUnderFeet(state: GameState): number {
  const p = state.player;
  const { width } = state.level;
  const ty = Math.floor((p.y + playerHeight(p) + 1) / TILE);
  const left = Math.floor(p.x / TILE);
  const right = Math.floor((p.x + PLAYER_W - 1) / TILE);
  for (let tx = left; tx <= right; tx++) {
    if (tx < 0 || tx >= width) continue;
    const index = ty * width + tx;
    if (isCrate(state.level.tiles[index] as Tile)) return index;
  }
  return -1;
}

/**
 * A vertical move resolves against the floor without touching x, which can
 * leave the cat's shoulder inside the column beside it. Against a wall that
 * corrects itself on the next horizontal sweep; against nitro it is a death,
 * so it is worth resolving on the spot.
 */
function unstick(level: Level, p: Player): void {
  const r = playerRect(p);
  const left = Math.floor(r.x / TILE);
  const right = Math.floor((r.x + r.w - 1) / TILE);
  if (left === right) return;

  const top = Math.floor(r.y / TILE);
  const bottom = Math.floor((r.y + r.h - 1) / TILE);
  for (let ty = top; ty <= bottom; ty++) {
    if (solidAt(level, right, ty)) {
      p.x = right * TILE - PLAYER_W;
      return;
    }
    if (solidAt(level, left, ty)) {
      p.x = (left + 1) * TILE;
      return;
    }
  }
}

function stepPlayer(state: GameState, input: Input, dt: number): void {
  const p = state.player;
  const level = state.level;

  const wasHeld = p.jumpHeld;
  p.buffer = input.jump && !p.jumpHeld ? JUMP_BUFFER : Math.max(0, p.buffer - dt);
  p.jumpHeld = input.jump;

  const spinPressed = input.spin && !p.spinHeld;
  p.spinHeld = input.spin;
  const downPressed = input.down && !p.downHeld;
  p.downHeld = input.down;
  const slidePressed = input.slide && !p.slideHeld;
  p.slideHeld = input.slide;

  p.wallLock = Math.max(0, p.wallLock - dt);
  p.spinCooldown = Math.max(0, p.spinCooldown - dt);
  advanceAction(state, dt);
  startAction(state, spinPressed, downPressed, slidePressed);

  const surface = SURFACES[seasonAt(level, p.x)];
  // A kick owns the cat's horizontal speed until the lock expires; otherwise
  // still holding into the wall would cancel the push on the very next frame.
  if (p.action === "slide") {
    // A slide that has run into something gives its forced speed back to the
    // player. Under a roof too low to stand up under there is no other way out
    // of it, and holding the cat against a wall forever is a softlock.
    p.vx = p.slideBlocked
      ? horizontalSpeed(p.vx, input, p.grounded, dt, surface)
      : p.facing * SLIDE_SPEED;
  } else if (p.action === "slam" || p.action === "recover") {
    p.vx = 0;
  } else if (p.wallLock === 0) {
    p.vx = horizontalSpeed(p.vx, input, p.grounded, dt, surface);
  }
  // A jammed slide is being steered, so it should face the way it is crawling.
  if (p.action === "none" || p.action === "spin" || p.slideBlocked) {
    if (p.vx > 0) p.facing = 1;
    else if (p.vx < 0) p.facing = -1;
  }

  const movedX = sweepX(level, playerRect(p), p.vx * dt);
  p.x = movedX.value;
  if (movedX.hit) p.vx = 0;
  if (p.action === "slide") p.slideBlocked = movedX.hit;

  const busy = p.action === "slide" || p.action === "slam" || p.action === "recover";
  // Gripping needs a wall, an airborne cat, and the player asking for it.
  const wall = p.grounded || busy ? 0 : wallContact(level, playerRect(p), WALL_REACH);
  // Gripping on the way up too, so a wall feels sticky the instant you touch it.
  // The kick's input lock also suppresses grip, or you would re-latch the wall
  // you just left and cancel your own launch.
  const gripping = wall !== 0 && inputDirection(input) === wall && p.wallLock === 0;
  const caught = gripping && p.cling === 0;
  p.cling = gripping ? wall : 0;
  if (caught) state.sounds.push("grip");
  if (p.cling !== 0) {
    // Pull flush to the wall so a grip from a few pixels out does not float.
    const snap = sweepX(level, playerRect(p), p.cling * WALL_REACH);
    if (snap.hit) p.x = snap.value;
  }
  if (p.cling !== 0) {
    p.facing = p.cling;
    p.wallSide = p.cling;
    p.wallCoyote = WALL_COYOTE;
  } else {
    p.wallCoyote = Math.max(0, p.wallCoyote - dt);
  }

  // A spin can be abandoned into a jump, so committing to it is never a trap.
  if (p.action === "spin" && p.buffer > 0 && SPIN_TIME - p.actionTime >= SPIN_CANCEL) {
    p.action = "none";
    p.actionTime = 0;
    p.spinCooldown = SPIN_COOLDOWN;
  }

  if (p.action === "slide" && p.buffer > 0 && canStand(level, p)) {
    // Trading height for reach is the only reason to jump out of a slide.
    const launch = p.facing * SLIDE_SPEED * SLIDE_JUMP_X;
    endSlide(p);
    p.vy = -JUMP_SPEED * SLIDE_JUMP_Y;
    p.vx = launch;
    p.buffer = 0;
    p.coyote = 0;
    p.grounded = false;
    state.sounds.push("jump");
  } else if (p.action === "none" && p.buffer > 0 && p.coyote > 0) {
    p.vy = -JUMP_SPEED;
    p.buffer = 0;
    p.coyote = 0;
    p.grounded = false;
    state.sounds.push("jump");
  } else if (p.action === "none" && p.buffer > 0 && (p.cling !== 0 || p.wallCoyote > 0)) {
    const side = p.cling !== 0 ? p.cling : p.wallSide;
    // Never trade away a better climb: kicking early keeps the speed you had.
    p.vy = Math.min(p.vy, -WALL_JUMP_Y);
    p.vx = -side * WALL_JUMP_X;
    p.facing = -side as Side as 1 | -1;
    p.buffer = 0;
    p.cling = 0;
    p.wallCoyote = 0;
    p.wallLock = WALL_LOCK;
    state.sounds.push("jump");
  }
  // Releasing jump mid-rise trades height for control.
  if (wasHeld && !input.jump && p.vy < 0 && p.action !== "slam") p.vy *= JUMP_CUT;

  if (p.action === "slam") p.vy = SLAM_SPEED;
  else p.vy = fallSpeed(p.vy, dt, jumpGravity(p.vy, input.jump));
  if (p.cling !== 0) p.vy = Math.min(p.vy, WALL_SLIDE_SPEED);

  const movedY = sweepY(level, playerRect(p), p.vy * dt);
  const landed = movedY.hit && p.vy > 0;
  const impact = p.vy;
  const slammed = p.action === "slam";

  if (movedY.hit && p.vy < 0) bumpCeiling(state, movedY.value);
  p.y = movedY.value;
  if (movedY.hit) {
    p.vy = 0;
    unstick(level, p);
  }

  if (landed && !p.grounded && impact > 320) state.sounds.push("land");
  p.grounded = landed;
  if (landed) {
    p.cling = 0;
    p.wallCoyote = 0;
  }
  p.coyote = landed ? COYOTE_TIME : Math.max(0, p.coyote - dt);
  p.runTime = Math.abs(p.vx) > 1 && landed ? p.runTime + dt * Math.abs(p.vx) : 0;

  if (landed && slammed) {
    const under = tileUnderFeet(state);
    p.action = "recover";
    p.actionTime = SLAM_RECOVER;
    if (under >= 0) {
      const tile = state.level.tiles[under] as Tile;
      if (tile === Tile.CrateBounce) bounceOff(state, under, true);
      else breakCrate(state, under);
    }
  } else if (landed && !slammed) {
    const under = tileUnderFeet(state);
    if (under >= 0) {
      const tile = state.level.tiles[under] as Tile;
      if (tile === Tile.CrateBounce) bounceOff(state, under, false);
      else if (tile === Tile.CrateTnt) breakCrate(state, under);
    }
  }

  verbBreaksCrates(state);
}

/**
 * Jumping up into a crate breaks it, which is how a stack is taken apart from
 * beneath. Plain tiles only pop, as they always did.
 */
function bumpCeiling(state: GameState, newY: number): void {
  const p = state.player;
  const ty = Math.floor((newY - 1) / TILE);
  const left = Math.floor(p.x / TILE);
  const right = Math.floor((p.x + PLAYER_W - 1) / TILE);

  for (let tx = left; tx <= right; tx++) {
    const tile = tileAt(state.level, tx, ty);
    if (tile === Tile.Empty) continue;
    state.bumps.set(ty * state.level.width + tx, 0.18);
    if (breakableByVerb(tile)) breakCrate(state, ty * state.level.width + tx);
    break;
  }
}

/* ── the boss ──────────────────────────────────────────────────────────── */

/**
 * Three phases, one pattern: it winds up, charges, and buries itself in the
 * wall it was aiming past you at. The stun is the only window you get.
 */
function stepBoss(state: GameState, dt: number): void {
  const b = state.boss;
  if (!b || b.mode === "dead") return;

  b.px = b.x;
  b.py = b.y;
  b.modeTime -= dt;

  const p = state.player;
  // Each phase is faster than the last, and the wind-up shorter.
  const speed = BOSS_CHARGE_SPEED * (1 + b.phase * 0.25);

  if (b.mode === "wait") {
    b.facing = p.x + PLAYER_W / 2 < b.x + BOSS_W / 2 ? -1 : 1;
    // Still braced against what stunned it: charging that way again would stun
    // it on the spot, handing out a second window for the same hit.
    if (chargeStep(state, b, b.facing * speed * dt).hit) b.facing = b.facing > 0 ? -1 : 1;
    if (b.modeTime <= 0) {
      b.mode = "charge";
      b.modeTime = 4;
      b.vx = b.facing * speed;
    }
    return;
  }

  if (b.mode === "charge") {
    const moved = chargeStep(state, b, b.vx * dt);
    b.x = moved.value;
    if (moved.hit || b.modeTime <= 0) {
      b.mode = "stunned";
      b.modeTime = BOSS_STUN_TIME;
      b.vx = 0;
      state.sounds.push("land");
    }
    return;
  }

  if (b.mode === "stunned" && b.modeTime <= 0) {
    b.mode = "wait";
    b.modeTime = Math.max(0.3, BOSS_WIND_UP - b.phase * 0.2);
    return;
  }

  if (b.mode === "hurt" && b.modeTime <= 0) {
    b.mode = "wait";
    b.modeTime = Math.max(0.3, BOSS_WIND_UP - b.phase * 0.2);
  }
}

/** One step of a charge, which a wall or the edge of a spawn safe area stops. */
function chargeStep(state: GameState, b: Boss, dx: number): Sweep {
  const moved = sweepX(state.level, bossRect(b), dx);
  const ahead = { ...bossRect(b), x: moved.value };
  return state.safeAreas.some((area) => overlaps(ahead, area)) ? { value: b.x, hit: true } : moved;
}

function hitBoss(state: GameState, b: Boss): void {
  b.phase += 1;
  b.mode = b.phase >= BOSS_PHASES ? "dead" : "hurt";
  b.modeTime = BOSS_HURT_TIME;
  b.vx = 0;
  if (b.phase > state.bossHitsScored) {
    state.score += BOSS_POINTS;
    state.bossHitsScored = b.phase;
  }
  state.sounds.push("bossHurt");
}

/* ── contacts ──────────────────────────────────────────────────────────── */

function resolveContacts(state: GameState): void {
  const p = state.player;
  const rect = playerRect(p);

  for (const f of state.flowers) {
    if (f.taken) continue;
    if (overlaps(rect, { x: f.x, y: f.y, w: FLOWER_W, h: FLOWER_H })) {
      f.taken = true;
      grantFlowers(state, 1);
      state.sounds.push("flower");
    }
  }

  for (const m of state.monstera) {
    if (m.taken) continue;
    if (overlaps(rect, { x: m.x, y: m.y, w: MONSTERA_W, h: MONSTERA_H })) {
      m.taken = true;
      state.score += MONSTERA_POINTS;
      state.sounds.push("monstera");
    }
  }

  const nitro = touchingCrates(state, rect, Tile.CrateNitro)[0];
  if (nitro !== undefined) {
    detonate(state, nitro);
    return;
  }
  for (const tnt of touchingCrates(state, rect, Tile.CrateTnt)) breakCrate(state, tnt);

  for (const c of state.cacti) {
    if (overlaps(rect, c)) {
      kill(state);
      return;
    }
  }

  // A spin reaches further than the cat does, and only ever hurts other things.
  if (p.action === "spin") {
    const reach = spinRect(p);
    for (const d of state.dogs) {
      if (d.alive && BREEDS[d.breed].spin && overlaps(reach, dogRect(d))) killDog(state, d);
    }
    const b = state.boss;
    if (b && b.mode === "stunned" && overlaps(reach, bossRect(b))) hitBoss(state, b);
  }

  for (const d of state.dogs) {
    if (!d.alive || !overlaps(rect, dogRect(d))) continue;
    const traits = BREEDS[d.breed];
    // Falling onto the top half is a stomp; anything else is decided by the table.
    const stomped = p.vy > 0 && p.py + PLAYER_H <= d.y + traits.h / 2;
    if (stomped && traits.stomp) {
      killDog(state, d);
      p.vy = -STOMP_BOUNCE;
      p.buffer = 0;
      state.sounds.push("stomp");
    } else if (p.action === "slide" && traits.slidePass) {
      continue;
    } else if (p.action === "spin" && traits.spin) {
      continue;
    } else {
      kill(state);
      return;
    }
  }

  const boss = state.boss;
  // Reeling from a hit is as harmless as being stunned: otherwise landing the
  // spin kills the cat that landed it.
  const dazed = boss?.mode === "stunned" || boss?.mode === "hurt" || boss?.mode === "dead";
  if (boss && !dazed && overlaps(rect, bossRect(boss))) {
    kill(state);
    return;
  }

  // Past the pole at any height counts: a jump clears a one-tile pole easily,
  // and beyond it is the sea. The boat only leaves once the shore is clear.
  const pastPole = state.goal !== null && rect.x + rect.w > state.goal.x;
  if (pastPole && (!boss || boss.mode === "dead")) {
    state.phase = "won";
    state.wonAt = state.time;
    state.score += GOAL_POINTS + timeBonus(state.runTime) + state.lives * LIFE_BONUS_POINTS;
  }
}

function kill(state: GameState, deathBeat = DEATH_BEAT): void {
  if (state.phase === "dying") return;
  state.sounds.push(state.lives > 1 ? "hurt" : "death");
  state.phase = "dying";
  state.player.dying = deathBeat;
  state.player.vy = -520;
  state.player.vx = 0;
  state.player.action = "none";
}

export function step(state: GameState, input: Input, dt: number): void {
  state.time += dt;
  state.sounds.length = 0;

  if (!state.started && (input.left || input.right || input.jump)) state.started = true;
  // The clock keeps running through a death: time is the only punishment.
  if (state.started && state.phase !== "won") {
    state.runTime += dt;
    state.traceClock += dt;
    const period = 1 / TRACE_HZ;
    while (state.traceClock >= period) {
      state.trace.push(Math.round(state.player.x), Math.round(state.player.y));
      state.traceClock -= period;
    }
  }

  for (const [key, remaining] of state.bumps) {
    if (remaining <= dt) state.bumps.delete(key);
    else state.bumps.set(key, remaining - dt);
  }

  if (state.phase === "dying") {
    const p = state.player;
    p.px = p.x;
    p.py = p.y;
    p.vy = fallSpeed(p.vy, dt, FALL_GRAVITY);
    p.y += p.vy * dt;
    p.dying -= dt;
    stepCrates(state, dt);
    if (p.dying <= 0) {
      state.lives -= 1;
      state.deaths += 1;
      // Out of lives restarts the level outright: crates, flowers and all.
      if (state.lives <= 0) {
        const spent = state.deaths;
        resetLevel(state);
        state.deaths = spent;
      } else {
        respawn(state);
      }
    }
    return;
  }

  if (state.phase === "won") {
    state.player.px = state.player.x;
    state.player.py = state.player.y;
    return;
  }

  state.player.px = state.player.x;
  state.player.py = state.player.y;

  stepPlayer(state, input, dt);
  for (const d of state.dogs) {
    stepDog(state.level, d, dt);
    if (d.alive && state.safeAreas.some((area) => overlaps(dogRect(d), area))) {
      d.x = d.px;
      d.y = d.py;
      d.vx = -d.vx;
    }
  }
  stepBoss(state, dt);
  stepCrates(state, dt);
  stepAvalanche(state, dt);
  if (state.phase !== "playing") return;
  resolveContacts(state);

  if (state.player.y > pixelHeight(state.level) + TILE) kill(state);
}

/**
 * Snow fills the shaft the moment the cat commits to the climb and rises
 * steadily. Stepping back out resets it, so the pressure is only ever on the
 * attempt in progress.
 */
function stepAvalanche(state: GameState, dt: number): void {
  const shaft = state.chimney;
  if (!shaft) return;

  const p = state.player;
  const inside = p.x + PLAYER_W > shaft.left && p.x < shaft.right;
  const escaped = p.y + PLAYER_H <= shaft.exitY;

  if (!inside || escaped) {
    state.avalanche.active = false;
    state.avalanche.y = shaft.floorY + AVALANCHE_GRACE;
    return;
  }

  if (!state.avalanche.active) {
    state.avalanche.active = true;
    state.avalanche.y = shaft.floorY + AVALANCHE_GRACE;
    return;
  }

  state.avalanche.y -= AVALANCHE_SPEED * dt;
  if (p.y + PLAYER_H > state.avalanche.y) kill(state);
}

/** Speed pays, but never negatively: a slow run simply earns no bonus. */
export function timeBonus(runTime: number): number {
  const [fastest, maximum] = TIME_BONUSES[0]!;
  if (runTime <= fastest) return maximum;
  for (let i = 1; i < TIME_BONUSES.length; i++) {
    const [seconds, points] = TIME_BONUSES[i]!;
    if (runTime <= seconds) {
      const [previousSeconds, previousPoints] = TIME_BONUSES[i - 1]!;
      const fraction = (runTime - previousSeconds) / (seconds - previousSeconds);
      return Math.round(previousPoints + (points - previousPoints) * fraction);
    }
  }
  return 0;
}

/** What the cat is carrying, in flower-equivalents. */
export function harvest(state: GameState): number {
  const flowers = state.flowers.filter((f) => f.taken).length;
  const leaves = state.monstera.filter((m) => m.taken).length;
  return flowers + leaves * MONSTERA_VALUE;
}

/** Where the score came from, in points. The parts always add up to the score. */
export type ScoreBreakdown = {
  readonly flowers: number;
  readonly monstera: number;
  readonly enemies: number;
  readonly bigDog: number;
  readonly flag: number;
  readonly time: number;
  readonly lives: number;
};

export function scoreBreakdown(state: GameState): ScoreBreakdown {
  // The finish bonuses are paid at the flag and not a moment before.
  const won = state.phase === "won";
  return {
    flowers: state.flowerCount * FLOWER_POINTS,
    monstera: state.monstera.filter((m) => m.taken).length * MONSTERA_POINTS,
    enemies: state.defeated * STOMP_POINTS,
    bigDog: state.bossHitsScored * BOSS_POINTS,
    flag: won ? GOAL_POINTS : 0,
    time: won ? timeBonus(state.runTime) : 0,
    lives: won ? state.lives * LIFE_BONUS_POINTS : 0,
  };
}

export type Ending = "shore" | "raft" | "sailboat" | "ship";

export function endingFor(score: number): Ending {
  if (score >= 36_000) return "ship";
  if (score >= 26_000) return "sailboat";
  if (score >= 16_000) return "raft";
  return "shore";
}

export const IDLE_INPUT = NO_INPUT;
