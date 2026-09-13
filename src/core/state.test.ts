import { describe, expect, it } from "vitest";
import { TILE, Tile, tileAt } from "./level";
import {
  JUMP_BUFFER,
  NO_INPUT,
  RUN_SPEED,
  overlaps,
  SLIDE_H,
  SPIN_CANCEL,
  SPIN_TIME,
  WALL_SLIDE_SPEED,
  type Input,
} from "./physics";
import {
  BREEDS,
  BOSS_POINTS,
  dogRect,
  FLOWER_POINTS,
  GOAL_POINTS,
  MONSTERA_POINTS,
  STOMP_POINTS,
  timeBonus,
  MONSTERA_VALUE,
  PLAYER_H,
  STARTING_LIVES,
  TRACE_HZ,
  BOUNCE_LIMIT,
  TNT_FUSE,
  EXPLOSION_TIME,
  respawn,
  createState,
  endingFor,
  playerRect,
  harvest,
  resetLevel,
  step,
  type GameState,
} from "./state";

const DT = 1 / 120;

describe("score-based endings", () => {
  it.each([
    [0, "shore"],
    [15_999, "shore"],
    [16_000, "raft"],
    [25_999, "raft"],
    [26_000, "sailboat"],
    [35_999, "sailboat"],
    [36_000, "ship"],
    [50_000, "ship"],
  ] as const)("awards %s points the %s ending", (score, ending) => {
    expect(endingFor(score)).toBe(ending);
  });
});

const press = (keys: Partial<Input>): Input => ({ ...NO_INPUT, ...keys });

function start(rows: readonly string[]): GameState {
  const state = createState({ rows });
  resetLevel(state);
  return state;
}

function run(state: GameState, seconds: number, input: Input = NO_INPUT): void {
  for (let t = 0; t < seconds; t += DT) step(state, input, DT);
}

/** Steps until the cat has died and respawned, or gives up. Returns success. */
function runUntilRespawn(state: GameState, input: Input, seconds = 3): boolean {
  const target = state.deaths + 1;
  for (let t = 0; t < seconds; t += DT) {
    step(state, input, DT);
    if (state.deaths === target) return true;
  }
  return false;
}

describe("gravity and landing", () => {
  it("settles the cat on the ground and stays there", () => {
    const state = start(["  ", "C ", "##"]);
    run(state, 1);

    expect(state.player.y).toBe(2 * TILE - PLAYER_H);
    expect(state.player.grounded).toBe(true);
    expect(state.player.vy).toBe(0);
  });
});

describe("jumping", () => {
  const rows = ["      ", "      ", "      ", "C     ", "######"];

  it("clears at least three tiles when held", () => {
    const state = start(rows);
    run(state, 0.5);
    const floor = state.player.y;

    let peak = floor;
    for (let t = 0; t < 0.6; t += DT) {
      step(state, press({ jump: true }), DT);
      peak = Math.min(peak, state.player.y);
    }
    expect(floor - peak).toBeGreaterThan(3 * TILE);
  });

  it("goes noticeably lower when the jump is tapped", () => {
    const state = start(rows);
    run(state, 0.5);
    const floor = state.player.y;

    let peak = floor;
    for (let t = 0; t < 0.6; t += DT) {
      step(state, t < 0.06 ? press({ jump: true }) : NO_INPUT, DT);
      peak = Math.min(peak, state.player.y);
    }
    const height = floor - peak;
    expect(height).toBeGreaterThan(TILE);
    expect(height).toBeLessThan(2.5 * TILE);
  });

  it("maps hold time to height continuously", () => {
    const heights = [0.05, 0.12, 0.25, 0.6].map((hold) => {
      const state = start(rows);
      run(state, 0.5);
      const floor = state.player.y;

      let peak = floor;
      for (let t = 0; t < 0.8; t += DT) {
        step(state, t < hold ? press({ jump: true }) : NO_INPUT, DT);
        peak = Math.min(peak, state.player.y);
      }
      return floor - peak;
    });

    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
    }
    // A brief tap and a full hold must feel like different jumps, not one arc.
    expect(heights[3]!).toBeGreaterThan(heights[0]! * 2);
  });

  it("buffers a jump pressed just before landing", () => {
    const state = start(rows);
    run(state, 0.5);

    step(state, press({ jump: true }), DT);
    expect(state.player.buffer).toBe(0);
    expect(state.player.vy).toBeLessThan(0);
  });

  it("holding jump does not re-arm the buffer for a second jump", () => {
    const state = start(rows);
    run(state, 0.5);
    run(state, 0.02, press({ jump: true }));
    const rising = state.player.vy;

    run(state, 0.1, press({ jump: true }));
    expect(state.player.buffer).toBe(0);
    expect(state.player.vy).toBeGreaterThan(rising);
  });

  it("allows a jump within coyote time after walking off a ledge", () => {
    const state = start(["    ", "C   ", "##  "]);
    run(state, 0.5);
    run(state, 0.35, press({ right: true, run: true }));

    expect(state.player.grounded).toBe(false);
    expect(state.player.coyote).toBeGreaterThan(0);

    step(state, press({ right: true, jump: true }), DT);
    expect(state.player.vy).toBeLessThan(0);
  });

  it("refuses a jump once coyote time has run out", () => {
    const state = start(["    ", "C   ", "##  ", "    ", "    ", "    ", "    ", "    "]);
    run(state, 0.5);
    run(state, 0.55, press({ right: true, run: true }));

    expect(state.player.coyote).toBe(0);
    step(state, press({ jump: true }), DT);
    // Still falling: the press was banked, not spent.
    expect(state.player.vy).toBeGreaterThan(0);
    expect(state.player.buffer).toBe(JUMP_BUFFER);
  });
});

describe("wall cling", () => {
  // A two-tile shaft: solid walls at columns 0 and 3, open air between.
  const shaft = [
    "#..#",
    "#..#",
    "#..#",
    "#..#",
    "#..#",
    "#..#",
    "#..#",
    "#..#",
    "#..#",
    "#C.#",
    "####",
  ];

  function fallBeside(input: Input, seconds: number): GameState {
    const state = start(shaft);
    run(state, 0.4);
    // Hop up so the cat is airborne alongside the left wall.
    run(state, 0.25, press({ jump: true, left: true }));
    run(state, seconds, input);
    return state;
  }

  it("slows the fall to the slide speed while pressed into a wall", () => {
    const clinging = fallBeside(press({ left: true }), 0.2);
    expect(clinging.player.cling).toBe(-1);
    expect(clinging.player.vy).toBeLessThanOrEqual(WALL_SLIDE_SPEED);
  });

  it("does not grip a wall the player is not pressing into", () => {
    const falling = fallBeside(NO_INPUT, 0.2);
    expect(falling.player.cling).toBe(0);
    expect(falling.player.vy).toBeGreaterThan(WALL_SLIDE_SPEED);
  });

  it("never grips while standing on the ground", () => {
    const state = start(shaft);
    run(state, 0.6, press({ left: true }));

    expect(state.player.grounded).toBe(true);
    expect(state.player.cling).toBe(0);
  });

  it("kicks up and away from the wall", () => {
    const state = fallBeside(press({ left: true }), 0.25);
    expect(state.player.cling).toBe(-1);

    step(state, press({ left: true, jump: true }), DT);
    expect(state.player.vy).toBeLessThan(0);
    expect(state.player.vx).toBeGreaterThan(0);
    expect(state.player.facing).toBe(1);
  });

  it("holds the kick even while the player keeps pressing into the wall", () => {
    const state = fallBeside(press({ left: true }), 0.25);
    step(state, press({ left: true, jump: true }), DT);
    const kicked = state.player.vx;

    run(state, 0.06, press({ left: true, jump: true }));
    expect(state.player.vx).toBe(kicked);
    expect(state.player.x).toBeGreaterThan(TILE);
  });

  it("climbs a shaft by alternating kicks off each wall", () => {
    const state = start(shaft);
    run(state, 0.4);
    const floor = state.player.y;

    // A plain human rhythm: alternate the held direction, tap jump each cycle.
    const CYCLE = 0.35;
    const HOLD = 0.25;
    let peak = floor;
    let clock = 0;
    let side = -1;

    for (let t = 0; t < 3; t += DT) {
      clock += DT;
      if (clock >= CYCLE) {
        clock = 0;
        side = -side;
      }
      const jump = clock < HOLD;
      step(state, press({ left: side < 0, right: side > 0, jump }), DT);
      peak = Math.min(peak, state.player.y);
    }

    // A real climb has to clear more than any single jump can reach.
    expect(floor - peak).toBeGreaterThan(4 * TILE);
  });
});

describe("dogs", () => {
  it("turn around at a wall", () => {
    const state = start(["#          C", "#d          ", "############"]);
    const dog = state.dogs[0]!;
    run(state, 1);

    expect(dog.vx).toBeGreaterThan(0);
    expect(dog.x).toBeGreaterThanOrEqual(TILE);
  });

  it("turn around at a ledge instead of walking off", () => {
    const state = start(["          C", " d         ", " ###   ####"]);
    const dog = state.dogs[0]!;
    run(state, 4);

    expect(dog.y).toBe(2 * TILE - BREEDS.terrier.h);
    expect(dog.x).toBeGreaterThanOrEqual(TILE);
    expect(dog.x + BREEDS.terrier.w).toBeLessThanOrEqual(4 * TILE);
  });
});

describe("dog breeds and behaviour", () => {
  it("spawns each breed at its own size and speed", () => {
    const state = start(["       ", "       ", "C  d D ", "#######"]);
    const [terrier, retriever] = state.dogs;

    expect(terrier!.breed).toBe("terrier");
    expect(retriever!.breed).toBe("retriever");
    expect(dogRect(retriever!).w).toBeGreaterThan(dogRect(terrier!).w);
    expect(BREEDS.retriever.speed).toBeLessThan(BREEDS.terrier.speed);
  });

  it("stops moving while it scratches or sniffs", () => {
    // Walled off from the cat: a dog that reaches it triggers a respawn, and
    // respawn replaces the dogs, so this reference would go stale mid-test.
    const state = start(["          ", "          ", "C   #   d ", "##########"]);
    const dog = state.dogs[0]!;

    let sawIdle = false;
    let movedWhileIdle = false;
    for (let t = 0; t < 30; t += DT) {
      const before = dog.x;
      step(state, NO_INPUT, DT);
      if (dog.action !== "walk") {
        sawIdle = true;
        if (Math.abs(dog.x - before) > 0.001) movedWhileIdle = true;
      }
    }

    expect(sawIdle).toBe(true);
    expect(movedWhileIdle).toBe(false);
  });

  it("always goes back to walking", () => {
    const state = start(["          ", "          ", "C   #   d ", "##########"]);
    const dog = state.dogs[0]!;
    const seen = new Set<string>();
    for (let t = 0; t < 40; t += DT) {
      step(state, NO_INPUT, DT);
      seen.add(dog.action);
    }

    expect(seen.has("walk")).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("behaves identically for the same level, so replays match", () => {
    const trace = () => {
      const state = start(["          ", "          ", "C       d ", "##########"]);
      const out: number[] = [];
      for (let t = 0; t < 12; t += DT) {
        step(state, NO_INPUT, DT);
        out.push(Math.round(state.dogs[0]!.x * 100));
      }
      return out;
    };

    expect(trace()).toEqual(trace());
  });
});

describe("contacts", () => {
  it("stomping a dog kills it and bounces the cat", () => {
    const state = start(["  ", "C ", "  ", "d ", "##"]);
    const dog = state.dogs[0]!;
    dog.vx = 0;

    let bounceSpeed = 0;
    for (let t = 0; t < 1 && dog.alive; t += DT) {
      step(state, NO_INPUT, DT);
      bounceSpeed = state.player.vy;
    }

    expect(dog.alive).toBe(false);
    expect(bounceSpeed).toBeLessThan(0);
    expect(state.phase).toBe("playing");
  });

  it("walking into a dog costs a life and respawns the cat", () => {
    const state = start(["    ", "C  d", "####"]);
    run(state, 0.4);

    expect(runUntilRespawn(state, press({ right: true, run: true }))).toBe(true);
    expect(state.lives).toBe(STARTING_LIVES - 1);
    expect(state.phase).toBe("playing");
    expect(state.player.x).toBe(state.spawnX);
  });

  it("collecting a flower scores once", () => {
    const state = start(["  ", "Cf", "##"]);
    run(state, 1, press({ right: true }));

    expect(state.flowers[0]!.taken).toBe(true);
  });

  it("falling out of the level costs a life", () => {
    const state = start(["C ", "  "]);
    run(state, 1);

    expect(state.phase).toBe("dying");
  });

  it("reaching the goal wins", () => {
    const state = start(["   ", "C G", "###"]);
    run(state, 1.2, press({ right: true, run: true }));

    expect(state.phase).toBe("won");
  });

  it("extends the flagpole from its marker down to the floor", () => {
    const state = start(["  G", "   ", "   ", "C  ", "###"]);

    expect(state.goal).toEqual({ x: 2 * TILE + 8, y: 0, w: 16, h: 4 * TILE });
  });

  it("wins by touching the bottom of the pole", () => {
    const state = start(["  G", "   ", "   ", "C  ", "###"]);
    run(state, 1.5, press({ right: true, run: true }));

    expect(state.phase).toBe("won");
  });
});

describe("seasons", () => {
  const rows = ["      ", "C     ", "######"];
  const icy = (season: "summer" | "winter") =>
    createState({ rows, seasons: [{ season, fromTile: 0 }] });

  function slideDistance(season: "summer" | "winter"): number {
    const state = icy(season);
    resetLevel(state);
    run(state, 0.4);
    run(state, 0.6, press({ right: true, run: true }));
    const released = state.player.x;
    run(state, 0.6);
    return state.player.x - released;
  }

  it("keeps sliding on winter ice after the key is released", () => {
    expect(slideDistance("winter")).toBeGreaterThan(3 * slideDistance("summer"));
  });

  it("stops promptly on summer ground", () => {
    expect(slideDistance("summer")).toBeLessThan(TILE);
  });
});

describe("checkpoint crates", () => {
  it("moves the respawn point and chimes once, when broken", () => {
    const state = start(["      ", "      ", "C p   ", "######"]);
    run(state, 0.4);

    const emitted: string[] = [];
    for (let t = 0; t < 1.2; t += DT) {
      step(state, press({ right: true, run: true, spin: t > 0.5 }), DT);
      emitted.push(...state.sounds);
    }

    expect(emitted.filter((e) => e === "checkpoint")).toEqual(["checkpoint"]);
    expect(state.spawnX).toBe(2 * TILE);
    expect(state.score).toBe(0);
  });

  it("does nothing at all until it is broken", () => {
    const state = start(["      ", "      ", "C p   ", "######"]);
    run(state, 1.2, press({ right: true, run: true }));

    expect(state.spawnX).toBe(0);
  });

  it("respawns the cat where the crate stood", () => {
    const state = start(["          ", "          ", "C p      d", "##########"]);
    run(state, 0.4);
    for (let t = 0; t < 1.2; t += DT) {
      step(state, press({ right: true, run: true, spin: t > 0.5 }), DT);
    }

    expect(runUntilRespawn(state, press({ right: true, run: true }), 6)).toBe(true);
    expect(state.player.x).toBe(2 * TILE);
  });
});

describe("cacti", () => {
  it("kill on contact instead of being stompable", () => {
    const state = start(["      ", "      ", "C    x", "######"]);
    run(state, 0.4);

    expect(runUntilRespawn(state, press({ right: true, run: true }))).toBe(true);
  });

  it("can be cleared by jumping over", () => {
    const state = start([
      "              ",
      "              ",
      "C       x     ",
      "##############",
    ]);
    run(state, 0.4);

    for (let t = 0; t < 1.4; t += DT) {
      // Hold through the rise: releasing mid-jump would trigger the jump cut.
      const jump = state.player.x > 5 * TILE && (state.player.grounded || state.player.vy < 0);
      step(state, press({ right: true, run: true, jump }), DT);
    }

    expect(state.phase).toBe("playing");
    expect(state.player.x).toBeGreaterThan(9 * TILE);
  });
});

describe("scoring", () => {
  it("pays for flowers and monstera, but not broken crates", () => {
    const state = start(["      ", "      ", "CfM   ", "######"]);
    run(state, 0.6, press({ right: true }));
    expect(state.score).toBe(FLOWER_POINTS + MONSTERA_POINTS);

    const smashed = start(["      ", "      ", "C c   ", "######"]);
    run(smashed, 0.4);
    for (let t = 0; t < 1.2; t += DT) {
      step(smashed, press({ right: true, run: true, spin: t > 0.5 }), DT);
    }
    expect(smashed.score).toBe(0);
    expect(smashed.flowerCount).toBe(0);
    expect(tileAt(smashed.level, 2, 2)).toBe(Tile.Empty);
  });

  it("pays for a stomp", () => {
    const state = start(["  ", "C ", "  ", "d ", "##"]);
    state.dogs[0]!.vx = 0;
    run(state, 1);

    expect(state.dogs[0]!.alive).toBe(false);
    expect(state.score).toBe(STOMP_POINTS);
  });

  it.each([
    [30, 30000], [40, 20000], [50, 10000], [60, 5000],
    [70, 2500], [80, 1500], [90, 500],
    [35, 25000], [45, 15000], [55, 7500], [65, 3750],
    [75, 2000], [85, 1000], [80.554, 1445], [80.556, 1444],
    [0, 30000], [29.99, 30000], [90.01, 499], [92.5, 250], [95, 0], [180, 0],
  ])("awards %s-second runs %s speed bonus points", (seconds, points) => {
    expect(timeBonus(seconds)).toBe(points);
  });

  it("has no reward jumps at the curve boundaries", () => {
    for (const seconds of [30, 40, 50, 60, 70, 80, 90, 95]) {
      const before = timeBonus(seconds - 0.001);
      const after = timeBonus(seconds + 0.001);
      expect(before).toBeGreaterThanOrEqual(after);
      expect(before - after).toBeLessThanOrEqual(2);
    }
  });

  it.each([1, 3, 9, 10])("adds finish bonuses once with %s lives remaining", (lives) => {
    const state = start(["   ", "C G", "###"]);
    state.lives = lives;
    run(state, 1.2, press({ right: true, run: true }));

    expect(state.phase).toBe("won");
    expect(state.score).toBe(GOAL_POINTS + timeBonus(state.runTime) + lives * 2500);
    const finalScore = state.score;
    run(state, 5);
    expect(state.score).toBe(finalScore);
  });

  it("resets to zero on a new run", () => {
    const state = start(["  ", "Cf", "##"]);
    run(state, 0.6, press({ right: true }));
    expect(state.score).toBeGreaterThan(0);

    resetLevel(state);
    expect(state.score).toBe(0);
  });
});

describe("the run clock", () => {
  const rows = ["      ", "      ", "C     ", "######"];

  it("does not start until the player moves", () => {
    const state = start(rows);
    run(state, 0.5);

    expect(state.started).toBe(false);
    expect(state.runTime).toBe(0);
  });

  it("starts on the first input and keeps counting", () => {
    const state = start(rows);
    run(state, 0.5);
    run(state, 0.4, press({ right: true }));

    expect(state.started).toBe(true);
    expect(state.runTime).toBeCloseTo(0.4, 1);
  });

  it("keeps running through a death, because time is the punishment", () => {
    const state = start(["      ", "      ", "C    d", "######"]);
    run(state, 0.3, press({ right: true, run: true }));
    run(state, 1.2, press({ right: true, run: true }));

    expect(state.deaths).toBe(1);
    expect(state.runTime).toBeCloseTo(1.5, 1);
  });
});

describe("lives", () => {
  it("restarts the level when the counter empties, and refills it", () => {
    const state = start(["      ", "      ", "C    d", "######"]);

    for (let i = 0; i < 12; i++) {
      run(state, 1.4, press({ right: true, run: true }));
    }

    expect(state.deaths).toBeGreaterThan(STARTING_LIVES);
    // Running out costs the level, not the run: the counter comes back full.
    expect(state.lives).toBeGreaterThan(0);
    expect(state.lives).toBeLessThanOrEqual(STARTING_LIVES);
    expect(state.phase).not.toBe("won");
    expect(["playing", "dying"]).toContain(state.phase);
  });
});

describe("respawn", () => {
  it("keeps flowers already collected", () => {
    const state = start(["      ", "      ", "Cf   d", "######"]);
    run(state, 0.3, press({ right: true, run: true }));
    expect(state.flowers[0]!.taken).toBe(true);

    expect(runUntilRespawn(state, press({ right: true, run: true }))).toBe(true);
    expect(state.flowers[0]!.taken).toBe(true);
  });

  it("revives dogs so the stretch is playable again", () => {
    const state = start(["      ", "      ", "C  d d", "######"]);
    run(state, 0.3);
    state.dogs[0]!.alive = false;

    expect(runUntilRespawn(state, press({ right: true, run: true }))).toBe(true);
    expect(state.dogs.every((d) => d.alive)).toBe(true);
  });
});

describe("what the cat carries", () => {
  it("counts a monstera as an armful of flowers", () => {
    const state = start(["      ", "      ", "CfM   ", "######"]);
    expect(harvest(state)).toBe(0);

    run(state, 0.6, press({ right: true }));
    expect(harvest(state)).toBe(1 + MONSTERA_VALUE);
  });

  it("keeps monstera through a death, like flowers", () => {
    const state = start(["      ", "      ", "CM   d", "######"]);
    run(state, 0.3, press({ right: true, run: true }));
    expect(state.monstera[0]!.taken).toBe(true);

    expect(runUntilRespawn(state, press({ right: true, run: true }))).toBe(true);
    expect(state.monstera[0]!.taken).toBe(true);
  });
});

describe("the run trace", () => {
  it("records nothing before the run starts", () => {
    const state = start(["      ", "C     ", "######"]);
    run(state, 0.5);

    expect(state.trace).toEqual([]);
  });

  it("samples the cat at a steady rate once moving", () => {
    const state = start(["          ", "C         ", "##########"]);
    run(state, 1, press({ right: true }));

    expect(state.trace.length / 2).toBeCloseTo(TRACE_HZ, -1);
    // Pairs of finite coordinates, advancing to the right.
    expect(state.trace.every((n) => Number.isFinite(n))).toBe(true);
    expect(state.trace[state.trace.length - 2]!).toBeGreaterThan(state.trace[0]!);
  });
});

describe("the avalanche", () => {
  // A shaft two columns wide with walls either side and a floor at row 6.
  const rows = [
    "#..#..",
    "#..#..",
    "#..#..",
    "#..#..",
    "#.....",
    "#...C.",
    "######",
  ];
  const source = { rows, chimney: { fromTile: 1, toTile: 2 } };

  function inShaft(): GameState {
    const state = createState(source);
    resetLevel(state);
    run(state, 0.4);
    // Walk left into the shaft.
    run(state, 0.5, press({ left: true, run: true }));
    return state;
  }

  it("stays dormant until the cat commits to the shaft", () => {
    const state = createState(source);
    resetLevel(state);
    run(state, 0.6);

    expect(state.avalanche.active).toBe(false);
  });

  it("fills the shaft once the cat is inside", () => {
    const state = inShaft();
    expect(state.avalanche.active).toBe(true);

    const start = state.avalanche.y;
    run(state, 0.3, press({ left: true }));
    expect(state.avalanche.y).toBeLessThan(start);
  });

  it("buries a cat that stays at the bottom", () => {
    const state = inShaft();
    const deaths = state.deaths;
    run(state, 6, press({ left: true }));

    expect(state.deaths).toBeGreaterThan(deaths);
  });

  it("resets when the cat backs out of the shaft", () => {
    const state = inShaft();
    expect(state.avalanche.active).toBe(true);

    run(state, 0.6, press({ right: true, run: true }));
    expect(state.avalanche.active).toBe(false);
  });
});

describe("sound events", () => {
  const rows = ["      ", "      ", "      ", "C    f", "######"];

  it("emits one jump per takeoff, not per frame held", () => {
    const state = start(rows);
    run(state, 0.5);

    const emitted: string[] = [];
    for (let t = 0; t < 0.4; t += DT) {
      step(state, press({ jump: true }), DT);
      emitted.push(...state.sounds);
    }
    expect(emitted).toEqual(["jump"]);
  });

  it("emits a flower sound the moment one is collected", () => {
    const state = start(rows);
    run(state, 0.4);

    const emitted: string[] = [];
    for (let t = 0; t < 1.2; t += DT) {
      step(state, press({ right: true, run: true }), DT);
      emitted.push(...state.sounds);
    }
    expect(emitted).toEqual(["flower"]);
  });

  it("scrapes once when the claws catch, not every frame of the slide", () => {
    const shaft = ["#..#", "#..#", "#..#", "#..#", "#..#", "#C.#", "####"];
    const state = start(shaft);
    run(state, 0.4);

    const emitted: string[] = [];
    for (let t = 0; t < 0.6; t += DT) {
      step(state, press({ jump: t < 0.2, left: true }), DT);
      emitted.push(...state.sounds);
    }

    expect(emitted.filter((e) => e === "grip")).toEqual(["grip"]);
  });

  it("clears the queue every step so nothing replays", () => {
    const state = start(rows);
    run(state, 0.5);

    step(state, press({ jump: true }), DT);
    expect(state.sounds).toEqual(["jump"]);
    step(state, press({ jump: true }), DT);
    expect(state.sounds).toEqual([]);
  });
});

describe("head bumps", () => {
  it("breaks a crate jumped into from beneath", () => {
    const state = start(["    ", " c  ", "    ", " C  ", "####"]);
    run(state, 0.4);
    expect(tileAt(state.level, 1, 1)).toBe(Tile.CratePlain);

    run(state, 0.5, press({ jump: true }));
    expect(tileAt(state.level, 1, 1)).toBe(Tile.Empty);
  });
});

describe("the spin", () => {
  it("reaches a crate the cat is not touching", () => {
    const state = start(["      ", "      ", "Cc    ", "######"]);
    run(state, 0.4);
    expect(tileAt(state.level, 1, 2)).toBe(Tile.CratePlain);

    run(state, 0.2, press({ spin: true }));
    expect(tileAt(state.level, 1, 2)).toBe(Tile.Empty);
  });

  it("runs for a fixed time and then has to cool down", () => {
    const state = start(["      ", "      ", "C     ", "######"]);
    run(state, 0.4);

    step(state, press({ spin: true }), DT);
    expect(state.player.action).toBe("spin");

    run(state, SPIN_TIME, press({ spin: true }));
    expect(state.player.action).toBe("none");
    expect(state.player.spinCooldown).toBeGreaterThan(0);
  });

  it("can be abandoned into a jump once the cancel window opens", () => {
    const state = start(["      ", "      ", "C     ", "######"]);
    run(state, 0.4);

    step(state, press({ spin: true }), DT);
    run(state, SPIN_CANCEL + 0.02, press({ spin: true }));
    expect(state.player.action).toBe("spin");

    run(state, 0.05, press({ spin: true, jump: true }));
    expect(state.player.action).toBe("none");
    expect(state.player.vy).toBeLessThan(0);
  });
});

describe("the slide", () => {
  const tunnel = [
    "            ",
    "      ###   ",
    "C           ",
    "############",
  ];

  it("is ignored without the momentum to carry it", () => {
    const state = start(["      ", "      ", "C     ", "######"]);
    run(state, 0.4);

    step(state, press({ down: true }), DT);
    expect(state.player.action).toBe("none");
  });

  it("drops the hitbox to half height", () => {
    const state = start(["            ", "            ", "C           ", "############"]);
    run(state, 0.5, press({ right: true, run: true }));

    step(state, press({ right: true, run: true, down: true }), DT);
    expect(state.player.action).toBe("slide");
    expect(playerRect(state.player).h).toBe(SLIDE_H);
  });

  it("passes under a roof that stops a standing cat", () => {
    const blocked = start(tunnel);
    run(blocked, 2, press({ right: true, run: true }));
    expect(blocked.player.x).toBeLessThan(6 * TILE);

    const slid = start(tunnel);
    run(slid, 0.4, press({ right: true, run: true }));
    run(slid, 2, press({ right: true, run: true, down: true }));
    expect(slid.player.x).toBeGreaterThan(9 * TILE);
  });

  it("launches faster than a run can", () => {
    const state = start(["            ", "            ", "C           ", "############"]);
    run(state, 0.5, press({ right: true, run: true }));
    step(state, press({ right: true, run: true, down: true }), DT);
    run(state, 0.05, press({ right: true, run: true, jump: true }));

    expect(state.player.vx).toBeGreaterThan(RUN_SPEED);
  });
});

describe("the body slam", () => {
  it("breaks the crate it lands on", () => {
    const state = start(["    ", " C  ", "    ", " c  ", "####"]);
    run(state, 0.02);
    run(state, 0.6, press({ down: true }));

    expect(tileAt(state.level, 1, 3)).toBe(Tile.Empty);
  });

  it("falls faster than gravity alone", () => {
    const plain = start(["    ", " C  ", "    ", "    ", "####"]);
    const slammed = start(["    ", " C  ", "    ", "    ", "####"]);
    run(plain, 0.02);
    run(slammed, 0.02);

    run(plain, 0.1);
    run(slammed, 0.1, press({ down: true }));
    expect(slammed.player.y).toBeGreaterThan(plain.player.y);
  });
});

describe("crates", () => {
  it("lights a TNT that is landed on, and takes its neighbours with it", () => {
    const state = start(["      ", " C    ", "      ", "ctc   ", "######"]);
    run(state, 0.6);

    const lit = state.crates.get(3 * state.level.width + 1);
    expect(lit?.fuse).toBeGreaterThan(0);

    run(state, TNT_FUSE + 0.3);
    expect(tileAt(state.level, 0, 3)).toBe(Tile.Empty);
    expect(tileAt(state.level, 1, 3)).toBe(Tile.Empty);
    expect(tileAt(state.level, 2, 3)).toBe(Tile.Empty);
  });

  it("kills on any contact with nitro", () => {
    const state = start(["      ", "      ", "C n   ", "######"]);
    run(state, 0.4);

    expect(runUntilRespawn(state, press({ right: true, run: true }))).toBe(true);
  });

  it("clears nitro only by blast, never by a verb", () => {
    const spun = start(["      ", "      ", "Cn    ", "######"]);
    run(spun, 0.4);
    run(spun, 0.3, press({ spin: true }));
    expect(tileAt(spun.level, 1, 2)).toBe(Tile.CrateNitro);

    const blown = start(["      ", " C    ", "      ", " tn   ", "######"]);
    run(blown, 0.6);
    run(blown, TNT_FUSE + 0.3);
    expect(tileAt(blown.level, 2, 3)).toBe(Tile.Empty);
  });

  it("bounces higher each time and breaks on the last", () => {
    const state = start(["    ", " C  ", "    ", " ^  ", "####"]);
    const launches: number[] = [];
    for (let t = 0; t < 8; t += DT) {
      step(state, NO_INPUT, DT);
      if (state.sounds.includes("bounce")) launches.push(-state.player.vy);
    }

    expect(launches.length).toBe(BOUNCE_LIMIT);
    expect(state.score).toBe(0);
    expect(launches[1]!).toBeGreaterThan(launches[0]!);
    expect(tileAt(state.level, 1, 3)).toBe(Tile.Empty);
  });

  it("pays a life for every hundredth flower", () => {
    const state = start(["      ", "      ", "Cffff ", "######"]);
    state.flowerCount = 99;
    const before = state.lives;
    run(state, 1, press({ right: true, run: true }));

    expect(state.lives).toBe(before + 1);
  });
});

describe("what answers which enemy", () => {
  /** Parks the animal so the test is about the verb, not about its patrol. */
  function still(state: GameState): void {
    const d = state.dogs[0]!;
    d.vx = 0;
    d.action = "sniff";
    d.actionTime = 99;
  }

  const spinCases = [
    ["d", "terrier", true],
    ["D", "retriever", true],
    ["h", "hedgehog", false],
    ["w", "wasp", true],
  ] as const;

  for (const [ch, name, dies] of spinCases) {
    it(`${name}: a spin ${dies ? "kills it" : "does nothing"}`, () => {
      const state = start(["        ", "        ", `C   ${ch}   `, "########"]);
      still(state);
      state.player.x = 3 * TILE;
      run(state, 0.3);
      run(state, 0.3, press({ spin: true }));

      expect(state.dogs[0]!.alive).toBe(!dies);
    });
  }

  it("terrier: a stomp kills it", () => {
    const state = start(["  ", "C ", "  ", "d ", "##"]);
    state.dogs[0]!.vx = 0;
    run(state, 1);

    expect(state.dogs[0]!.alive).toBe(false);
    expect(state.phase).toBe("playing");
  });

  it("retriever: a stomp hurts the cat instead", () => {
    const state = start(["  ", "C ", "  ", "D ", "##"]);
    state.dogs[0]!.vx = 0;
    run(state, 1);

    expect(state.dogs[0]!.alive).toBe(true);
    expect(state.deaths).toBeGreaterThan(0);
  });

  it("hedgehog: a slide passes under it, a run into it does not", () => {
    const rows = ["            ", "            ", "C     h     ", "############"];
    const walked = start(rows);
    still(walked);
    run(walked, 0.4);
    expect(runUntilRespawn(walked, press({ right: true, run: true }), 2)).toBe(true);

    const slid = start(rows);
    still(slid);
    run(slid, 0.4, press({ right: true, run: true }));
    run(slid, 0.5, press({ right: true, run: true, down: true }));
    expect(slid.deaths).toBe(0);
    expect(slid.player.x).toBeGreaterThan(7 * TILE);
  });
});

describe("the big dog", () => {
  it("awards each hit bonus only once per run, including after a death", () => {
    const state = start(["               ", "C       B      ", "###############"]);
    const hit = () => {
      state.boss!.mode = "stunned";
      state.boss!.modeTime = 2;
      state.player.x = state.boss!.x - 23;
      state.player.y = state.boss!.y;
      state.player.action = "none";
      state.player.spinHeld = false;
      state.player.spinCooldown = 0;
      step(state, press({ spin: true }), DT);
    };

    hit();
    expect(state.score).toBe(BOSS_POINTS);
    state.player.y = state.level.height * TILE + TILE * 2;
    run(state, 0.5);
    expect(state.deaths).toBe(1);
    expect(state.boss!.phase).toBe(0);
    expect(state.score).toBe(BOSS_POINTS);

    hit();
    expect(state.boss!.phase).toBe(1);
    expect(state.score).toBe(BOSS_POINTS);
    hit();
    hit();
    expect(state.boss!.mode).toBe("dead");
    expect(state.score).toBe(3 * BOSS_POINTS);
    respawn(state);
    hit();
    expect(state.score).toBe(3 * BOSS_POINTS);

    resetLevel(state);
    hit();
    expect(state.score).toBe(BOSS_POINTS);
  });

  it("winds up, charges, and stuns itself on what it hits", () => {
    // Walled off from the cat: a charge that reaches it kills it, and respawn
    // rebuilds the boss, so the cycle would restart before it ever stunned.
    const state = start(["          ", "          ", "C#       B", "##########"]);
    const seen = new Set<string>();
    for (let t = 0; t < 8; t += DT) {
      step(state, NO_INPUT, DT);
      seen.add(state.boss!.mode);
    }

    expect(seen.has("charge")).toBe(true);
    expect(seen.has("stunned")).toBe(true);
  });

  it("only takes a hit while it is stunned", () => {
    const ready = start(["          ", "          ", "C   B     ", "##########"]);
    ready.player.x = 3 * TILE;
    ready.boss!.mode = "stunned";
    ready.boss!.modeTime = 99;
    run(ready, 0.3);
    run(ready, 0.3, press({ spin: true }));
    expect(ready.boss!.phase).toBe(1);
    expect(ready.boss!.mode).toBe("hurt");

    const guarded = start(["          ", "          ", "C   B     ", "##########"]);
    guarded.player.x = 3 * TILE;
    guarded.boss!.mode = "wait";
    guarded.boss!.modeTime = 99;
    run(guarded, 0.3);
    run(guarded, 0.3, press({ spin: true }));
    expect(guarded.boss!.phase).toBe(0);
  });

  it("is harmless while it reels, so landing the spin is not a death", () => {
    const state = start(["          ", "          ", "C   B     ", "##########"]);
    state.boss!.mode = "hurt";
    state.boss!.modeTime = 99;
    state.player.x = state.boss!.x;
    run(state, 0.4);

    expect(state.deaths).toBe(0);
  });

  it("keeps the flag shut until it is down", () => {
    const state = start(["        ", "        ", "C  B   G", "########"]);
    run(state, 0.3);
    state.player.x = 7 * TILE;
    run(state, 0.1);
    expect(state.phase).toBe("playing");

    state.boss!.mode = "dead";
    run(state, 0.1);
    expect(state.phase).toBe("won");
  });
});

describe("a slide that runs into something", () => {
  it("breaks a crate it hits head on", () => {
    const state = start(["            ", "            ", "C     c     ", "############"]);
    run(state, 0.4, press({ right: true, run: true }));
    run(state, 0.6, press({ right: true, run: true, down: true }));

    expect(tileAt(state.level, 6, 2)).toBe(Tile.Empty);
  });

  it("can be backed out of when it jams under a roof it cannot stand under", () => {
    const state = start([
      "            ",
      "     ####   ",
      "C        #  ",
      "############",
    ]);
    run(state, 0.4, press({ right: true, run: true }));
    run(state, 1.2, press({ right: true, run: true, down: true }));

    // Wedged: under the roof, nose against the wall, unable to stand up.
    const jammed = state.player.x;
    expect(state.player.action).toBe("slide");

    // Holding back has to get the cat out. Anything else is a softlock.
    run(state, 0.8, press({ left: true, run: true }));
    expect(state.player.x).toBeLessThan(jammed - TILE);
  });
});

describe("spawn safe areas", () => {
  it("excludes nearby enemies from entry and checkpoint spawns, including after respawn", () => {
    const state = start(["                       ", "CdhwD    p dwhD      d ", "#######################"]);
    expect(state.dogs).toHaveLength(6);
    for (const dog of state.dogs) {
      expect(state.safeAreas.some((area) => overlaps(dogRect(dog), area))).toBe(false);
    }
    state.player.x = 8 * TILE;
    run(state, 0.3, press({ spin: true }));
    expect(tileAt(state.level, 9, 1)).toBe(Tile.Empty);
    respawn(state);
    expect(state.player.x).toBe(9 * TILE);
    expect(state.dogs).toHaveLength(6);
    for (const dog of state.dogs) {
      expect(state.safeAreas.some((area) => overlaps(dogRect(dog), area))).toBe(false);
    }
  });

  it("stops a boss charge at the safe area boundary", () => {
    const state = start(["               ", "C       B      ", "###############"]);
    for (let frame = 0; frame < 120 * 10; frame++) {
      step(state, NO_INPUT, DT);
      expect(state.boss!.x).toBeGreaterThanOrEqual(3 * TILE);
    }
    expect(state.deaths).toBe(0);
  });

  it.each(["d", "D", "h", "w"])("keeps patrolling %s outside entry and checkpoint areas", (kind) => {
    const state = start(["                 ", `C    ${kind}     p     `, "#################"]);
    const dog = state.dogs[0]!;
    for (let frame = 0; frame < 120 * 20; frame++) {
      step(state, NO_INPUT, DT);
      expect(state.safeAreas.some((area) => overlaps(dogRect(dog), area))).toBe(false);
    }
    expect(state.deaths).toBe(0);
  });
});

describe("nitro detonation", () => {
  it("explodes on contact, chains into nearby crates, and shows the blast before respawn", () => {
    const state = start(["       ", "       ", "C nnc  ", "#######"]);
    for (let frame = 0; frame < 120 && state.phase === "playing"; frame++) {
      step(state, press({ right: true }), DT);
    }
    expect(state.phase).toBe("dying");
    expect(state.sounds.filter((sound) => sound === "explode")).toHaveLength(2);
    expect(tileAt(state.level, 2, 2)).toBe(Tile.Empty);
    expect(tileAt(state.level, 3, 2)).toBe(Tile.Empty);
    expect(tileAt(state.level, 4, 2)).toBe(Tile.Empty);
    expect(state.score).toBe(0);
    expect(state.flowerCount).toBe(0);
    expect(state.debris.filter((piece) => piece.tile === Tile.CrateNitro)).toHaveLength(2);
    run(state, EXPLOSION_TIME / 2);
    expect(state.phase).toBe("dying");
    expect(state.debris.length).toBeGreaterThan(0);
    run(state, EXPLOSION_TIME);
    expect(state.phase).toBe("playing");
    expect(state.deaths).toBe(1);
  });
});
