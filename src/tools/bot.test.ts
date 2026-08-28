import { expect, it } from "vitest";
import { TILE, Tile, seasonAt, tileAt } from "../core/level";
import { NO_INPUT, type Input, type Side } from "../core/physics";
import { PLAYER_H, PLAYER_W, createState, endingFor, resetLevel, step } from "../core/state";
import { PAR_GHOST, PAR_SCORE, PAR_TIME } from "../ghost";
import { LEVEL_1 } from "../levels";

const DT = 1 / 120;

/**
 * A scripted player that runs the level end to end. It is the only guard that
 * the level is actually completable: level geometry has no type to check it
 * against, so a bad jump or a pit one tile too wide is otherwise invisible
 * until someone plays it.
 *
 * Its run is also the par ghost shipped in src/ghost.ts, so the second test
 * fails the moment the level changes without the ghost being re-recorded.
 */
function play(): ReturnType<typeof createState> {
  const state = createState(LEVEL_1);
  resetLevel(state);
  const shaft = state.chimney;
  if (!shaft) throw new Error("level has no chimney");

  let jumpHeld = false;
  let shaftClock = 0;
  let releaseUntil = -1;

  for (let i = 0; i < 120 * 200; i++) {
    // Dogs are cleared: this checks terrain, not combat.
    state.dogs.length = 0;
    const p = state.player;
    const inShaft =
      p.x + PLAYER_W > shaft.left && p.x < shaft.right && p.y + PLAYER_H > shaft.exitY;

    let input: Input;
    if (inShaft) {
      const chest = Math.floor((p.y + 4) / TILE);
      const leftSolid = tileAt(state.level, Math.floor((shaft.left - 1) / TILE), chest) !== Tile.Empty;
      const rightSolid = tileAt(state.level, Math.floor(shaft.right / TILE), chest) !== Tile.Empty;
      const nearer: Side = p.x + PLAYER_W / 2 < (shaft.left + shaft.right) / 2 ? -1 : 1;
      const into: Side =
        p.cling !== 0 ? p.cling : leftSolid && !rightSolid ? -1 : rightSolid && !leftSolid ? 1 : nearer;

      // Tap rather than hold: a held jump never re-arms the buffer.
      shaftClock += DT;
      if (shaftClock >= 0.35) shaftClock = 0;
      input = { ...NO_INPUT, left: into < 0, right: into > 0, jump: shaftClock < 0.25 };
    } else {
      const tx = Math.floor((p.x + PLAYER_W + 6) / TILE);
      const feet = Math.floor((p.y + PLAYER_H + 2) / TILE);
      // Only what blocks the cat's own body counts; overhead pillars are routes.
      const body = Math.floor((p.y + PLAYER_H - 2) / TILE);
      const wall = tileAt(state.level, tx, body) !== Tile.Empty;
      const gap =
        tileAt(state.level, tx, feet) === Tile.Empty &&
        tileAt(state.level, tx + 1, feet) === Tile.Empty;
      const nose = p.x + PLAYER_W;
      const spike = state.cacti.some((c) => c.x - nose > 2 && c.x - nose < 26);

      if (p.grounded && (wall || gap || spike)) jumpHeld = true;
      else if (p.vy > 0) jumpHeld = false;
      // Let go of a wall we did not mean to grab, long enough to fall past it.
      if (p.cling !== 0) releaseUntil = i + 30;
      input = { ...NO_INPUT, right: i > releaseUntil, run: true, jump: jumpHeld };
    }

    step(state, input, DT);
    if (state.phase === "won") return state;
  }
  throw new Error(
    `bot never reached the flag; furthest ${Math.floor(state.player.x / TILE)} ` +
      `(${seasonAt(state.level, state.player.x)})`,
  );
}

it("the level can be finished without dying", () => {
  const state = play();

  expect(state.phase).toBe("won");
  expect(state.deaths).toBe(0);
  expect(state.runTime).toBeGreaterThan(5);
  expect(state.runTime).toBeLessThan(60);

  const carried =
    state.flowers.filter((f) => f.taken).length + state.monstera.filter((m) => m.taken).length * 5;
  // A run that ignores the wall-jump routes should still earn a boat.
  expect(endingFor(carried)).not.toBe("shore");
});

it("the shipped par ghost still matches this level", () => {
  const state = play();

  // If this fails, the level changed and src/ghost.ts is replaying a layout
  // that no longer exists. Re-record it: log `state.trace`, `state.runTime`
  // and `state.score` from the run above and paste them into src/ghost.ts.
  expect(state.runTime).toBeCloseTo(PAR_TIME, 1);
  expect(state.score).toBe(PAR_SCORE);
  expect(state.trace).toEqual([...PAR_GHOST]);
});
