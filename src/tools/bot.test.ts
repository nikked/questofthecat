import { expect, it } from "vitest";
import { TILE, Tile, seasonAt, tileAt } from "../core/level";
import { NO_INPUT, type Input, type Side } from "../core/physics";
import {
  BOSS_W,
  PLAYER_H,
  PLAYER_W,
  createState,
  endingFor,
  resetLevel,
  step,
} from "../core/state";
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
  // Both verbs need a fresh press each time, so the bot has to let go between.
  let spinClock = 0;
  let bossJump = false;
  let lastPhase = 0;
  let retreatUntil = -1;

  for (let i = 0; i < 120 * 260; i++) {
    // Walkers are cleared: this checks terrain and the boss, not combat.
    state.dogs.length = 0;
    const p = state.player;
    const inShaft =
      p.x + PLAYER_W > shaft.left && p.x < shaft.right && p.y + PLAYER_H > shaft.exitY;

    let input: Input;
    if (inShaft) {
      const chest = Math.floor((p.y + 8) / TILE);
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
      const tx = Math.floor((p.x + PLAYER_W + 12) / TILE);
      const feet = Math.floor((p.y + PLAYER_H + 4) / TILE);
      // Everything the cat's own body would hit, head included: the autumn
      // tunnel's roof blocks the head while leaving the feet a clear path.
      const head = Math.floor(p.y / TILE);
      const chest = Math.floor((p.y + PLAYER_H - 4) / TILE);
      let wall = false;
      for (let ty = head; ty <= chest; ty++) {
        if (tileAt(state.level, tx, ty) !== Tile.Empty) {
          wall = true;
          break;
        }
      }
      // Ground within a step below still counts as ground: standing on a crate
      // puts the feet a row above the floor, and a single-row check reads that
      // as a pit and spends the jump early.
      const footing = (col: number): boolean => {
        for (let ty = feet; ty <= feet + 2; ty++) {
          if (tileAt(state.level, col, ty) !== Tile.Empty) return true;
        }
        return false;
      };
      const gap = !footing(tx) && !footing(tx + 1);
      const nose = p.x + PLAYER_W;
      const spike = state.cacti.some((c) => c.x - nose > 4 && c.x - nose < 52);
      // Nitro needs the same early jump a cactus does: it is solid, so the
      // ordinary wall check fires far too late to carry the cat over it.
      let nitro = false;
      const bodyRow = Math.floor((p.y + PLAYER_H - 4) / TILE);
      for (let col = Math.floor((nose + 6) / TILE); col <= Math.floor((nose + 64) / TILE); col++) {
        for (const ty of [bodyRow, bodyRow - 1]) {
          if (tileAt(state.level, col, ty) === Tile.CrateNitro) nitro = true;
        }
      }

      if (p.grounded && (wall || gap || spike || nitro)) jumpHeld = true;
      else if (p.vy > 0) jumpHeld = false;
      // Let go of a wall we did not mean to grab, long enough to fall past it.
      if (p.cling !== 0) releaseUntil = i + 30;
      input = { ...NO_INPUT, right: i > releaseUntil, run: true, jump: jumpHeld };

      // The big dog overrides ordinary running: the flag does not work until
      // it is down, so there is no point walking past it.
      const boss = state.boss;
      // Only once past the arena's first post: before that this is ordinary
      // running, and the fight logic has no reason to hold the cat back.
      if (boss && boss.mode !== "dead" && p.x > 174 * TILE) {
        const gapToBoss = boss.x + BOSS_W / 2 - (p.x + PLAYER_W / 2);
        const range = Math.abs(gapToBoss);
        // The posts stay in the way during the fight, so every branch keeps it.
        const hop = jumpHeld && wall;
        if (boss.mode === "stunned") {
          spinClock = (spinClock + DT) % 0.5;
          const close = range < 46;
          input = {
            ...NO_INPUT,
            run: true,
            left: !close && gapToBoss < 0,
            right: !close && gapToBoss > 0,
            spin: close && spinClock < 0.25,
            jump: hop,
          };
        } else {
          // Hop the charge on the same grounded edge the terrain jump uses; a
          // duty cycle misses half of them and the cat only gets one mistake.
          const charging = boss.mode === "charge";
          if (charging && range < 120 && p.grounded) bossJump = true;
          else if (p.vy > 0) bossJump = false;
          // A landed spin leaves the cat standing inside the boss, which turns
          // lethal again the instant it stops reeling. Back out of it first.
          const away = gapToBoss > 0 ? -1 : 1;
          const dir = i < retreatUntil ? away : charging ? 0 : range > 190 ? -away : 0;
          input = {
            ...NO_INPUT,
            run: true,
            left: dir < 0,
            right: dir > 0,
            jump: hop || bossJump,
          };
        }
        if (boss.phase !== lastPhase) {
          lastPhase = boss.phase;
          retreatUntil = i + 110;
        }
      }
    }

    step(state, input, DT);
    if (state.phase === "won") return state;
  }
  throw new Error(
    `bot never reached the flag; furthest ${Math.floor(state.player.x / TILE)} ` +
      `(${seasonAt(state.level, state.player.x)}), boss ${state.boss?.mode ?? "none"}`,
  );
}

it("the level can be finished without dying", () => {
  const state = play();

  expect(state.phase).toBe("won");
  expect(state.deaths).toBe(0);
  expect(state.runTime).toBeGreaterThan(5);
  expect(state.runTime).toBeLessThan(140);
  expect(state.boss?.mode).toBe("dead");
  expect(endingFor(state.score)).toBe("ship");
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
