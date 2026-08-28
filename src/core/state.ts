import {
  TILE,
  Tile,
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
} from "./physics";

export const PLAYER_W = 11;
export const PLAYER_H = 14;
export type Breed = "terrier" | "retriever";

export type BreedTraits = {
  readonly w: number;
  readonly h: number;
  readonly speed: number;
  /** How often it stops to be a dog rather than a hazard. */
  readonly fidget: number;
};

export const BREEDS: Readonly<Record<Breed, BreedTraits>> = {
  terrier: { w: 14, h: 12, speed: 28, fidget: 0.5 },
  retriever: { w: 18, h: 14, speed: 19, fidget: 0.35 },
};

export const DOG_W = 14;
export const DOG_H = 12;
export const FLOWER_W = 10;
export const FLOWER_H = 10;
export const MONSTERA_W = 14;
export const MONSTERA_H = 14;
/** A monstera is worth an armful of ordinary flowers. */
export const MONSTERA_VALUE = 5;
export const FLOWER_POINTS = 100;
export const MONSTERA_POINTS = 500;
export const STOMP_POINTS = 300;
export const STUMP_POINTS = 200;
export const GOAL_POINTS = 1000;
/** Finishing inside this window pays a bonus that shrinks every second. */
export const TIME_BONUS_WINDOW = 60;
export const TIME_BONUS_RATE = 50;

/** Below this, the cat waves from the shore instead of sailing. */
export const SAIL_THRESHOLD = 5;
export const SAILBOAT_THRESHOLD = 12;
export const SHIP_THRESHOLD = 20;
export const DOG_SPEED = 26;
export const CACTUS_W = 12;
export const CACTUS_H = 14;
export const CHECKPOINT_W = 8;
export const STARTING_LIVES = 9;
/** Long enough for the death to read, short enough not to be a wait. */
export const DEATH_BEAT = 0.35;

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
};

/** What a dog is doing right now. Only `walk` moves it. */
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
  /** Carried per dog so behaviour is varied but replays identically. */
  seed: number;
};

export type Flower = {
  readonly x: number;
  readonly y: number;
  taken: boolean;
};

export type Checkpoint = {
  readonly x: number;
  readonly y: number;
  taken: boolean;
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

export const AVALANCHE_SPEED = 34;
/** Ghost samples per second. Coarse enough to store, fine enough to read. */
export const TRACE_HZ = 30;
/** The snow starts below the floor, so entering the shaft is not instant death. */
export const AVALANCHE_GRACE = 80;

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
  | "death";

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
  /** Moves to the last checkpoint the cat has touched. */
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
  checkpoints: Checkpoint[];
  phase: Phase;
  /** A cat joke and a badge, never a fail state: running out ends nothing. */
  lives: number;
  deaths: number;
  /** Wall clock for the run, started by the first input and stopped at the boat. */
  score: number;
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
  return { x: x + 4, y, w: 8, h: (ty + 1) * TILE - y };
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
  };
}

export function createState(source: LevelSource): GameState {
  const level = parseLevel(source);
  const start = level.spawns.find((s) => s.kind === "player");
  const spawnX = start?.x ?? TILE;
  const spawnY = start?.y ?? TILE;
  const goalSpawn = level.spawns.find((s) => s.kind === "goal");

  return {
    level,
    spawnX,
    spawnY,
    goal: goalSpawn ? goalRect(level, goalSpawn.x, goalSpawn.y) : null,
    player: makePlayer(spawnX, spawnY),
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
    checkpoints: level.spawns
      .filter((sp) => sp.kind === "checkpoint")
      .map((sp) => ({ x: sp.x, y: sp.y, taken: false })),
    phase: "playing",
    lives: STARTING_LIVES,
    deaths: 0,
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

/** Puts the cat back without taking anything it has collected. */
export function respawn(state: GameState): void {
  state.player = makePlayer(state.spawnX, state.spawnY);
  state.dogs = state.level.spawns
    .filter((s) => s.kind === "dog" || s.kind === "retriever")
    .map((s) => {
      const breed: Breed = s.kind === "retriever" ? "retriever" : "terrier";
      const traits = BREEDS[breed];
      return {
        x: s.x + (TILE - traits.w) / 2,
        y: s.y + (TILE - traits.h),
        px: s.x,
        py: s.y,
        vx: -traits.speed,
        vy: 0,
        alive: true,
        squash: 0,
        breed,
        action: "walk" as DogAction,
        actionTime: 1.2 + (s.x % 7) * 0.3,
        seed: (s.x * 2654435761) >>> 0,
      };
    });
  state.phase = "playing";
  state.bumps.clear();
  state.avalanche.active = false;
  state.avalanche.y = (state.chimney?.floorY ?? 0) + AVALANCHE_GRACE;
}

/** Full reset for a fresh run. */
export function resetLevel(state: GameState): void {
  respawn(state);
  state.flowers = state.level.spawns
    .filter((s) => s.kind === "flower")
    .map((s) => ({ x: s.x + (TILE - FLOWER_W) / 2, y: s.y + 3, taken: false }));
  state.monstera = state.level.spawns
    .filter((s) => s.kind === "monstera")
    .map((s) => ({ x: s.x + (TILE - MONSTERA_W) / 2, y: s.y + 1, taken: false }));
  for (const c of state.checkpoints) c.taken = false;
  state.spawnX = state.level.spawns.find((s) => s.kind === "player")?.x ?? TILE;
  state.spawnY = state.level.spawns.find((s) => s.kind === "player")?.y ?? TILE;
  state.player = makePlayer(state.spawnX, state.spawnY);
  state.lives = STARTING_LIVES;
  state.deaths = 0;
  state.score = 0;
  state.runTime = 0;
  state.started = false;
  state.trace = [];
  state.traceClock = 0;
}

export function playerRect(p: Player): Rect {
  return { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H };
}

export function dogRect(d: Dog): Rect {
  const traits = BREEDS[d.breed];
  return { x: d.x, y: d.y, w: traits.w, h: traits.h };
}

/** Deterministic per-dog roll, so a replay behaves exactly the same. */
function rollDog(d: Dog): number {
  d.seed = (Math.imul(d.seed, 1664525) + 1013904223) >>> 0;
  return d.seed / 4294967296;
}

/** Dogs do not patrol forever: they stop, scratch, sniff, then carry on. */
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

/**
 * A dog turns around at a wall or at the edge of the ground it is standing on,
 * which is what keeps them pacing a platform instead of walking off it.
 */
function stepDog(level: Level, d: Dog, dt: number): void {
  d.px = d.x;
  d.py = d.y;

  if (!d.alive) {
    d.squash = Math.max(0, d.squash - dt);
    return;
  }

  d.actionTime -= dt;
  if (d.actionTime <= 0) nextAction(d);

  const traits = BREEDS[d.breed];
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

function stepPlayer(state: GameState, input: Input, dt: number): void {
  const p = state.player;
  const level = state.level;

  const wasHeld = p.jumpHeld;
  p.buffer = input.jump && !p.jumpHeld ? JUMP_BUFFER : Math.max(0, p.buffer - dt);
  p.jumpHeld = input.jump;

  p.wallLock = Math.max(0, p.wallLock - dt);

  const surface = SURFACES[seasonAt(level, p.x)];
  // A kick owns the cat's horizontal speed until the lock expires; otherwise
  // still holding into the wall would cancel the push on the very next frame.
  if (p.wallLock === 0) {
    p.vx = horizontalSpeed(p.vx, input, p.grounded, dt, surface);
  }
  if (p.vx > 0) p.facing = 1;
  else if (p.vx < 0) p.facing = -1;

  const movedX = sweepX(level, playerRect(p), p.vx * dt);
  p.x = movedX.value;
  if (movedX.hit) p.vx = 0;

  // Gripping needs a wall, an airborne cat, and the player asking for it.
  const wall = p.grounded ? 0 : wallContact(level, playerRect(p), WALL_REACH);
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

  if (p.buffer > 0 && p.coyote > 0) {
    p.vy = -JUMP_SPEED;
    p.buffer = 0;
    p.coyote = 0;
    p.grounded = false;
    state.sounds.push("jump");
  } else if (p.buffer > 0 && (p.cling !== 0 || p.wallCoyote > 0)) {
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
  if (wasHeld && !input.jump && p.vy < 0) p.vy *= JUMP_CUT;

  p.vy = fallSpeed(p.vy, dt, jumpGravity(p.vy, input.jump));
  if (p.cling !== 0) p.vy = Math.min(p.vy, WALL_SLIDE_SPEED);
  const movedY = sweepY(level, playerRect(p), p.vy * dt);
  const landed = movedY.hit && p.vy > 0;
  const impact = p.vy;

  if (movedY.hit && p.vy < 0) bumpCeiling(state, movedY.value);
  p.y = movedY.value;
  if (movedY.hit) p.vy = 0;

  if (landed && !p.grounded && impact > 160) state.sounds.push("land");
  p.grounded = landed;
  if (landed) {
    p.cling = 0;
    p.wallCoyote = 0;
  }
  p.coyote = landed ? COYOTE_TIME : Math.max(0, p.coyote - dt);
  p.runTime = Math.abs(p.vx) > 1 && landed ? p.runTime + dt * Math.abs(p.vx) : 0;
}

function bumpCeiling(state: GameState, newY: number): void {
  const p = state.player;
  const ty = Math.floor((newY - 1) / TILE);
  const left = Math.floor(p.x / TILE);
  const right = Math.floor((p.x + PLAYER_W - 1) / TILE);

  for (let tx = left; tx <= right; tx++) {
    const tile = tileAt(state.level, tx, ty);
    if (tile === Tile.Empty) continue;
    state.bumps.set(ty * state.level.width + tx, 0.18);
    if (tile === Tile.Box) {
      state.level.tiles[ty * state.level.width + tx] = Tile.Brick;
      state.score += STUMP_POINTS;
    }
    break;
  }
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

function resolveContacts(state: GameState): void {
  const p = state.player;
  const rect = playerRect(p);

  for (const f of state.flowers) {
    if (f.taken) continue;
    if (overlaps(rect, { x: f.x, y: f.y, w: FLOWER_W, h: FLOWER_H })) {
      f.taken = true;
      state.score += FLOWER_POINTS;
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

  for (const c of state.cacti) {
    if (overlaps(rect, c)) {
      kill(state);
      return;
    }
  }

  for (const c of state.checkpoints) {
    if (c.taken || !overlaps(rect, { x: c.x, y: c.y, w: CHECKPOINT_W, h: TILE * 4 })) continue;
    c.taken = true;
    state.spawnX = c.x;
    state.spawnY = c.y;
    state.sounds.push("checkpoint");
  }

  for (const d of state.dogs) {
    if (!d.alive || !overlaps(rect, dogRect(d))) continue;
    // Falling onto the top half is a stomp; anything else hurts.
    const stomped = p.vy > 0 && p.py + PLAYER_H <= d.y + BREEDS[d.breed].h / 2;
    if (stomped) {
      d.alive = false;
      d.squash = 0.5;
      d.vx = 0;
      p.vy = -STOMP_BOUNCE;
      p.buffer = 0;
      state.score += STOMP_POINTS;
      state.sounds.push("stomp");
    } else {
      kill(state);
      return;
    }
  }

  if (state.goal && overlaps(rect, state.goal)) {
    state.phase = "won";
    state.wonAt = state.time;
    state.score += GOAL_POINTS + timeBonus(state.runTime);
  }
}

function kill(state: GameState): void {
  if (state.phase === "dying") return;
  state.sounds.push(state.lives > 1 ? "hurt" : "death");
  state.phase = "dying";
  state.player.dying = DEATH_BEAT;
  state.player.vy = -260;
  state.player.vx = 0;
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
    if (p.dying <= 0) {
      state.lives = Math.max(0, state.lives - 1);
      state.deaths += 1;
      respawn(state);
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
  for (const d of state.dogs) stepDog(state.level, d, dt);
  stepAvalanche(state, dt);
  if (state.phase !== "playing") return;
  resolveContacts(state);

  if (state.player.y > pixelHeight(state.level) + TILE) kill(state);
}

/** Speed pays, but never negatively: a slow run simply earns no bonus. */
export function timeBonus(runTime: number): number {
  return Math.max(0, Math.round((TIME_BONUS_WINDOW - runTime) * TIME_BONUS_RATE));
}

/** What the cat is carrying, in flower-equivalents. */
export function harvest(state: GameState): number {
  const flowers = state.flowers.filter((f) => f.taken).length;
  const leaves = state.monstera.filter((m) => m.taken).length;
  return flowers + leaves * MONSTERA_VALUE;
}

export type Ending = "shore" | "raft" | "sailboat" | "ship";

export function endingFor(carried: number): Ending {
  if (carried >= SHIP_THRESHOLD) return "ship";
  if (carried >= SAILBOAT_THRESHOLD) return "sailboat";
  if (carried >= SAIL_THRESHOLD) return "raft";
  return "shore";
}

export const IDLE_INPUT = NO_INPUT;
