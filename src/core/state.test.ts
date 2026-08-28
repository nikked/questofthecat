import { describe, expect, it } from "vitest";
import { TILE, Tile, tileAt } from "./level";
import { JUMP_BUFFER, NO_INPUT, WALL_SLIDE_SPEED, type Input } from "./physics";
import {
  BREEDS,
  dogRect,
  FLOWER_POINTS,
  GOAL_POINTS,
  MONSTERA_POINTS,
  STOMP_POINTS,
  STUMP_POINTS,
  TIME_BONUS_RATE,
  TIME_BONUS_WINDOW,
  timeBonus,
  MONSTERA_VALUE,
  SAILBOAT_THRESHOLD,
  SAIL_THRESHOLD,
  SHIP_THRESHOLD,
  STARTING_LIVES,
  TRACE_HZ,
  createState,
  endingFor,
  harvest,
  resetLevel,
  step,
  type GameState,
} from "./state";

const DT = 1 / 120;
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

    expect(state.player.y).toBe(2 * TILE - 14);
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
    const state = start(["#    C", "#d    ", "######"]);
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
    const state = start(["     ", "     ", "C d D", "#####"]);
    const [terrier, retriever] = state.dogs;

    expect(terrier!.breed).toBe("terrier");
    expect(retriever!.breed).toBe("retriever");
    expect(dogRect(retriever!).w).toBeGreaterThan(dogRect(terrier!).w);
    expect(BREEDS.retriever.speed).toBeLessThan(BREEDS.terrier.speed);
  });

  it("stops moving while it scratches or sniffs", () => {
    const state = start(["          ", "          ", "C       d ", "##########"]);
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
    const state = start(["          ", "          ", "C       d ", "##########"]);
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

    expect(state.goal).toEqual({ x: 2 * TILE + 4, y: 0, w: 8, h: 4 * TILE });
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

describe("checkpoints", () => {
  it("moves the respawn point and chimes once", () => {
    const state = start(["      ", "    P ", "C     ", "######"]);
    run(state, 0.4);

    const emitted: string[] = [];
    for (let t = 0; t < 1.2; t += DT) {
      step(state, press({ right: true, run: true }), DT);
      emitted.push(...state.sounds);
    }

    expect(emitted.filter((e) => e === "checkpoint")).toEqual(["checkpoint"]);
    expect(state.spawnX).toBe(4 * TILE);
  });

  it("respawns the cat at the checkpoint after a death", () => {
    const state = start(["          ", "    P     ", "C        d", "##########"]);
    run(state, 0.4);

    expect(runUntilRespawn(state, press({ right: true, run: true }))).toBe(true);
    expect(state.player.x).toBe(4 * TILE);
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
  it("pays for a flower, a monstera and a stump", () => {
    const state = start(["      ", "      ", "CfM   ", "######"]);
    run(state, 0.6, press({ right: true }));
    expect(state.score).toBe(FLOWER_POINTS + MONSTERA_POINTS);

    const bumped = start([" ? ", " C ", "###"]);
    run(bumped, 0.4);
    run(bumped, 0.4, press({ jump: true }));
    expect(bumped.score).toBe(STUMP_POINTS);
  });

  it("pays for a stomp", () => {
    const state = start(["  ", "C ", "  ", "d ", "##"]);
    state.dogs[0]!.vx = 0;
    run(state, 1);

    expect(state.dogs[0]!.alive).toBe(false);
    expect(state.score).toBe(STOMP_POINTS);
  });

  it("rewards a fast finish and never punishes a slow one", () => {
    expect(timeBonus(0)).toBe(TIME_BONUS_WINDOW * TIME_BONUS_RATE);
    expect(timeBonus(TIME_BONUS_WINDOW)).toBe(0);
    // Past the window the bonus floors rather than going negative.
    expect(timeBonus(TIME_BONUS_WINDOW * 3)).toBe(0);
    expect(timeBonus(10)).toBeGreaterThan(timeBonus(20));
  });

  it("adds the goal award and the speed bonus on the flag", () => {
    const state = start(["   ", "C G", "###"]);
    run(state, 1.2, press({ right: true, run: true }));

    expect(state.phase).toBe("won");
    expect(state.score).toBe(GOAL_POINTS + timeBonus(state.runTime));
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
  it("counts down but never ends the run", () => {
    const state = start(["      ", "      ", "C    d", "######"]);

    for (let i = 0; i < 12; i++) {
      run(state, 1.4, press({ right: true, run: true }));
    }

    expect(state.deaths).toBeGreaterThan(STARTING_LIVES);
    expect(state.lives).toBe(0);
    expect(state.phase).not.toBe("won");
    // Still playable with the counter emptied.
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

  it("grades the ending by what was carried, not by time", () => {
    expect(endingFor(0)).toBe("shore");
    expect(endingFor(SAIL_THRESHOLD - 1)).toBe("shore");
    expect(endingFor(SAIL_THRESHOLD)).toBe("raft");
    expect(endingFor(SAILBOAT_THRESHOLD)).toBe("sailboat");
    expect(endingFor(SHIP_THRESHOLD)).toBe("ship");
    expect(endingFor(999)).toBe("ship");
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
    "#..#..",
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
  it("pops the stump and leaves it a plain log", () => {
    const state = start([" ? ", " C ", "###"]);
    run(state, 0.4);
    expect(tileAt(state.level, 1, 0)).toBe(Tile.Box);

    run(state, 0.4, press({ jump: true }));
    expect(tileAt(state.level, 1, 0)).toBe(Tile.Brick);
  });
});
