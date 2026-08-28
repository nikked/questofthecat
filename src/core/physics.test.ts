import { describe, expect, it } from "vitest";
import { TILE, parseLevel } from "./level";
import {
  SOLID,
  NO_INPUT,
  RUN_SPEED,
  WALK_SPEED,
  horizontalSpeed,
  inputDirection,
  overlaps,
  sweepX,
  sweepY,
  wallContact,
  type Input,
} from "./physics";

const level = parseLevel({ rows: [
  "    ",
  "  # ",
  "####",
] });

const press = (keys: Partial<Input>): Input => ({ ...NO_INPUT, ...keys });

describe("sweepX", () => {
  it("passes through empty space", () => {
    expect(sweepX(level, { x: 0, y: 0, w: 8, h: 8 }, 4)).toEqual({ value: 4, hit: false });
  });

  it("snaps the right edge flush against a wall", () => {
    const r = { x: TILE, y: TILE, w: 8, h: 8 };
    expect(sweepX(level, r, 12)).toEqual({ value: 2 * TILE - 8, hit: true });
  });

  it("snaps the left edge flush against a wall", () => {
    const r = { x: 3 * TILE, y: TILE, w: 8, h: 8 };
    expect(sweepX(level, r, -12)).toEqual({ value: 3 * TILE, hit: true });
  });

  it("ignores a wall the body does not vertically overlap", () => {
    const r = { x: TILE, y: 0, w: 8, h: 8 };
    expect(sweepX(level, r, 12).hit).toBe(false);
  });
});

describe("sweepY", () => {
  it("lands the bottom edge exactly on the ground", () => {
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(sweepY(level, r, 40)).toEqual({ value: 2 * TILE - 8, hit: true });
  });

  it("stops the top edge under a ceiling", () => {
    const r = { x: 2 * TILE, y: 2 * TILE, w: 8, h: 8 };
    expect(sweepY(level, r, -12)).toEqual({ value: 2 * TILE, hit: true });
  });

  it("does not report a hit while airborne", () => {
    expect(sweepY(level, { x: 0, y: 0, w: 8, h: 8 }, 4).hit).toBe(false);
  });
});

describe("horizontalSpeed", () => {
  const dt = 1 / 120;

  it("accelerates toward walk speed without overshooting", () => {
    expect(horizontalSpeed(0, press({ right: true }), true, dt, SOLID)).toBeCloseTo(SOLID.accel * dt);
    expect(horizontalSpeed(WALK_SPEED - 0.1, press({ right: true }), true, dt, SOLID)).toBe(WALK_SPEED);
  });

  it("reaches a higher top speed while running", () => {
    expect(horizontalSpeed(RUN_SPEED - 0.1, press({ right: true, run: true }), true, dt, SOLID)).toBe(
      RUN_SPEED,
    );
  });

  it("turns faster than it accelerates", () => {
    const fromStop = horizontalSpeed(0, press({ left: true }), true, dt, SOLID);
    const fromRunning = horizontalSpeed(50, press({ left: true }), true, dt, SOLID);
    expect(fromRunning - 50).toBeLessThan(fromStop);
  });

  it("brakes to a dead stop on the ground and never past it", () => {
    expect(horizontalSpeed(2, NO_INPUT, true, dt, SOLID)).toBe(0);
    expect(horizontalSpeed(-2, NO_INPUT, true, dt, SOLID)).toBe(0);
  });

  it("keeps air momentum when nothing is pressed", () => {
    expect(horizontalSpeed(80, NO_INPUT, false, dt, SOLID)).toBe(80);
  });

  it("decays from run speed to walk speed after the run key is released", () => {
    const decayed = horizontalSpeed(RUN_SPEED, press({ right: true }), true, dt, SOLID);
    expect(decayed).toBeLessThan(RUN_SPEED);
    expect(decayed).toBeGreaterThan(WALK_SPEED);
  });
});

describe("wallContact", () => {
  const walls = parseLevel({ rows: ["#..#", "#..#", "####"] });

  it("reports the side the body is flush against", () => {
    expect(wallContact(walls, { x: TILE, y: 0, w: 11, h: 14 })).toBe(-1);
    expect(wallContact(walls, { x: 3 * TILE - 11, y: 0, w: 11, h: 14 })).toBe(1);
  });

  it("reports nothing when clear of both walls", () => {
    expect(wallContact(walls, { x: TILE + 8, y: 0, w: 11, h: 14 })).toBe(0);
  });

  it("catches from a few pixels out, not only flush", () => {
    const near = { x: TILE + 3, y: 0, w: 11, h: 14 };
    expect(wallContact(walls, near)).toBe(0);
    expect(wallContact(walls, near, 5)).toBe(-1);
  });
});

describe("inputDirection", () => {
  it("cancels opposing keys", () => {
    expect(inputDirection(press({ left: true, right: true }))).toBe(0);
    expect(inputDirection(press({ left: true }))).toBe(-1);
    expect(inputDirection(press({ right: true }))).toBe(1);
    expect(inputDirection(NO_INPUT)).toBe(0);
  });
});

describe("overlaps", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };

  it("is false for touching edges", () => {
    expect(overlaps(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it("is true for a one-pixel intersection", () => {
    expect(overlaps(a, { x: 9, y: 9, w: 10, h: 10 })).toBe(true);
  });
});
