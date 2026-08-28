import { TILE, solidAt, type Level } from "./level";

/** Keeps a body's leading edge from landing exactly on a tile seam. */
const EPS = 1e-6;

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type Sweep = {
  readonly value: number;
  readonly hit: boolean;
};

/**
 * Both sweeps assume |delta| < TILE, which the fixed timestep guarantees:
 * the fastest body moves under 2px per step.
 */
export function sweepX(level: Level, r: Rect, dx: number): Sweep {
  const nx = r.x + dx;
  if (dx === 0) return { value: nx, hit: false };

  const top = Math.floor(r.y / TILE);
  const bottom = Math.floor((r.y + r.h - EPS) / TILE);
  const col = dx > 0 ? Math.floor((nx + r.w - EPS) / TILE) : Math.floor(nx / TILE);

  for (let ty = top; ty <= bottom; ty++) {
    if (solidAt(level, col, ty)) {
      return { value: dx > 0 ? col * TILE - r.w : (col + 1) * TILE, hit: true };
    }
  }
  return { value: nx, hit: false };
}

export function sweepY(level: Level, r: Rect, dy: number): Sweep {
  const ny = r.y + dy;
  if (dy === 0) return { value: ny, hit: false };

  const left = Math.floor(r.x / TILE);
  const right = Math.floor((r.x + r.w - EPS) / TILE);
  const row = dy > 0 ? Math.floor((ny + r.h - EPS) / TILE) : Math.floor(ny / TILE);

  for (let tx = left; tx <= right; tx++) {
    if (solidAt(level, tx, row)) {
      return { value: dy > 0 ? row * TILE - r.h : (row + 1) * TILE, hit: true };
    }
  }
  return { value: ny, hit: false };
}

export type Side = -1 | 0 | 1;

/**
 * Which side the body is within `reach` of: -1 a wall to its left, 1 to its
 * right. The level's own edges are solid so nothing walks out of the world, but
 * they are not real walls and must not be climbable.
 */
export function wallContact(level: Level, r: Rect, reach = 1): Side {
  const top = Math.floor(r.y / TILE);
  const bottom = Math.floor((r.y + r.h - EPS) / TILE);

  for (const dir of [-1, 1] as const) {
    const edge = dir < 0 ? r.x - reach : r.x + r.w + reach - 1;
    const near = dir < 0 ? r.x - 1 : r.x + r.w;
    const from = Math.floor(Math.min(edge, near) / TILE);
    const to = Math.floor(Math.max(edge, near) / TILE);
    for (let col = from; col <= to; col++) {
      if (col < 0 || col >= level.width) continue;
      for (let ty = top; ty <= bottom; ty++) {
        if (solidAt(level, col, ty)) return dir;
      }
    }
  }
  return 0;
}

/** The direction the player is asking to move, independent of speed. */
export function inputDirection(input: Input): Side {
  return ((input.right ? 1 : 0) - (input.left ? 1 : 0)) as Side;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export const MAX_FALL = 420;
export const JUMP_SPEED = 320;
/**
 * Holding jump buys a weaker gravity for as long as the cat is still rising, so
 * height tracks hold time continuously instead of snapping between two arcs.
 */
export const JUMP_GRAVITY = 900;
export const FALL_GRAVITY = 1900;
/** Applied once, on the frame the key comes up, to end the rise cleanly. */
export const JUMP_CUT = 0.45;
export const STOMP_BOUNCE = 300;
export const WALK_SPEED = 95;
export const RUN_SPEED = 165;
export const AIR_ACCEL = 550;

/** What the ground under the cat does to its horizontal speed. */
export type Surface = {
  readonly accel: number;
  readonly turn: number;
  readonly friction: number;
};

export const SOLID: Surface = { accel: 900, turn: 1700, friction: 1100 };
/** Ice keeps almost all momentum, so stopping and turning take real planning. */
export const ICE: Surface = { accel: 260, turn: 380, friction: 90 };
export const COYOTE_TIME = 0.09;
export const JUMP_BUFFER = 0.13;

/** Terminal speed while sliding down a wall, well under a free fall. */
export const WALL_SLIDE_SPEED = 52;
/**
 * How far from a wall the claws still catch. Requiring pixel contact made the
 * move feel broken; a few pixels of reach makes it feel like a cat.
 */
export const WALL_REACH = 5;
export const WALL_JUMP_Y = 330;
export const WALL_JUMP_X = 155;
/** Grace after sliding off the end of a wall, mirroring ground coyote time. */
export const WALL_COYOTE = 0.15;
/**
 * Horizontal input is ignored briefly after a kick. Without it, still holding
 * into the wall cancels the push and the cat never leaves.
 */
export const WALL_LOCK = 0.12;

export type Input = {
  readonly left: boolean;
  readonly right: boolean;
  readonly jump: boolean;
  readonly run: boolean;
};

export const NO_INPUT: Input = { left: false, right: false, jump: false, run: false };

/**
 * Target-speed model: pick the speed the input asks for, then move toward it.
 * Turning uses a higher rate than accelerating so direction changes feel
 * immediate without raising top-speed acceleration.
 */
export function horizontalSpeed(
  vx: number,
  input: Input,
  grounded: boolean,
  dt: number,
  surface: Surface,
): number {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const max = input.run ? RUN_SPEED : WALK_SPEED;

  if (dir === 0) {
    if (!grounded) return vx;
    const drop = surface.friction * dt;
    return Math.abs(vx) <= drop ? 0 : vx - Math.sign(vx) * drop;
  }

  const target = dir * max;
  const turning = vx !== 0 && Math.sign(vx) !== dir;
  const rate = turning ? surface.turn : grounded ? surface.accel : AIR_ACCEL;
  const step = rate * dt;

  // Already over the target (e.g. released run while fast) coasts down by friction.
  if (Math.abs(vx) > max && !turning) {
    const drop = (grounded ? surface.friction : 0) * dt;
    const decayed = vx - Math.sign(vx) * drop;
    return Math.sign(decayed) === dir ? decayed : 0;
  }

  return vx < target ? Math.min(vx + step, target) : Math.max(vx - step, target);
}

export function fallSpeed(vy: number, dt: number, gravity: number): number {
  return Math.min(vy + gravity * dt, MAX_FALL);
}

/** Gravity is only gentle while the cat is rising and the key is still down. */
export function jumpGravity(vy: number, holding: boolean): number {
  return holding && vy < 0 ? JUMP_GRAVITY : FALL_GRAVITY;
}
